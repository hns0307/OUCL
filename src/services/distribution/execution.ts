import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { canonicalDistributionReleasePayload, checkDistributionReleaseTime, ReleaseError } from '../../core/distribution/release.js';
import { distributionDiff } from '../../core/distribution/manifest.js';
import type { DistributionDiff, DistributionManifest } from '../../core/distribution/manifest.js';
import { projectDistributionOwnership } from '../../core/distribution/ownership.js';
import { observeDistributionFiles } from './preview.js';
import { PinnedReleaseSource } from './release-source.js';
import { guardDirectory, StorageError } from '../storage/files.js';
import type { TrustedDistributionSource } from './source.js';
import type { DistributionStore } from './store.js';
import { DistributionTransactionService } from './transaction.js';
import type { DistributionTransactionPorts, DistributionTransactionTarget } from './transaction.js';
import { DistributionTransactionError, transactionDigest } from './transaction-record.js';
import type { DistributionJournal, DistributionPlan } from './transaction-record.js';
import type { AdmissionIntent } from './admission-record.js';

export interface DistributionExecutionTarget extends DistributionTransactionTarget { environment: DistributionManifest['target'] }
export interface DistributionExecutionQuery { rootId: string; instanceId: string; sourceId: string; packageId: string; packageVersion: string }
export interface DistributionProposal {
  proposalId: string; rootId: string; instanceId: string; sourceId: string; packageId: string; packageVersion: string;
  sequence: number; instanceRevision: number; expiresAt: number; changes: DistributionDiff['changes']; conflicts: DistributionDiff['conflicts'];
}
export interface DistributionExecutionOptions {
  sources: readonly TrustedDistributionSource[];
  /** Optional main-owned configuration lookup. A key revocation never comes from a renderer or signed package. */
  readSources?(): readonly TrustedDistributionSource[];
  store: Pick<DistributionStore, 'read' | 'compareAndSet' | 'saveAcceptedRelease' | 'readAcceptedRelease' | 'journals' | 'receipts' | 'canRecover'>;
  readTarget(instanceId: string): Promise<DistributionExecutionTarget>;
  isIdle(target: DistributionTransactionTarget): Promise<boolean>;
  /** Product adapters must supply trusted local bytes after source, size/hash, JAR/environment and licence validation. */
  artifact(plan: DistributionPlan, operationIndex: number, signal?: AbortSignal): Promise<string>;
  /** Mandatory domain validation, repeated immediately before the receipt commit under the gameDir lease. */
  validate(plan: DistributionPlan, signal?: AbortSignal): Promise<void>;
  /** Main-owned platform factory; persistent recovery passes the original journal directory identity. */
  createFiles?: NonNullable<DistributionTransactionPorts['createFiles']>;
  fetcher?: typeof fetch; now?: () => number;
  /** Internal document-session bounds. Seen identities are never evicted and reused in this coordinator. */
  lifecycle?: { maxActiveRequests?: number; maxSeenRequests?: number; proposalTtlMs?: number };
}
interface Prepared {
  proposal: DistributionProposal; plan: DistributionPlan; fingerprint: string;
  rootIdentity: AdmissionIntent['gameIdentity']; releaseSha256: string;
}
interface Request { digest: string; controller: AbortController; prepared: Promise<Prepared>; confirming?: Promise<DistributionJournal>; cancelled: boolean; executing: boolean; deadline: number }
export type ExecutionLifecycleCode = 'EXECUTION_ACTIVE_LIMIT' | 'EXECUTION_IDENTITY_LIMIT' | 'EXECUTION_REQUEST_EXPIRED' | 'EXECUTION_REQUEST_FINISHED' | 'EXECUTION_REQUEST_FAILED';
/** Internal lifecycle outcomes; a new document may create a coordinator, but an old request identity is never silently replayed. */
export class DistributionExecutionLifecycleError extends Error {
  constructor(readonly code: ExecutionLifecycleCode) { super(code); this.name = 'DistributionExecutionLifecycleError'; }
}
type Failure = { kind: 'transaction'; code: DistributionTransactionError['code'] } | { kind: 'release'; code: ReleaseError['code'] }
  | { kind: 'storage'; code: StorageError['code'] } | { kind: 'lifecycle'; code: ExecutionLifecycleCode };
type Tombstone = { digest: string; outcome: 'failed' | 'cancelled' | 'expired'; failure: Failure }
  | { digest: string; outcome: 'completed'; planDigest: string; phase: 'committed' | 'rolledBack' };
function failure(error: unknown): Failure {
  if (error instanceof DistributionTransactionError) return { kind: 'transaction', code: error.code };
  if (error instanceof ReleaseError) return { kind: 'release', code: error.code };
  if (error instanceof StorageError) return { kind: 'storage', code: error.code };
  return { kind: 'lifecycle', code: error instanceof DistributionExecutionLifecycleError ? error.code : 'EXECUTION_REQUEST_FAILED' };
}
function failureError(value: Failure): Error {
  if (value.kind === 'transaction') return new DistributionTransactionError(value.code);
  if (value.kind === 'release') return new ReleaseError(value.code);
  if (value.kind === 'storage') return new StorageError(value.code);
  return new DistributionExecutionLifecycleError(value.code);
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function invalid(): never { throw new DistributionTransactionError('INVALID_TRANSACTION'); }

/** Internal, capability-free orchestration. Empty real registries stay empty; no renderer or network execution route is added here. */
export class DistributionExecutionCoordinator {
  private readonly sources: readonly TrustedDistributionSource[];
  private readonly now: () => number;
  private readonly requests = new Map<string, Request>();
  private readonly tombstones = new Map<string, Tombstone>();
  private readonly jobs = new Map<string, Set<Promise<unknown>>>();
  private readonly replays = new Map<string, Promise<DistributionJournal>>();
  private readonly tickets = new Map<string, Promise<Omit<AdmissionIntent, 'confirmRequestId'>>>();
  private readonly maxActive: number;
  private readonly maxSeen: number;
  private readonly proposalTtl: number;
  private readonly transactions: DistributionTransactionService;
  private disposed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: DistributionExecutionOptions) {
    this.sources = structuredClone(options.sources); this.now = options.now ?? Date.now;
    this.maxActive = options.lifecycle?.maxActiveRequests ?? 16; this.maxSeen = options.lifecycle?.maxSeenRequests ?? 1024;
    this.proposalTtl = options.lifecycle?.proposalTtlMs ?? 300000;
    if (!Number.isSafeInteger(this.maxActive) || this.maxActive < 1 || this.maxActive > 16 || !Number.isSafeInteger(this.maxSeen)
      || this.maxSeen < this.maxActive || this.maxSeen > 4096 || !Number.isSafeInteger(this.proposalTtl) || this.proposalTtl < 1 || this.proposalTtl > 300000) invalid();
    this.transactions = new DistributionTransactionService({ journals: options.store.journals, receipts: options.store.receipts,
      readTarget: options.readTarget, isIdle: options.isIdle, artifact: options.artifact,
      ...(options.createFiles ? { createFiles: options.createFiles } : {}),
      canRecover: (txId, token) => options.store.canRecover(txId, token), authorize: (plan, signal) => this.authorize(plan, signal) });
  }
  private track<T>(id: string, promise: Promise<T>): Promise<T> {
    const jobs = this.jobs.get(id) ?? new Set<Promise<unknown>>(); jobs.add(promise); this.jobs.set(id, jobs);
    const finished = (): void => { jobs.delete(promise); if (!jobs.size) this.jobs.delete(id); };
    void promise.then(finished, finished); return promise;
  }
  private activeSize(): number { return new Set([...this.requests.keys(), ...this.jobs.keys()]).size; }
  private terminal(id: string, request: Request, outcome: 'failed' | 'cancelled' | 'expired', error: unknown): void {
    if (this.tombstones.has(id)) return;
    this.requests.delete(id); this.tombstones.set(id, { digest: request.digest, outcome, failure: failure(error) });
  }
  private terminalError(value: Tombstone): Error {
    return value.outcome === 'completed' ? new DistributionExecutionLifecycleError('EXECUTION_REQUEST_FINISHED') : failureError(value.failure);
  }
  private sweep(): void {
    const now = this.now();
    for (const [id, request] of this.requests) if (!request.confirming && now >= request.deadline) {
      request.controller.abort(); this.terminal(id, request, 'expired', new DistributionExecutionLifecycleError('EXECUTION_REQUEST_EXPIRED'));
    }
  }
  private ensurePreparing(id: string, request: Request): void {
    const terminal = this.tombstones.get(id); if (terminal) throw this.terminalError(terminal);
    if (request.cancelled || request.controller.signal.aborted) throw new DistributionTransactionError('CANCELLED');
    if (this.now() >= request.deadline) { request.controller.abort(); throw new DistributionExecutionLifecycleError('EXECUTION_REQUEST_EXPIRED'); }
    this.check();
  }
  private source(sourceId: string): TrustedDistributionSource {
    const source = (this.options.readSources?.() ?? this.sources).find(item => item.sourceId === sourceId);
    if (!source) throw new DistributionTransactionError('UNTRUSTED_DISTRIBUTION'); return structuredClone(source);
  }
  private check(): void { if (this.disposed) throw new DistributionTransactionError('CANCELLED'); }
  private async target(query: { rootId: string; instanceId: string }): Promise<DistributionExecutionTarget> {
    const target = await this.options.readTarget(query.instanceId);
    if (target.rootId !== query.rootId || target.instanceId !== query.instanceId || !Number.isSafeInteger(target.revision) || target.revision < 1) throw new DistributionTransactionError('FILES_CHANGED');
    return target;
  }
  /** Revalidates current key pins and accepted payload immediately before both transaction admission and commit. */
  private async authorize(plan: DistributionPlan, signal?: AbortSignal): Promise<void> {
    const check = (): void => { this.check(); if (signal?.aborted) throw new DistributionTransactionError('CANCELLED'); };
    check(); const source = this.source(plan.sourceId);
    const accepted = await this.options.store.readAcceptedRelease({ sourceId: plan.sourceId, packageId: plan.packageId });
    check();
    if (!accepted) throw new DistributionTransactionError('UNTRUSTED_DISTRIBUTION');
    const { payload, signature } = accepted.envelope; const canonical = canonicalDistributionReleasePayload(payload);
    const trustedSignature = (record: TrustedDistributionSource): boolean => {
      const key = record.keys.find(item => item.keyId === signature.keyId && !item.revoked);
      try { return !!key && verify(null, Buffer.from(canonical), createPublicKey(key.spki), Buffer.from(signature.value, 'base64')); } catch { return false; }
    };
    if (!trustedSignature(source) || createHash('sha256').update(canonical).digest('hex') !== accepted.releaseSha256
      || payload.sourceId !== plan.sourceId || payload.packageId !== plan.packageId || payload.packageVersion !== plan.packageVersion || payload.sequence !== plan.sequence
      || payload.manifestSha256 !== plan.manifestSha256 || transactionDigest(payload.manifest) !== transactionDigest(plan.manifest)) throw new DistributionTransactionError('UNTRUSTED_DISTRIBUTION');
    checkDistributionReleaseTime(payload, this.now());
    const target = await this.target(plan);
    check();
    if (target.revision !== plan.instanceRevision || JSON.stringify(target.environment) !== JSON.stringify(payload.manifest.target)) throw new DistributionTransactionError('FILES_CHANGED');
    await this.options.validate(plan, signal); check();
    checkDistributionReleaseTime(payload, this.now());
    if (!trustedSignature(this.source(plan.sourceId))) throw new DistributionTransactionError('UNTRUSTED_DISTRIBUTION');
  }
  private async snapshot(target: DistributionExecutionTarget, signal: AbortSignal) {
    await guardDirectory(target.gameDir); const before = await lstat(target.gameDir, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || before.ino === 0n) throw new DistributionTransactionError('FILES_CHANGED');
    const receipt = await this.options.store.receipts.read(target.instanceId);
    const files = await observeDistributionFiles(target.gameDir, signal);
    const latest = await this.target(target); const receiptAfter = await this.options.store.receipts.read(target.instanceId);
    await guardDirectory(target.gameDir); const after = await lstat(target.gameDir, { bigint: true });
    if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
      || JSON.stringify(latest) !== JSON.stringify(target) || transactionDigest(receipt ?? null) !== transactionDigest(receiptAfter ?? null)) throw new DistributionTransactionError('FILES_CHANGED');
    const rootIdentity = { dev: String(before.dev), ino: String(before.ino) };
    return { receipt, files, rootIdentity, fingerprint: transactionDigest([target, rootIdentity, receipt ?? null, files]) };
  }
  async prepare(requestId: string, query: DistributionExecutionQuery): Promise<DistributionProposal> {
    this.check();
    if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId) || requestId !== requestId.toLowerCase()
      || !exactObject(query, ['rootId', 'instanceId', 'sourceId', 'packageId', 'packageVersion'])
      || ![query.rootId, query.instanceId].every(value => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase())
      || ![query.sourceId, query.packageId, query.packageVersion].every(value => typeof value === 'string' && identifier.test(value))) invalid();
    this.sweep(); const digest = transactionDigest(query); const terminal = this.tombstones.get(requestId);
    if (terminal) { if (terminal.digest !== digest) invalid(); throw this.terminalError(terminal); }
    const previous = this.requests.get(requestId);
    if (previous) {
      if (previous.digest !== digest) invalid(); const value = await previous.prepared;
      this.ensurePreparing(requestId, previous); return structuredClone(value.proposal);
    }
    if (this.requests.size + this.tombstones.size >= this.maxSeen) throw new DistributionExecutionLifecycleError('EXECUTION_IDENTITY_LIMIT');
    if (this.activeSize() >= this.maxActive) throw new DistributionExecutionLifecycleError('EXECUTION_ACTIVE_LIMIT');
    const controller = new AbortController(); const copied = structuredClone(query);
    const deadline = this.now() + this.proposalTtl;
    const prepared = Promise.resolve().then(() => { this.ensurePreparing(requestId, request); return this.build(requestId, copied, controller.signal, () => { this.ensurePreparing(requestId, request); }); }).then(value => {
      request.deadline = Math.min(deadline, value.proposal.expiresAt); value.proposal.expiresAt = request.deadline;
      this.ensurePreparing(requestId, request); return value;
    }).catch((error: unknown) => {
      this.terminal(requestId, request, error instanceof DistributionExecutionLifecycleError && error.code === 'EXECUTION_REQUEST_EXPIRED' ? 'expired' : 'failed', error);
      throw this.terminalError(this.tombstones.get(requestId)!);
    });
    const request: Request = { digest, controller, prepared, cancelled: false, executing: false, deadline };
    this.requests.set(requestId, request); this.track(requestId, prepared);
    return structuredClone((await prepared).proposal);
  }
  private async build(requestId: string, query: DistributionExecutionQuery, signal: AbortSignal, check: () => void): Promise<Prepared> {
    const source = this.source(query.sourceId); const target = await this.target(query); check();
    const accepted = await new PinnedReleaseSource(source, this.options.store, { ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}), now: this.now }).resolve({ packageId: query.packageId, packageVersion: query.packageVersion, target: target.environment }, signal);
    check(); await this.options.store.saveAcceptedRelease(accepted); check();
    const snapshot = await this.snapshot(target, signal); check(); const payload = accepted.envelope.payload;
    const ledger = snapshot.receipt?.data;
    const ownership = projectDistributionOwnership(snapshot.files, ledger ? { formatVersion: 1, instanceId: target.instanceId, entries: ledger.entries } : undefined, query);
    const diff = distributionDiff(payload.manifest, ownership);
    for (const operation of payload.manifest.operations) if (operation.kind !== 'keep' && operation.area === 'config'
      && snapshot.files.some(file => file.area === 'config' && file.path.toLowerCase() === operation.path.toLowerCase()) && !diff.conflicts.some(conflict => conflict.area === operation.area && conflict.path === operation.path)) {
      diff.conflicts.push({ area: operation.area, path: operation.path, code: 'CHANGED' });
    }
    if (diff.conflicts.length) diff.changes = [];
    const plan: DistributionPlan = { formatVersion: 1, txId: requestId, rootId: query.rootId, instanceId: query.instanceId, instanceRevision: target.revision,
      sourceId: query.sourceId, packageId: query.packageId, packageVersion: query.packageVersion, sequence: payload.sequence, manifestSha256: payload.manifestSha256, manifest: payload.manifest };
    await this.authorize(plan, signal); check();
    return { plan, fingerprint: snapshot.fingerprint, rootIdentity: snapshot.rootIdentity, releaseSha256: accepted.releaseSha256,
      proposal: { proposalId: requestId, ...query, sequence: payload.sequence, instanceRevision: plan.instanceRevision,
        expiresAt: Math.min(this.now() + 300000, payload.expiresAt), changes: diff.changes, conflicts: diff.conflicts } };
  }
  /** Fresh main-owned confirmation material only: no durable admission, task creation or file execution. */
  async ticket(proposalId: string): Promise<Omit<AdmissionIntent, 'confirmRequestId'>> {
    this.check(); this.sweep();
    const terminal = this.tombstones.get(proposalId); if (terminal) throw this.terminalError(terminal);
    const request = this.requests.get(proposalId); if (!request) invalid();
    if (request.confirming || request.executing) throw new DistributionExecutionLifecycleError('EXECUTION_ACTIVE_LIMIT');
    const previous = this.tickets.get(proposalId); if (previous) return structuredClone(await previous);
    const pending = Promise.resolve().then(async () => {
      const prepared = await request.prepared; this.ensurePreparing(proposalId, request);
      if (prepared.proposal.conflicts.length) throw new DistributionTransactionError('FILES_CHANGED');
      const observe = async (): Promise<void> => {
        const target = await this.target(prepared.plan); this.ensurePreparing(proposalId, request);
        const current = await this.snapshot(target, request.controller.signal); this.ensurePreparing(proposalId, request);
        if (current.fingerprint !== prepared.fingerprint || transactionDigest(current.rootIdentity) !== transactionDigest(prepared.rootIdentity)) throw new DistributionTransactionError('FILES_CHANGED');
      };
      await observe();
      await this.authorize(prepared.plan, request.controller.signal); this.ensurePreparing(proposalId, request);
      await observe();
      const accepted = await this.options.store.readAcceptedRelease({ sourceId: prepared.plan.sourceId, packageId: prepared.plan.packageId });
      this.ensurePreparing(proposalId, request);
      if (!accepted || accepted.releaseSha256 !== prepared.releaseSha256) throw new DistributionTransactionError('UNTRUSTED_DISTRIBUTION');
      const { payload, signature } = accepted.envelope; const canonical = canonicalDistributionReleasePayload(payload);
      const key = this.source(prepared.plan.sourceId).keys.find(value => value.keyId === signature.keyId && !value.revoked);
      let trusted = false;
      try { trusted = !!key && verify(null, Buffer.from(canonical), createPublicKey(key.spki), Buffer.from(signature.value, 'base64')); } catch { /* untrusted key */ }
      const plan = prepared.plan;
      if (!trusted || createHash('sha256').update(canonical).digest('hex') !== prepared.releaseSha256
        || payload.sourceId !== plan.sourceId || payload.packageId !== plan.packageId || payload.packageVersion !== plan.packageVersion
        || payload.sequence !== plan.sequence || payload.manifestSha256 !== plan.manifestSha256
        || transactionDigest(payload.manifest) !== transactionDigest(plan.manifest)) throw new DistributionTransactionError('UNTRUSTED_DISTRIBUTION');
      checkDistributionReleaseTime(payload, this.now()); this.ensurePreparing(proposalId, request);
      return { proposalId, plan: prepared.plan, releaseSha256: prepared.releaseSha256,
        gameIdentity: prepared.rootIdentity, previewFingerprint: prepared.fingerprint };
    }).finally(() => { this.tickets.delete(proposalId); });
    this.tickets.set(proposalId, pending);
    return structuredClone(await this.track(proposalId, pending));
  }
  async confirm(proposalId: string): Promise<DistributionJournal> {
    this.check(); this.sweep(); const terminal = this.tombstones.get(proposalId);
    if (terminal) {
      if (terminal.outcome !== 'completed') throw this.terminalError(terminal);
      const previous = this.replays.get(proposalId); if (previous) return structuredClone(await previous);
      if (!this.jobs.has(proposalId) && this.activeSize() >= this.maxActive) throw new DistributionExecutionLifecycleError('EXECUTION_ACTIVE_LIMIT');
      const replay = (async () => {
        const saved = await this.options.store.journals.read(proposalId);
        if (!saved || saved.data.planDigest !== terminal.planDigest || saved.data.phase !== terminal.phase) throw new DistributionTransactionError('NEEDS_RECOVERY');
        return saved.data;
      })().finally(() => { this.replays.delete(proposalId); });
      this.replays.set(proposalId, replay); return structuredClone(await this.track(proposalId, replay));
    }
    if (this.tickets.has(proposalId)) throw new DistributionExecutionLifecycleError('EXECUTION_ACTIVE_LIMIT');
    const request = this.requests.get(proposalId); if (!request) invalid();
    if (request.confirming) return structuredClone(await request.confirming);
    request.confirming = (async () => {
      const prepared = await request.prepared;
      this.ensurePreparing(proposalId, request);
      if (prepared.proposal.conflicts.length) throw new DistributionTransactionError('FILES_CHANGED');
      const target = await this.target(prepared.plan); const current = await this.snapshot(target, request.controller.signal);
      if (current.fingerprint !== prepared.fingerprint) throw new DistributionTransactionError('FILES_CHANGED');
      await this.authorize(prepared.plan, request.controller.signal); this.ensurePreparing(proposalId, request);
      request.executing = true;
      return this.transactions.commit(prepared.plan, request.controller.signal);
    })().then(journal => {
      if (journal.phase !== 'committed' && journal.phase !== 'rolledBack') throw new DistributionTransactionError('NEEDS_RECOVERY');
      this.requests.delete(proposalId); this.tombstones.set(proposalId, { digest: request.digest, outcome: 'completed', planDigest: journal.planDigest, phase: journal.phase });
      return journal;
    }).catch((error: unknown) => {
      this.terminal(proposalId, request, error instanceof DistributionExecutionLifecycleError && error.code === 'EXECUTION_REQUEST_EXPIRED' ? 'expired' : 'failed', error);
      throw this.terminalError(this.tombstones.get(proposalId)!);
    });
    this.track(proposalId, request.confirming); return structuredClone(await request.confirming);
  }
  async cancel(requestId: string): Promise<void> {
    this.check(); this.sweep(); const terminal = this.tombstones.get(requestId);
    if (terminal) {
      if (terminal.outcome === 'completed' && terminal.phase === 'committed') throw new DistributionTransactionError('CANCEL_TOO_LATE');
      return;
    }
    const request = this.requests.get(requestId); if (!request) invalid();
    if (request.confirming && request.executing) await this.transactions.cancel(requestId);
    else { request.cancelled = true; request.controller.abort(); this.terminal(requestId, request, 'cancelled', new DistributionTransactionError('CANCELLED')); }
  }
  async recover(txId: string): Promise<DistributionJournal> {
    this.check(); this.sweep(); if (this.activeSize() >= this.maxActive) throw new DistributionExecutionLifecycleError('EXECUTION_ACTIVE_LIMIT');
    return this.track(txId, this.transactions.recover(txId));
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.disposed = true;
    this.closing = (async () => {
      for (const [id, request] of this.requests) {
        if (request.confirming && request.executing) await this.transactions.cancel(id).catch(() => {});
        else { request.cancelled = true; request.controller.abort(); this.terminal(id, request, 'cancelled', new DistributionTransactionError('CANCELLED')); }
      }
      while (this.jobs.size) await Promise.allSettled([...this.jobs.values()].flatMap(jobs => [...jobs]));
      this.requests.clear(); this.tombstones.clear(); this.replays.clear(); this.tickets.clear();
    })();
    return this.closing;
  }
}
