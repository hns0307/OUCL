import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import { DistributionTransactionFiles, sameProof } from './transaction-files.js';
import { DistributionTransactionError, SimulatedDistributionCrash, assertDistributionJournalTransition, parseDistributionJournal, parseDistributionPlan, parseDistributionReceipt, transactionDigest, transactionReceipt } from './transaction-record.js';
import type { DirectoryProof, DistributionJournal, DistributionPlan, JournalRepository, ReceiptRepository, TransactionEnvelope } from './transaction-record.js';

export interface DistributionTransactionTarget { rootId: string; instanceId: string; revision: number; gameDir: string }
export type DistributionTransactionCheckpoint = 'staged' | 'backed-up' | 'published' | 'receipt-committed' | 'journal-committed' | 'journal-rolled-back';
export interface DistributionTransactionPorts {
  journals: JournalRepository; receipts: ReceiptRepository;
  /** Must authenticate this exact source/manifest/sequence binding using main-owned trust, not renderer evidence. */
  authorize(plan: DistributionPlan): Promise<void>;
  readTarget(instanceId: string): Promise<DistributionTransactionTarget>;
  isIdle(target: DistributionTransactionTarget): Promise<boolean>;
  artifact(plan: DistributionPlan, operationIndex: number): Promise<string>;
  /** Requires a new exclusive private-metadata owner; the gameDir token alone is not recovery permission. */
  canRecover(txId: string, leaseToken: string): Promise<boolean>;
  createFiles?(gameDir: string, txId: string, expectedRoot?: DirectoryProof): DistributionTransactionFiles;
  checkpoint?(point: DistributionTransactionCheckpoint, index?: number): Promise<void>;
}
type Saved = TransactionEnvelope<DistributionJournal>;
/** Internal transaction executor. No IPC, network, user-controlled trust roots or game-directory ownership adoption. */
export class DistributionTransactionService {
  private active: { txId: string; controller: AbortController; committing: boolean } | undefined;
  constructor(private readonly ports: DistributionTransactionPorts) {}
  private async persist(previous: Saved | undefined, journal: DistributionJournal): Promise<Saved> {
    journal = parseDistributionJournal(journal);
    assertDistributionJournalTransition(previous?.data, journal);
    try { return await this.ports.journals.write(journal.plan.txId, previous?.revision ?? 0, journal); }
    catch {
      const observed = await this.ports.journals.read(journal.plan.txId);
      if (observed && transactionDigest(parseDistributionJournal(observed.data)) === transactionDigest(journal)) return observed;
      throw new DistributionTransactionError('NEEDS_RECOVERY');
    }
  }
  private async target(plan: DistributionPlan, expectedDirectory?: string): Promise<DistributionTransactionTarget> {
    const target = await this.ports.readTarget(plan.instanceId);
    if (target.rootId !== plan.rootId || target.instanceId !== plan.instanceId || target.revision !== plan.instanceRevision
      || expectedDirectory && path.resolve(target.gameDir) !== path.resolve(expectedDirectory)) throw new DistributionTransactionError('FILES_CHANGED');
    await guardDirectory(target.gameDir);
    if (!await this.ports.isIdle(target)) throw new DistributionTransactionError('INSTANCE_BUSY'); return target;
  }
  private async ledger(journal: DistributionJournal): Promise<'before' | 'after'> {
    const current = await this.ports.receipts.read(journal.plan.instanceId);
    if (current && transactionDigest(parseDistributionReceipt(current.data)) === transactionDigest(journal.afterReceipt)
      && current.revision === journal.beforeReceiptRevision + 1) return 'after';
    if ((current?.revision ?? 0) === journal.beforeReceiptRevision && transactionDigest(current?.data ?? null) === transactionDigest(journal.beforeReceipt)) return 'before';
    throw new DistributionTransactionError('NEEDS_RECOVERY');
  }
  private filePath(game: DistributionTransactionFiles, journal: DistributionJournal, index: number): string {
    const operation = journal.plan.manifest.operations[journal.files[index]!.operationIndex]!;
    return path.join(game.gameDir, operation.area, operation.path);
  }
  private async finish(saved: Saved, game: DistributionTransactionFiles): Promise<Saved> {
    await game.assertLease(saved.data.leaseToken);
    if (await this.ledger(saved.data) !== 'after') throw new DistributionTransactionError('NEEDS_RECOVERY');
    for (const [index, file] of saved.data.files.entries()) {
      const target = this.filePath(game, saved.data, index);
      if (file.fresh) {
        await game.require(target, file.fresh);
        const staged = await game.inspect(game.stage(index)); if (staged) await game.removeOwned(game.stage(index), file.fresh);
      } else if (await game.inspect(target)) throw new DistributionTransactionError('NEEDS_RECOVERY');
    }
    saved = await this.persist(saved, { ...saved.data, phase: 'committed', pending: null });
    await this.ports.checkpoint?.('journal-committed'); return saved;
  }
  private async rollback(saved: Saved, game: DistributionTransactionFiles): Promise<Saved> {
    await game.assertLease(saved.data.leaseToken);
    if (await this.ledger(saved.data) !== 'before') throw new DistributionTransactionError('NEEDS_RECOVERY');
    for (let index = saved.data.files.length - 1; index >= 0; index--) {
      await game.assertLease(saved.data.leaseToken);
      const file = saved.data.files[index]!; const target = this.filePath(game, saved.data, index);
      let current = await game.inspect(target);
      if (current && file.fresh && sameProof(current, file.fresh)) {
        await game.moveAside(target, game.retired(index), file.fresh); current = undefined;
      } else if (current && (!file.old || !sameProof(current, file.old))) throw new DistributionTransactionError('NEEDS_RECOVERY');
      if (file.old) {
        const backup = await game.inspect(game.backup(index));
        if (backup) {
          if (!sameProof(backup, file.old)) throw new DistributionTransactionError('NEEDS_RECOVERY');
          if (!current) { await game.publish(game.backup(index), target, file.old); current = file.old; }
          await game.require(target, file.old); await game.removeOwned(game.backup(index), file.old);
        }
        if (!current || !sameProof(current, file.old)) throw new DistributionTransactionError('NEEDS_RECOVERY');
      }
    }
    saved = await this.persist(saved, { ...saved.data, phase: 'rolledBack', pending: null });
    await this.ports.checkpoint?.('journal-rolled-back'); return saved;
  }
  /** Cancellation cannot revoke a receipt commit already started or acknowledged. */
  async cancel(txId: string): Promise<void> {
    if (!UUID_PATTERN.test(txId) || txId !== txId.toLowerCase()) throw new DistributionTransactionError('INVALID_TRANSACTION');
    const saved = await this.ports.journals.read(txId);
    if (saved && await this.ledger(parseDistributionJournal(saved.data)) === 'after' || this.active?.txId === txId && this.active.committing) throw new DistributionTransactionError('CANCEL_TOO_LATE');
    if (!this.active || this.active.txId !== txId) throw new DistributionTransactionError('NEEDS_RECOVERY');
    this.active.controller.abort();
  }
  /** Stages trusted local artifacts, acquires the existing gameDir lease, then publishes an atomic private receipt. */
  async commit(input: DistributionPlan, signal?: AbortSignal): Promise<DistributionJournal> {
    const plan = parseDistributionPlan(input);
    if (this.active) throw new DistributionTransactionError('INSTANCE_BUSY');
    const controller = new AbortController(); this.active = { txId: plan.txId, controller, committing: false };
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const check = (): void => { if (combined.aborted) throw new DistributionTransactionError('CANCELLED'); };
    let saved: Saved | undefined; let game: DistributionTransactionFiles | undefined; let owned = false;
    try {
      const old = await this.ports.journals.read(plan.txId);
      if (old) {
        const parsed = parseDistributionJournal(old.data);
        if (parsed.planDigest !== transactionDigest(plan)) throw new DistributionTransactionError('INVALID_TRANSACTION');
        if (parsed.phase === 'committed' || parsed.phase === 'rolledBack') return parsed;
        throw new DistributionTransactionError('NEEDS_RECOVERY');
      }
      check(); await this.ports.authorize(plan); check(); const target = await this.target(plan);
      const before = await this.ports.receipts.read(plan.instanceId);
      const receipt = before ? parseDistributionReceipt(before.data) : null;
      if (receipt && receipt.instanceId !== plan.instanceId) throw new DistributionTransactionError('UNTRUSTED_DISTRIBUTION');
      const prior = receipt?.releases.find(entry => entry.sourceId === plan.sourceId && entry.packageId === plan.packageId);
      if (prior && plan.sequence <= prior.sequence) throw new DistributionTransactionError('UNTRUSTED_DISTRIBUTION');
      game = this.ports.createFiles?.(target.gameDir, plan.txId) ?? new DistributionTransactionFiles(target.gameDir, plan.txId); await game.initialize();
      const files: DistributionJournal['files'] = [];
      for (const [operationIndex, operation] of plan.manifest.operations.entries()) {
        check(); if (operation.kind === 'keep') continue;
        const filename = path.join(target.gameDir, operation.area, operation.path);
        const oldFile = await game.inspect(filename, 1);
        if (operation.kind === 'add') { if (oldFile) throw new DistributionTransactionError('FILES_CHANGED'); }
        else {
          const claim = receipt?.entries.find(entry => `${entry.area}/${entry.path}`.toLowerCase() === `${operation.area}/${operation.path}`.toLowerCase());
          if (operation.area === 'config' || !oldFile || oldFile.sha256 !== operation.expectedSha256 || !claim || claim.managedId !== operation.managedId
            || claim.sha256 !== operation.expectedSha256 || claim.sourceId !== plan.sourceId || claim.packageId !== plan.packageId) throw new DistributionTransactionError('FILES_CHANGED');
        }
        const fresh = operation.kind === 'remove' ? null : await game.copy(await this.ports.artifact(plan, operationIndex), files.length, operation.sha256, operation.size);
        files.push({ operationIndex, old: oldFile ?? null, fresh, stage: 'untouched' });
      }
      saved = await this.persist(undefined, { formatVersion: 2, plan, planDigest: transactionDigest(plan), leaseToken: randomUUID(), gameIdentity: game.gameIdentity, phase: 'prepared',
        beforeReceiptRevision: before?.revision ?? 0, beforeReceipt: receipt, afterReceipt: transactionReceipt(plan, receipt), files, pending: null });
      await game.claim(saved.data.leaseToken, false); owned = true;
      await this.target(plan, game.gameDir); if (await this.ledger(saved.data) !== 'before') throw new DistributionTransactionError('NEEDS_RECOVERY');
      await this.ports.checkpoint?.('staged'); check();
      saved = await this.persist(saved, { ...saved.data, phase: 'applying' });
      for (const [index, file] of saved.data.files.entries()) {
        check(); await game.assertLease(saved.data.leaseToken); const targetFile = this.filePath(game, saved.data, index); await game.directory(path.dirname(targetFile));
        if (file.old) {
          saved = await this.persist(saved, { ...saved.data, pending: { index, step: 'backup' } });
          await game.moveAside(targetFile, game.backup(index), file.old); await this.ports.checkpoint?.('backed-up', index);
          saved = await this.persist(saved, { ...saved.data, pending: null, files: saved.data.files.map((item, at) => at === index ? { ...item, stage: 'backedUp' } : item) });
        } else if (await game.inspect(targetFile)) throw new DistributionTransactionError('FILES_CHANGED');
        if (file.fresh) {
          check(); await game.assertLease(saved.data.leaseToken); saved = await this.persist(saved, { ...saved.data, pending: { index, step: 'publish' } });
          await game.publish(game.stage(index), targetFile, file.fresh); await this.ports.checkpoint?.('published', index);
          saved = await this.persist(saved, { ...saved.data, pending: null, files: saved.data.files.map((item, at) => at === index ? { ...item, stage: 'published' } : item) });
        }
      }
      await this.target(plan, game.gameDir); await this.ports.authorize(plan); check();
      for (const [index, file] of saved.data.files.entries()) {
        if (file.fresh) await game.require(this.filePath(game, saved.data, index), file.fresh);
        else if (await game.inspect(this.filePath(game, saved.data, index))) throw new DistributionTransactionError('FILES_CHANGED');
      }
      if (await this.ledger(saved.data) !== 'before') throw new DistributionTransactionError('NEEDS_RECOVERY'); await game.assertLease(saved.data.leaseToken); check(); this.active.committing = true;
      await this.ports.receipts.commit(plan.instanceId, saved.data.beforeReceiptRevision, saved.data.afterReceipt);
      await this.ports.checkpoint?.('receipt-committed'); saved = await this.finish(saved, game);
      await game.release(saved.data.leaseToken); owned = false; return saved.data;
    } catch (error) {
      if (error instanceof SimulatedDistributionCrash) throw error;
      if (saved && game && owned) {
        try {
          saved = await this.ledger(saved.data) === 'after' ? await this.finish(saved, game) : await this.rollback(saved, game);
          await game.release(saved.data.leaseToken); owned = false;
          if (saved.data.phase === 'committed') return saved.data;
        } catch (recoveryError) {
          if (recoveryError instanceof SimulatedDistributionCrash) throw recoveryError;
          await this.persist(saved, { ...saved.data, phase: 'needsRecovery', pending: null }).catch(() => {});
          throw new DistributionTransactionError('NEEDS_RECOVERY');
        }
      }
      if (combined.aborted) throw new DistributionTransactionError('CANCELLED');
      if (error instanceof DistributionTransactionError) throw error;
      throw new DistributionTransactionError(hasCode(error, 'EEXIST') ? 'FILES_CHANGED' : 'NEEDS_RECOVERY');
    } finally { this.active = undefined; }
  }
  /** Recovery needs the original journal and a proven exclusive metadata owner; file presence alone proves nothing. */
  async recover(txId: string): Promise<DistributionJournal> {
    if (!UUID_PATTERN.test(txId) || txId !== txId.toLowerCase()) throw new DistributionTransactionError('INVALID_TRANSACTION');
    if (this.active) throw new DistributionTransactionError('INSTANCE_BUSY');
    this.active = { txId, controller: new AbortController(), committing: false };
    try {
      let saved = await this.ports.journals.read(txId); if (!saved) throw new DistributionTransactionError('INVALID_TRANSACTION');
      saved = { ...saved, data: parseDistributionJournal(saved.data) };
      if (saved.data.plan.txId !== txId || !await this.ports.canRecover(txId, saved.data.leaseToken)) throw new DistributionTransactionError('NEEDS_RECOVERY');
      const target = await this.ports.readTarget(saved.data.plan.instanceId); await guardDirectory(target.gameDir);
      if (target.rootId !== saved.data.plan.rootId || target.instanceId !== saved.data.plan.instanceId || !await this.ports.isIdle(target)) throw new DistributionTransactionError('INSTANCE_BUSY');
      const game = this.ports.createFiles?.(target.gameDir, txId, saved.data.gameIdentity) ?? new DistributionTransactionFiles(target.gameDir, txId, { expectedRoot: saved.data.gameIdentity });
      await game.bindRoot();
      if (saved.data.phase === 'committed' || saved.data.phase === 'rolledBack') {
        if ((await readRegular(game.lock, 100))?.toString('utf8') === saved.data.leaseToken) {
          const expected = saved.data.phase === 'committed' ? 'after' : 'before';
          if (await this.ledger(saved.data) !== expected) throw new DistributionTransactionError('NEEDS_RECOVERY');
          await game.release(saved.data.leaseToken);
        }
        return saved.data;
      }
      await this.target(saved.data.plan, game.gameDir); await game.claim(saved.data.leaseToken, true);
      try {
        saved = await this.ledger(saved.data) === 'after' ? await this.finish(saved, game) : await this.rollback(saved, game);
        await game.release(saved.data.leaseToken); return saved.data;
      } catch (recoveryError) {
        if (recoveryError instanceof SimulatedDistributionCrash) throw recoveryError;
        await this.persist(saved, { ...saved.data, phase: 'needsRecovery', pending: null }).catch(() => {});
        throw new DistributionTransactionError('NEEDS_RECOVERY');
      }
    } finally { this.active = undefined; }
  }
}
