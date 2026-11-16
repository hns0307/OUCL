import { createHash, createPublicKey, verify } from 'node:crypto';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { canonicalDistributionReleasePayload, checkDistributionReleaseTime } from '../../core/distribution/release.js';
import { distributionDiff } from '../../core/distribution/manifest.js';
import type { DistributionDiff, DistributionManifest } from '../../core/distribution/manifest.js';
import { projectDistributionOwnership } from '../../core/distribution/ownership.js';
import { observeDistributionFiles } from './preview.js';
import { PinnedReleaseSource } from './release-source.js';
import type { TrustedDistributionSource } from './source.js';
import type { DistributionStore } from './store.js';
import { DistributionTransactionService } from './transaction.js';
import type { DistributionTransactionTarget } from './transaction.js';
import { DistributionTransactionError, transactionDigest } from './transaction-record.js';
import type { DistributionJournal, DistributionPlan } from './transaction-record.js';

export interface DistributionExecutionTarget extends DistributionTransactionTarget { environment: DistributionManifest['target'] }
export interface DistributionExecutionQuery { rootId: string; instanceId: string; sourceId: string; packageId: string; packageVersion: string }
export interface DistributionProposal {
  proposalId: string; rootId: string; instanceId: string; sourceId: string; packageId: string; packageVersion: string;
  sequence: number; expiresAt: number; changes: DistributionDiff['changes']; conflicts: DistributionDiff['conflicts'];
}
export interface DistributionExecutionOptions {
  sources: readonly TrustedDistributionSource[];
  /** Optional main-owned configuration lookup. A key revocation never comes from a renderer or signed package. */
  readSources?(): readonly TrustedDistributionSource[];
  store: Pick<DistributionStore, 'read' | 'compareAndSet' | 'saveAcceptedRelease' | 'readAcceptedRelease' | 'journals' | 'receipts' | 'canRecover'>;
  readTarget(instanceId: string): Promise<DistributionExecutionTarget>;
  isIdle(target: DistributionTransactionTarget): Promise<boolean>;
  /** Product adapters must supply trusted local bytes after source, size/hash, JAR/environment and licence validation. */
  artifact(plan: DistributionPlan, operationIndex: number): Promise<string>;
  /** Mandatory domain validation, repeated immediately before the receipt commit under the gameDir lease. */
  validate(plan: DistributionPlan): Promise<void>;
  fetcher?: typeof fetch; now?: () => number;
}
interface Prepared { proposal: DistributionProposal; plan: DistributionPlan; fingerprint: string }
interface Request { digest: string; controller: AbortController; prepared: Promise<Prepared>; confirming?: Promise<DistributionJournal>; cancelled: boolean; executing: boolean }
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function invalid(): never { throw new DistributionTransactionError('INVALID_TRANSACTION'); }

/** Internal, capability-free orchestration. Empty real registries stay empty; no renderer or network execution route is added here. */
export class DistributionExecutionCoordinator {
  private readonly sources: readonly TrustedDistributionSource[];
  private readonly now: () => number;
  private readonly requests = new Map<string, Request>();
  private readonly transactions: DistributionTransactionService;
  private disposed = false;
  constructor(private readonly options: DistributionExecutionOptions) {
    this.sources = structuredClone(options.sources); this.now = options.now ?? Date.now;
    this.transactions = new DistributionTransactionService({ journals: options.store.journals, receipts: options.store.receipts,
      readTarget: options.readTarget, isIdle: options.isIdle, artifact: options.artifact,
      canRecover: (txId, token) => options.store.canRecover(txId, token), authorize: plan => this.authorize(plan) });
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
  private async authorize(plan: DistributionPlan): Promise<void> {
    this.check(); const source = this.source(plan.sourceId);
    const accepted = await this.options.store.readAcceptedRelease({ sourceId: plan.sourceId, packageId: plan.packageId });
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
    if (target.revision !== plan.instanceRevision || JSON.stringify(target.environment) !== JSON.stringify(payload.manifest.target)) throw new DistributionTransactionError('FILES_CHANGED');
    await this.options.validate(plan); this.check();
    checkDistributionReleaseTime(payload, this.now());
    if (!trustedSignature(this.source(plan.sourceId))) throw new DistributionTransactionError('UNTRUSTED_DISTRIBUTION');
  }
  private async snapshot(target: DistributionExecutionTarget, signal: AbortSignal) {
    const receipt = await this.options.store.receipts.read(target.instanceId);
    const files = await observeDistributionFiles(target.gameDir, signal);
    const latest = await this.target(target); const receiptAfter = await this.options.store.receipts.read(target.instanceId);
    if (JSON.stringify(latest) !== JSON.stringify(target) || transactionDigest(receipt ?? null) !== transactionDigest(receiptAfter ?? null)) throw new DistributionTransactionError('FILES_CHANGED');
    return { receipt, files, fingerprint: transactionDigest([target, receipt ?? null, files]) };
  }
  async prepare(requestId: string, query: DistributionExecutionQuery): Promise<DistributionProposal> {
    this.check();
    if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId) || requestId !== requestId.toLowerCase()
      || !exactObject(query, ['rootId', 'instanceId', 'sourceId', 'packageId', 'packageVersion'])
      || ![query.rootId, query.instanceId].every(value => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase())
      || ![query.sourceId, query.packageId, query.packageVersion].every(value => typeof value === 'string' && identifier.test(value))) invalid();
    const digest = transactionDigest(query); const previous = this.requests.get(requestId);
    if (previous) { if (previous.digest !== digest) invalid(); return structuredClone((await previous.prepared).proposal); }
    if (this.requests.size >= 16) throw new DistributionTransactionError('INSTANCE_BUSY');
    const controller = new AbortController(); const copied = structuredClone(query);
    const prepared = this.build(requestId, copied, controller.signal);
    this.requests.set(requestId, { digest, controller, prepared, cancelled: false, executing: false });
    return structuredClone((await prepared).proposal);
  }
  private async build(requestId: string, query: DistributionExecutionQuery, signal: AbortSignal): Promise<Prepared> {
    const source = this.source(query.sourceId); const target = await this.target(query);
    const accepted = await new PinnedReleaseSource(source, this.options.store, { ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}), now: this.now }).resolve({ packageId: query.packageId, packageVersion: query.packageVersion, target: target.environment }, signal);
    await this.options.store.saveAcceptedRelease(accepted); this.check();
    const snapshot = await this.snapshot(target, signal); const payload = accepted.envelope.payload;
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
    await this.authorize(plan); if (signal.aborted) throw new DistributionTransactionError('CANCELLED');
    return { plan, fingerprint: snapshot.fingerprint, proposal: { proposalId: requestId, ...query, sequence: payload.sequence, expiresAt: Math.min(this.now() + 300000, payload.expiresAt), changes: diff.changes, conflicts: diff.conflicts } };
  }
  async confirm(proposalId: string): Promise<DistributionJournal> {
    this.check(); const request = this.requests.get(proposalId); if (!request) invalid();
    if (request.confirming) return request.confirming;
    request.confirming = (async () => {
      const prepared = await request.prepared;
      if (request.cancelled || request.controller.signal.aborted) throw new DistributionTransactionError('CANCELLED');
      if (this.now() >= prepared.proposal.expiresAt || prepared.proposal.conflicts.length) throw new DistributionTransactionError('FILES_CHANGED');
      const target = await this.target(prepared.plan); const current = await this.snapshot(target, request.controller.signal);
      if (current.fingerprint !== prepared.fingerprint) throw new DistributionTransactionError('FILES_CHANGED');
      await this.authorize(prepared.plan); this.check();
      request.executing = true;
      return this.transactions.commit(prepared.plan, request.controller.signal);
    })();
    return request.confirming;
  }
  async cancel(requestId: string): Promise<void> {
    const request = this.requests.get(requestId); if (!request) invalid();
    if (request.confirming && request.executing) await this.transactions.cancel(requestId);
    else { request.cancelled = true; request.controller.abort(); }
  }
  async recover(txId: string): Promise<DistributionJournal> { this.check(); return this.transactions.recover(txId); }
  async close(): Promise<void> {
    this.disposed = true;
    for (const [id, request] of this.requests) {
      if (request.confirming && request.executing) await this.transactions.cancel(id).catch(() => {}); else request.controller.abort();
    }
    await Promise.allSettled([...this.requests.values()].map(request => request.confirming ?? request.prepared));
  }
}
