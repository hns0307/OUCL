import { createHash } from 'node:crypto';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { installRelativePath } from '../../core/install/assets.js';
import { canonicalDistributionPayload, parseDistributionManifest } from '../../core/distribution/manifest.js';
import type { DistributionArea, DistributionManifest } from '../../core/distribution/manifest.js';

export class DistributionTransactionError extends Error {
  constructor(readonly code: 'INVALID_TRANSACTION' | 'UNTRUSTED_DISTRIBUTION' | 'INSTANCE_BUSY' | 'FILES_CHANGED' | 'NEEDS_RECOVERY' | 'CANCELLED' | 'CANCEL_TOO_LATE') { super(code); this.name = 'DistributionTransactionError'; }
}
/** Fault injection models abrupt loss of this service, without running its ordinary rollback handler. */
export class SimulatedDistributionCrash extends Error {}
export interface DistributionPlan {
  formatVersion: 1; txId: string; rootId: string; instanceId: string; instanceRevision: number;
  sourceId: string; packageId: string; packageVersion: string; sequence: number; manifestSha256: string; manifest: DistributionManifest;
}
export interface ReceiptClaim { sourceId: string; packageId: string; packageVersion: string; area: DistributionArea; path: string; managedId: string; sha256: string }
export interface ReleaseClaim { sourceId: string; packageId: string; sequence: number; manifestSha256: string }
export interface DistributionReceipt { formatVersion: 1; instanceId: string; txId: string; planDigest: string; entries: ReceiptClaim[]; releases: ReleaseClaim[] }
export interface FileProof { dev: string; ino: string; sha256: string; size: number }
export interface TransactionFile { operationIndex: number; old: FileProof | null; fresh: FileProof | null; stage: 'untouched' | 'backedUp' | 'published' }
export interface DistributionJournal {
  formatVersion: 1; plan: DistributionPlan; planDigest: string; leaseToken: string;
  phase: 'prepared' | 'applying' | 'committed' | 'rolledBack' | 'needsRecovery';
  beforeReceiptRevision: number; beforeReceipt: DistributionReceipt | null; afterReceipt: DistributionReceipt;
  files: TransactionFile[]; pending: { index: number; step: 'backup' | 'publish' } | null;
}
export interface TransactionEnvelope<T> { revision: number; data: T }
/** Implementations must provide durable, atomic CAS writes under a private metadata owner lease. */
export interface JournalRepository {
  read(txId: string): Promise<TransactionEnvelope<DistributionJournal> | undefined>;
  write(txId: string, expectedRevision: number, value: DistributionJournal): Promise<TransactionEnvelope<DistributionJournal>>;
}
/** The private authoritative ledger is the only commit point; game-directory receipts are never consulted. */
export interface ReceiptRepository {
  read(instanceId: string): Promise<TransactionEnvelope<DistributionReceipt> | undefined>;
  commit(instanceId: string, expectedRevision: number, value: DistributionReceipt): Promise<TransactionEnvelope<DistributionReceipt>>;
}
export const transactionDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase();
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function invalid(): never { throw new DistributionTransactionError('INVALID_TRANSACTION'); }
/** Strictly binds the authenticated manifest bytes, publisher sequence, target and operation identity. */
export function parseDistributionPlan(value: unknown): DistributionPlan {
  if (!exactObject(value, ['formatVersion', 'txId', 'rootId', 'instanceId', 'instanceRevision', 'sourceId', 'packageId', 'packageVersion', 'sequence', 'manifestSha256', 'manifest'])
    || value.formatVersion !== 1 || ![value.txId, value.rootId, value.instanceId].every(uuid) || !positive(value.instanceRevision)
    || ![value.sourceId, value.packageId, value.packageVersion].every(id) || !positive(value.sequence) || !hash(value.manifestSha256)) invalid();
  let manifest: DistributionManifest; try { manifest = parseDistributionManifest(value.manifest); } catch { return invalid(); }
  if (typeof manifest.target.loader !== 'string' || manifest.operations.some(operation => typeof operation.area !== 'string' || typeof operation.kind !== 'string')
    || manifest.packageId !== value.packageId || manifest.packageVersion !== value.packageVersion
    || transactionDigest(manifest) !== value.manifestSha256 || canonicalDistributionPayload(manifest) !== JSON.stringify(manifest)) invalid();
  return { formatVersion: 1, txId: String(value.txId), rootId: String(value.rootId), instanceId: String(value.instanceId), instanceRevision: value.instanceRevision,
    sourceId: String(value.sourceId), packageId: String(value.packageId), packageVersion: String(value.packageVersion), sequence: value.sequence, manifestSha256: value.manifestSha256, manifest };
}
/** Ledger evidence is bounded, exact and cannot contain overlapping Windows paths or duplicate release claims. */
export function parseDistributionReceipt(value: unknown): DistributionReceipt {
  if (!exactObject(value, ['formatVersion', 'instanceId', 'txId', 'planDigest', 'entries', 'releases']) || value.formatVersion !== 1
    || !uuid(value.instanceId) || !uuid(value.txId) || !hash(value.planDigest) || !Array.isArray(value.entries) || value.entries.length > 4096
    || !Array.isArray(value.releases) || value.releases.length > 256) invalid();
  const paths: string[] = [];
  for (const claim of value.entries) {
    if (!exactObject(claim, ['sourceId', 'packageId', 'packageVersion', 'area', 'path', 'managedId', 'sha256'])
      || ![claim.sourceId, claim.packageId, claim.packageVersion].every(id) || typeof claim.area !== 'string' || !['mods', 'resourcepacks', 'config'].includes(claim.area)
      || typeof claim.path !== 'string' || !uuid(claim.managedId) || !hash(claim.sha256)) invalid();
    try { installRelativePath(claim.path); } catch { invalid(); }
    const key = `${claim.area}/${claim.path}`.toLowerCase();
    if (paths.some(other => key === other || key.startsWith(other + '/') || other.startsWith(key + '/'))) invalid(); paths.push(key);
  }
  const releases = new Set<string>();
  for (const release of value.releases) {
    if (!exactObject(release, ['sourceId', 'packageId', 'sequence', 'manifestSha256']) || !id(release.sourceId) || !id(release.packageId)
      || !positive(release.sequence) || !hash(release.manifestSha256)) invalid();
    const key = `${release.sourceId}/${release.packageId}`; if (releases.has(key)) invalid(); releases.add(key);
  }
  return structuredClone(value) as unknown as DistributionReceipt;
}
/** Deterministic receipt generation leaves omitted files and other publishers' claims untouched. */
export function transactionReceipt(plan: DistributionPlan, before: DistributionReceipt | null): DistributionReceipt {
  let entries = structuredClone(before?.entries ?? []);
  for (const [index, operation] of plan.manifest.operations.entries()) {
    if (operation.kind === 'keep') continue;
    const key = `${operation.area}/${operation.path}`.toLowerCase();
    entries = entries.filter(entry => `${entry.area}/${entry.path}`.toLowerCase() !== key);
    if (operation.kind !== 'remove') entries.push({ sourceId: plan.sourceId, packageId: plan.packageId, packageVersion: plan.packageVersion,
      area: operation.area, path: operation.path, managedId: operation.kind === 'replace' ? operation.managedId : managedIdentity(plan.txId, index), sha256: operation.sha256 });
  }
  return parseDistributionReceipt({ formatVersion: 1, instanceId: plan.instanceId, txId: plan.txId, planDigest: transactionDigest(plan), entries,
    releases: [...(before?.releases ?? []).filter(entry => entry.sourceId !== plan.sourceId || entry.packageId !== plan.packageId),
      { sourceId: plan.sourceId, packageId: plan.packageId, sequence: plan.sequence, manifestSha256: plan.manifestSha256 }] });
}
function managedIdentity(txId: string, index: number): string {
  const hex = transactionDigest([txId, index]); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function proof(value: unknown): value is FileProof {
  return exactObject(value, ['dev', 'ino', 'sha256', 'size']) && typeof value.dev === 'string' && /^\d+$/.test(value.dev)
    && typeof value.ino === 'string' && /^[1-9]\d*$/.test(value.ino) && hash(value.sha256)
    && typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= 1024 ** 3;
}
/** Unknown formats, altered preparation and illegal pending mutations stop recovery without touching files. */
export function parseDistributionJournal(value: unknown): DistributionJournal {
  if (!exactObject(value, ['formatVersion', 'plan', 'planDigest', 'leaseToken', 'phase', 'beforeReceiptRevision', 'beforeReceipt', 'afterReceipt', 'files', 'pending'])
    || value.formatVersion !== 1 || !hash(value.planDigest) || !uuid(value.leaseToken) || typeof value.phase !== 'string'
    || !['prepared', 'applying', 'committed', 'rolledBack', 'needsRecovery'].includes(value.phase)
    || typeof value.beforeReceiptRevision !== 'number' || !Number.isSafeInteger(value.beforeReceiptRevision) || value.beforeReceiptRevision < 0 || !Array.isArray(value.files)) invalid();
  const plan = parseDistributionPlan(value.plan);
  const before = value.beforeReceipt === null ? null : parseDistributionReceipt(value.beforeReceipt);
  if ((before === null) !== (value.beforeReceiptRevision === 0) || before && before.instanceId !== plan.instanceId || value.planDigest !== transactionDigest(plan)) invalid();
  const prior = before?.releases.find(entry => entry.sourceId === plan.sourceId && entry.packageId === plan.packageId);
  if (prior && prior.sequence >= plan.sequence) invalid();
  const after = parseDistributionReceipt(value.afterReceipt);
  if (transactionDigest(after) !== transactionDigest(transactionReceipt(plan, before))) invalid();
  const operations = plan.manifest.operations.map((operation, index) => ({ operation, index })).filter(item => item.operation.kind !== 'keep');
  if (operations.length !== value.files.length) invalid();
  for (const [index, file] of value.files.entries()) {
    const operation = operations[index]!;
    if (operation.operation.kind === 'keep') invalid();
    if (operation.operation.kind !== 'add') {
      const owned = before?.entries.find(entry => `${entry.area}/${entry.path}`.toLowerCase() === `${operation.operation.area}/${operation.operation.path}`.toLowerCase());
      if (operation.operation.area === 'config' || !owned || owned.sourceId !== plan.sourceId || owned.packageId !== plan.packageId
        || owned.managedId !== operation.operation.managedId || owned.sha256 !== operation.operation.expectedSha256) invalid();
    }
    if (!exactObject(file, ['operationIndex', 'old', 'fresh', 'stage']) || file.operationIndex !== operation.index || typeof file.stage !== 'string'
      || !['untouched', 'backedUp', 'published'].includes(file.stage) || file.old !== null && !proof(file.old) || file.fresh !== null && !proof(file.fresh)) invalid();
    if ((operation.operation.kind === 'add') !== (file.old === null) || (operation.operation.kind === 'remove') !== (file.fresh === null)) invalid();
    if (file.old && (operation.operation.kind === 'add' || file.old.sha256 !== operation.operation.expectedSha256)) invalid();
    if (file.fresh && (operation.operation.kind === 'remove' || file.fresh.sha256 !== operation.operation.sha256 || file.fresh.size !== operation.operation.size)) invalid();
    if (file.stage === 'backedUp' && !file.old || file.stage === 'published' && !file.fresh) invalid();
  }
  if (value.pending !== null) {
    if (!exactObject(value.pending, ['index', 'step']) || typeof value.pending.index !== 'number' || !Number.isInteger(value.pending.index)
      || value.pending.index < 0 || value.pending.index >= value.files.length || typeof value.pending.step !== 'string' || !['backup', 'publish'].includes(value.pending.step) || value.phase !== 'applying') invalid();
    const file = value.files[value.pending.index] as TransactionFile;
    if (value.pending.step === 'backup' ? !file.old || file.stage !== 'untouched' : !file.fresh || file.stage === 'published') invalid();
  }
  if ((value.phase === 'committed' || value.phase === 'rolledBack') && value.pending !== null) invalid();
  if (value.phase === 'prepared' && value.files.some(file => (file as TransactionFile).stage !== 'untouched')) invalid();
  if (value.phase === 'committed' && value.files.some(file => (file as TransactionFile).stage !== ((file as TransactionFile).fresh ? 'published' : 'backedUp'))) invalid();
  return structuredClone(value) as unknown as DistributionJournal;
}

/** CAS repositories must reject attempts to rewrite an operation's immutable proof or resurrect a terminal transaction. */
export function assertDistributionJournalTransition(before: DistributionJournal | undefined, after: DistributionJournal): void {
  after = parseDistributionJournal(after);
  if (!before) { if (after.phase !== 'prepared' || after.pending !== null) invalid(); return; }
  before = parseDistributionJournal(before);
  const immutable = (journal: DistributionJournal): unknown => ({ plan: journal.plan, planDigest: journal.planDigest, leaseToken: journal.leaseToken,
    beforeReceiptRevision: journal.beforeReceiptRevision, beforeReceipt: journal.beforeReceipt, afterReceipt: journal.afterReceipt,
    files: journal.files.map(({ operationIndex, old, fresh }) => ({ operationIndex, old, fresh })) });
  if (transactionDigest(immutable(before)) !== transactionDigest(immutable(after))) invalid();
  if (before.phase === 'committed' || before.phase === 'rolledBack') {
    if (transactionDigest(before) !== transactionDigest(after)) invalid(); return;
  }
  if (after.phase === 'prepared' || before.phase === 'prepared' && after.phase === 'committed') invalid();
  const rank = { untouched: 0, backedUp: 1, published: 2 };
  if (after.files.some((file, index) => rank[file.stage] < rank[before!.files[index]!.stage])) invalid();
}
