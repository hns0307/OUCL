import { constants } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { ModContractError } from '../../shared/contracts/mods.js';
import { checkPlatformMods } from '../../core/mods/platform.js';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import type { RecordEnvelope } from '../storage/records.js';
import { parseInstanceRecord } from '../storage/instance-records.js';
import type { InstanceRecord } from '../storage/instance-records.js';
import { parseModTransaction } from '../storage/mod-transactions.js';
import type { ModFileIdentity, ModTransaction, ModTransactionFile } from '../storage/mod-transactions.js';
import type { StorageClient } from '../workers/storage-client.js';
import type { ModArchiveReader } from '../workers/mod-archive-reader.js';
import { ensureChildDirectory } from '../install/instance-files.js';
import { sourceKey } from '../objects/provenance.js';
import { modInventoryFingerprint } from './inventory.js';
import type { ModInventoryContext, ModInventoryService } from './inventory.js';
import type { PreparedModInstall } from './preparation.js';
import { plannedModFacts, platformFacts } from './facts.js';
import type { ModArchiveScan } from './archive.js';

type Repository = Pick<StorageClient, 'readInstallation' | 'readInstance' | 'writeInstance' | 'readInstances' | 'writeInstances'
  | 'readModPlan' | 'readModTransaction' | 'writeModTransaction' | 'readGameSessions'>;
export type ModTransactionCheckpoint = 'staged' | 'linked' | 'instance-published';
interface Dependencies {
  context: (instanceId: string, signal?: AbortSignal) => Promise<ModInventoryContext>;
  inventory: Pick<ModInventoryService, 'scan'>; scanner: Pick<ModArchiveReader, 'read'>;
  checkpoint?: (point: ModTransactionCheckpoint, index?: number) => Promise<void>;
}
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function identity(file: string): Promise<ModFileIdentity> {
  const stat = await lstat(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.ino === 0n) throw new ModContractError('MODS_UNSAFE');
  return { dev: String(stat.dev), ino: String(stat.ino) };
}
function sameIdentity(left: ModFileIdentity, right: ModFileIdentity): boolean { return left.dev === right.dev && left.ino === right.ino; }

/** Add-only Mod transaction. Private staging copies never link writable Mods directly to the shared object store.
 * The instance's unique modCommitId is the JSON commit point; recovery never guesses from file presence alone.
 */
export class ModTransactionService {
  private active = false;
  constructor(private readonly storage: Repository, private readonly dependencies: Dependencies) {}
  private async persist(revision: number, data: ModTransaction): Promise<RecordEnvelope<ModTransaction>> {
    try { return await this.storage.writeModTransaction(data.taskId, revision, data); }
    catch (error) {
      if (hasCode(error, 'TIMEOUT') || hasCode(error, 'REVISION_CONFLICT')) {
        const saved = await this.storage.readModTransaction(data.taskId);
        if (saved && digest(saved.data) === digest(data)) return saved;
      }
      throw new ModContractError('NEEDS_RECOVERY');
    }
  }
  private async game(record: ModTransaction) {
    const root = await this.storage.readInstallation();
    if (!root || root.data.rootId !== record.rootId) throw new ModContractError('ROOT_UNAVAILABLE');
    const context = await this.dependencies.context(record.instanceId);
    if (context.instanceId !== record.instanceId || path.basename(context.modsDirectory) !== 'mods') throw new ModContractError('MODS_UNSAFE');
    const directory = await guardDirectory(path.dirname(context.modsDirectory));
    return { root: root.data, context, directory, mods: path.join(directory, 'mods'),
      staging: path.join(directory, '.oucl-mod-staging', record.taskId), lock: path.join(directory, 'oucl.session.lock') };
  }
  private async idle(record: ModTransaction): Promise<void> {
    const sessions = await this.storage.readGameSessions();
    if (sessions?.data.items.some(item => item.rootId === record.rootId && item.snapshot.instanceId === record.instanceId && item.snapshot.state !== 'exited')) throw new ModContractError('INSTANCE_BUSY');
  }
  private async claim(lock: string, token: string, recovery = false): Promise<void> {
    if (recovery && (await readRegular(lock, 100))?.toString('utf8') === token) return;
    let handle;
    try { handle = await open(lock, 'wx'); } catch (error) { throw new ModContractError(hasCode(error, 'EEXIST') ? 'INSTANCE_BUSY' : 'SCAN_FAILED'); }
    try { await handle.writeFile(token); await handle.sync(); } finally { await handle.close(); }
  }
  private async release(directory: string, lock: string, token: string): Promise<void> {
    await guardDirectory(directory); const owner = await readRegular(lock, 100);
    if (!owner) return;
    if (owner.toString('utf8') !== token) throw new ModContractError('NEEDS_RECOVERY');
    await unlink(lock);
  }
  private async verifyFile(file: string, expected: ModTransactionFile, signal?: AbortSignal): Promise<ModArchiveScan> {
    await guardDirectory(path.dirname(file)); const before = await identity(file);
    const scan = await this.dependencies.scanner.read(file, signal);
    if (scan.size !== expected.size || scan.sha1 !== expected.sha1 || scan.sha256 !== expected.sha256 || scan.sha512 !== expected.sha512) throw new ModContractError('FILES_CHANGED');
    if (!sameIdentity(before, await identity(file))) throw new ModContractError('FILES_CHANGED');
    return scan;
  }
  private async index(instance: InstanceRecord): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const index = await this.storage.readInstances(); const existing = index?.data.items.find(item => item.instanceId === instance.summary.instanceId);
      if (!index || !existing || existing.rootId !== instance.summary.rootId) throw new ModContractError('NEEDS_RECOVERY');
      if (digest(existing) === digest(instance.summary)) return;
      if (existing.revision !== instance.summary.revision - 1) throw new ModContractError('NEEDS_RECOVERY');
      try { await this.storage.writeInstances(index.revision, { items: index.data.items.map(item => item.instanceId === instance.summary.instanceId ? instance.summary : item) }); return; }
      catch (error) { if (!hasCode(error, 'REVISION_CONFLICT') && !hasCode(error, 'TIMEOUT')) throw error; }
    }
    throw new ModContractError('NEEDS_RECOVERY');
  }
  private async finish(record: RecordEnvelope<ModTransaction>, instance: InstanceRecord): Promise<RecordEnvelope<ModTransaction>> {
    if (instance.modCommitId !== record.data.taskId || digest(instance) !== record.data.afterInstanceDigest) throw new ModContractError('NEEDS_RECOVERY');
    await this.index(instance);
    return this.persist(record.revision, { ...record.data, phase: 'committed' });
  }
  private async rollback(record: RecordEnvelope<ModTransaction>, game: Awaited<ReturnType<ModTransactionService['game']>>): Promise<RecordEnvelope<ModTransaction>> {
    let uncertain = false;
    for (const [index, file] of record.data.files.entries()) {
      if (!file.identity) continue;
      const target = path.join(game.mods, file.filename); let actual;
      try { await guardDirectory(game.mods); actual = await identity(target); }
      catch (error) { if (hasCode(error, 'ENOENT')) continue; uncertain = true; continue; }
      if (!sameIdentity(actual, file.identity)) continue; // A foreign replacement is never removed, even if its bytes happen to match.
      try {
        await this.verifyFile(target, file);
        await ensureChildDirectory(game.directory, '.oucl-mod-staging', record.data.taskId);
        const retained = path.join(game.staging, `rollback-${index}-${randomUUID()}.jar`);
        await rename(target, retained); // Retain every rolled-back byte; do not recursively delete recovery materials.
        if (!sameIdentity(await identity(retained), file.identity)) {
          await link(retained, target).catch(() => {}); uncertain = true;
        }
      } catch { uncertain = true; }
    }
    return this.persist(record.revision, { ...record.data, phase: uncertain ? 'needsRecovery' : 'rolledBack' });
  }
  /** Publishes only files explicitly bound to a verified preparation. This method is not renderer-callable. */
  async commit(prepared: PreparedModInstall, signal?: AbortSignal): Promise<ModTransaction> {
    if (!UUID_PATTERN.test(prepared.consumerId)) throw new ModContractError('INVALID_ARGUMENT');
    prepared = structuredClone(prepared); prepared.consumerId = prepared.consumerId.toLowerCase();
    if (this.active) throw new ModContractError('SCAN_BUSY'); this.active = true;
    let saved: RecordEnvelope<ModTransaction> | undefined; let game: Awaited<ReturnType<ModTransactionService['game']>> | undefined; let owned = false;
    const check = (): void => { if (signal?.aborted) throw new ModContractError('CANCELLED'); };
    try {
      const old = await this.storage.readModTransaction(prepared.consumerId);
      if (old) {
        if (old.data.planId !== prepared.planId || old.data.planRequestId !== prepared.planRequestId || old.data.instanceId !== prepared.instanceId) throw new ModContractError('REVISION_CONFLICT');
        if (old.data.phase === 'committed') return old.data;
        throw new ModContractError('NEEDS_RECOVERY');
      }
      check(); const current = await this.storage.readInstance(prepared.instanceId);
      if (!current || current.revision !== prepared.instanceRevision || current.data.phase !== 'ready' || current.data.summary.rootId !== prepared.rootId) throw new ModContractError('REVISION_CONFLICT');
      const selected = await this.storage.readModPlan(prepared.planRequestId);
      if (!selected || selected.data.status !== 'preview' || selected.data.plan.planId !== prepared.planId || selected.data.plan.state !== 'ready'
        || selected.data.rootId !== prepared.rootId || selected.data.plan.instanceId !== prepared.instanceId
        || selected.data.plan.instanceRevision !== prepared.instanceRevision || selected.data.plan.fingerprint !== prepared.fingerprint) throw new ModContractError('FILES_CHANGED');
      const planned = selected.data.plan.items.filter(item => item.disposition !== 'reuse');
      if (prepared.assessment.local.state !== 'satisfied' || prepared.assessment.platform.state !== 'satisfied' || planned.length !== prepared.files.length) throw new ModContractError('MODS_UNSAFE');
      const next = parseInstanceRecord({ ...current.data, modCommitId: prepared.consumerId, summary: { ...current.data.summary, revision: current.revision + 1 } });
      const files = prepared.files.map((file, index): ModTransactionFile => {
        if (digest(file.item) !== digest(planned[index]) || file.scan.sha256 !== file.object.digest || file.scan.sha1 !== file.item.fileId
          || file.scan.sha512 !== file.item.sha512 || file.object.size !== file.item.size
          || file.spec.expected.algorithm !== 'sha1' || file.spec.expected.digest !== file.item.fileId || file.spec.expected.size !== file.item.size
          || file.spec.anchor.kind !== 'modrinth-version'
          || sourceKey(file.spec.expected, file.spec.anchor) !== file.object.sourceKey) throw new ModContractError('UNTRUSTED_METADATA');
        return { filename: file.item.filename, projectId: file.item.projectId, versionId: file.item.versionId,
          sha1: file.item.fileId, sha256: file.object.digest, sha512: file.item.sha512, size: file.item.size, sourceKey: file.object.sourceKey, identity: null };
      });
      const record = parseModTransaction({ formatVersion: 1, taskId: prepared.consumerId, rootId: prepared.rootId,
        planRequestId: prepared.planRequestId, planId: prepared.planId, instanceId: prepared.instanceId, instanceRevision: current.revision,
        fingerprint: prepared.fingerprint, beforeInstanceDigest: digest(current.data), afterInstanceDigest: digest(next), leaseToken: randomUUID(), phase: 'prepared', files });
      game = await this.game(record); await this.idle(record); check();
      if (game.context.revision !== record.instanceRevision || game.context.environment.loader !== selected.data.plan.loader
        || game.context.environment.versions.minecraft !== selected.data.plan.minecraft) throw new ModContractError('REVISION_CONFLICT');
      const environment = digest(game.context.environment);
      saved = await this.persist(0, record);
      await this.claim(game.lock, record.leaseToken); owned = true;
      const initial = await this.dependencies.inventory.scan(record.instanceId, record.instanceRevision, signal); check();
      if (initial.fingerprint !== record.fingerprint) throw new ModContractError('FILES_CHANGED');
      const parent = await ensureChildDirectory(game.directory, '.oucl-mod-staging');
      await mkdir(path.join(parent, record.taskId)); await guardDirectory(game.staging);
      const scans: ModArchiveScan[] = [];
      for (const [index, file] of record.files.entries()) {
        check(); const source = path.join(game.root.dataDirectory, 'store/objects/sha256', file.sha256.slice(0, 2), file.sha256);
        await this.verifyFile(source, file, signal); check(); const staged = path.join(game.staging, file.filename);
        await copyFile(source, staged, constants.COPYFILE_EXCL); check(); await chmod(staged, 0o600);
        const handle = await open(staged, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
        const scan = await this.verifyFile(staged, file, signal); check(); record.files[index]!.identity = await identity(staged); scans.push(scan);
      }
      saved = await this.persist(saved.revision, record);
      await this.dependencies.checkpoint?.('staged'); check();
      if ((await this.dependencies.inventory.scan(record.instanceId, record.instanceRevision, signal)).fingerprint !== record.fingerprint) throw new ModContractError('FILES_CHANGED');
      await ensureChildDirectory(game.directory, 'mods');
      saved = await this.persist(saved.revision, { ...record, phase: 'applying' });
      for (const [index, file] of saved.data.files.entries()) {
        check(); await guardDirectory(game.mods); await guardDirectory(game.staging);
        await link(path.join(game.staging, file.filename), path.join(game.mods, file.filename));
        await this.dependencies.checkpoint?.('linked', index);
      }
      check(); const observed = await this.dependencies.inventory.scan(record.instanceId, record.instanceRevision, signal); check();
      const expected = modInventoryFingerprint(record.instanceId, record.instanceRevision,
        [...initial.items, ...record.files.map((file, index) => plannedModFacts(record.instanceId, file.filename, scans[index]!))]);
      if (observed.fingerprint !== expected) throw new ModContractError('FILES_CHANGED');
      const versions = new Map(prepared.assessment.platform.files.flatMap(file => file.version
        ? file.version.files.map(versionFile => [versionFile.sha512, file.version!] as const) : []));
      const dual = checkPlatformMods(observed.local.state, platformFacts(observed.items), game.context.environment, versions);
      if (dual.state !== 'satisfied') throw new ModContractError(dual.state === 'unsatisfied' ? 'MODS_INCOMPATIBLE' : 'MODS_UNDETERMINED');
      const context = await this.dependencies.context(record.instanceId, signal); check();
      if (context.revision !== record.instanceRevision || digest(context.environment) !== environment || context.modsDirectory !== game.context.modsDirectory) throw new ModContractError('REVISION_CONFLICT');
      await this.idle(record); const plan = await this.storage.readModPlan(record.planRequestId); check();
      if (plan?.data.status !== 'preview' || plan.data.plan.planId !== record.planId) throw new ModContractError('CANCELLED');
      // Once JSON publication begins, cancellation cannot promise rollback; its exact identity resolves lost acknowledgements.
      await this.storage.writeInstance(record.instanceId, record.instanceRevision, next);
      await this.dependencies.checkpoint?.('instance-published');
      saved = await this.finish(saved, next); await this.release(game.directory, game.lock, record.leaseToken); owned = false; return saved.data;
    } catch (error) {
      if (saved && game) {
        try {
          const current = await this.storage.readInstance(saved.data.instanceId);
          if (current?.data.modCommitId === saved.data.taskId && digest(current.data) === saved.data.afterInstanceDigest) {
            saved = await this.finish(saved, current.data); if (owned) await this.release(game.directory, game.lock, saved.data.leaseToken); return saved.data;
          }
          if (!current || digest(current.data) !== saved.data.beforeInstanceDigest) throw new ModContractError('NEEDS_RECOVERY');
          saved = owned ? await this.rollback(saved, game) : await this.persist(saved.revision, { ...saved.data, phase: 'rolledBack' });
          if (saved.data.phase !== 'rolledBack') throw new ModContractError('NEEDS_RECOVERY');
          if (owned) { await this.release(game.directory, game.lock, saved.data.leaseToken); owned = false; }
        } catch { throw new ModContractError('NEEDS_RECOVERY'); }
      }
      if (signal?.aborted) throw new ModContractError('CANCELLED');
      if (error instanceof ModContractError) throw error;
      throw new ModContractError(hasCode(error, 'EEXIST') ? 'FILES_CHANGED' : 'SCAN_FAILED');
    } finally { this.active = false; }
  }
  /** Explicit recovery uses the original journal token and JSON identity, never a PID or marker age. */
  async recover(taskId: string): Promise<ModTransaction> {
    if (!UUID_PATTERN.test(taskId)) throw new ModContractError('INVALID_ARGUMENT');
    if (this.active) throw new ModContractError('SCAN_BUSY'); this.active = true;
    try {
      let saved = await this.storage.readModTransaction(taskId); if (!saved) throw new ModContractError('NOT_FOUND');
      if (saved.data.phase === 'committed' || saved.data.phase === 'rolledBack') {
        const terminalGame = await this.game(saved.data);
        if ((await readRegular(terminalGame.lock, 100))?.toString('utf8') === saved.data.leaseToken) {
          await this.idle(saved.data); await this.release(terminalGame.directory, terminalGame.lock, saved.data.leaseToken);
        }
        return saved.data;
      }
      const game = await this.game(saved.data); await this.idle(saved.data); await this.claim(game.lock, saved.data.leaseToken, true);
      const current = await this.storage.readInstance(saved.data.instanceId);
      if (current?.data.modCommitId === saved.data.taskId && digest(current.data) === saved.data.afterInstanceDigest) saved = await this.finish(saved, current.data);
      else if (current && digest(current.data) === saved.data.beforeInstanceDigest) saved = await this.rollback(saved, game);
      else throw new ModContractError('NEEDS_RECOVERY');
      if (saved.data.phase === 'needsRecovery') throw new ModContractError('NEEDS_RECOVERY');
      await this.release(game.directory, game.lock, saved.data.leaseToken); return saved.data;
    } finally { this.active = false; }
  }
}
