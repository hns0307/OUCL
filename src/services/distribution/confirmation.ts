import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isDistributionExecutionData, isDistributionExecutionRequest } from '../../shared/contracts/distribution-execution.js';
import type { DistributionExecutionAccepted, DistributionExecutionCode, DistributionExecutionPayloads } from '../../shared/contracts/distribution-execution.js';
import type { TaskSnapshot } from '../../shared/contracts/instances.js';
import { ReleaseError } from '../../core/distribution/release.js';
import { MAX_RECORD_BYTES, StorageError } from '../storage/files.js';
import { parseExecution } from '../storage/tasks.js';
import type { DistributionTaskProjection } from '../storage/tasks.js';
import { MAX_ADMISSION_TOTAL_BYTES, parseAdmissionRecord } from './admission-record.js';
import type { AdmissionIntent, AdmissionRecord, AdmissionRepository } from './admission-record.js';
import { DistributionReconciliationError } from './reconciliation.js';
import type { DistributionReconciliationResult } from './reconciliation.js';
import { DistributionExecutionLifecycleError } from './execution.js';
import { DistributionTransactionError, parseDistributionPlan, transactionDigest } from './transaction-record.js';

type ConfirmationInput = DistributionExecutionPayloads['distribution:confirmExecution'];
type Ticket = Omit<AdmissionIntent, 'confirmRequestId'>;
export interface DistributionConfirmationPorts {
  admissions: Pick<AdmissionRepository, 'readByRequest' | 'readByProposal' | 'admit' | 'bindReceiptAlias'>;
  ticket(proposalId: string): Promise<Ticket>;
  reconcile(): Promise<DistributionReconciliationResult>;
  readProjections(expectedRootId: string): Promise<DistributionTaskProjection[]>;
}
/** Redacted confirmation failures never carry native paths or exception messages. */
export class DistributionConfirmationError extends Error {
  constructor(readonly code: DistributionExecutionCode) { super(code); this.name = 'DistributionConfirmationError'; }
}
function fail(code: DistributionExecutionCode = 'NEEDS_RECOVERY'): never { throw new DistributionConfirmationError(code); }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase();
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function clone<T>(value: T, maxBytes = MAX_RECORD_BYTES + 128): T {
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) fail();
  return structuredClone(value);
}
function record(value: unknown): AdmissionRecord {
  try { return parseAdmissionRecord(clone(value)); } catch { return fail(); }
}
function ticket(value: unknown): Ticket {
  try {
    const raw = clone(value);
    if (!exactObject(raw, ['proposalId', 'plan', 'releaseSha256', 'gameIdentity', 'previewFingerprint'])
      || !uuid(raw.proposalId) || !hash(raw.releaseSha256) || !hash(raw.previewFingerprint)
      || !exactObject(raw.gameIdentity, ['dev', 'ino']) || typeof raw.gameIdentity.dev !== 'string' || !/^\d{1,30}$/.test(raw.gameIdentity.dev)
      || typeof raw.gameIdentity.ino !== 'string' || !/^[1-9]\d{0,29}$/.test(raw.gameIdentity.ino)) fail();
    const plan = parseDistributionPlan(raw.plan); if (plan.txId !== raw.proposalId) fail();
    return { proposalId: raw.proposalId, plan, releaseSha256: raw.releaseSha256,
      gameIdentity: { dev: raw.gameIdentity.dev, ino: raw.gameIdentity.ino }, previewFingerprint: raw.previewFingerprint };
  } catch { return fail(); }
}
function redacted(error: unknown): DistributionConfirmationError {
  if (error instanceof DistributionConfirmationError) return error;
  if (error instanceof StorageError) return new DistributionConfirmationError(error.code === 'REVISION_CONFLICT' ? 'REQUEST_CONFLICT'
    : ['NEEDS_RECOVERY', 'INVALID_RECORD', 'UNSAFE_PATH'].includes(error.code) ? 'NEEDS_RECOVERY' : 'UNAVAILABLE');
  if (error instanceof DistributionReconciliationError) return new DistributionConfirmationError(error.code === 'CLOSED' ? 'UNAVAILABLE' : 'NEEDS_RECOVERY');
  if (error instanceof DistributionTransactionError) {
    const codes: Record<DistributionTransactionError['code'], DistributionExecutionCode> = { INVALID_TRANSACTION: 'INVALID_ARGUMENT',
      UNTRUSTED_DISTRIBUTION: 'UNTRUSTED_DISTRIBUTION', INSTANCE_BUSY: 'INSTANCE_BUSY', FILES_CHANGED: 'FILES_CHANGED',
      NEEDS_RECOVERY: 'NEEDS_RECOVERY', CANCELLED: 'CANCELLED', CANCEL_TOO_LATE: 'CANCEL_TOO_LATE' };
    return new DistributionConfirmationError(codes[error.code]);
  }
  if (error instanceof ReleaseError) return new DistributionConfirmationError(error.code === 'RELEASE_EXPIRED' ? 'RELEASE_EXPIRED'
    : error.code === 'RELEASE_DOWNGRADE' ? 'RELEASE_DOWNGRADE' : error.code === 'RELEASE_EQUIVOCATION' ? 'RELEASE_EQUIVOCATION'
      : error.code === 'CANCELLED' ? 'CANCELLED' : error.code === 'RELEASE_TIMEOUT' ? 'TIMEOUT' : 'UNTRUSTED_DISTRIBUTION');
  if (error instanceof DistributionExecutionLifecycleError) return new DistributionConfirmationError(error.code === 'EXECUTION_REQUEST_EXPIRED' ? 'PROPOSAL_EXPIRED'
    : error.code === 'EXECUTION_ACTIVE_LIMIT' || error.code === 'EXECUTION_IDENTITY_LIMIT' ? 'CAPACITY_EXCEEDED' : 'UNAVAILABLE');
  return new DistributionConfirmationError('UNAVAILABLE');
}

/** Root-owned metadata confirmation only. Neither ticket nor a task projection grants file execution. */
export class DistributionConfirmationService {
  private readonly seen = new Map<string, string>();
  private readonly active = new Map<string, { digest: string; result: Promise<DistributionExecutionAccepted> }>();
  private lane: Promise<void> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly rootId: string, private readonly ports: DistributionConfirmationPorts) {
    if (!uuid(rootId)) fail('INVALID_ARGUMENT');
  }

  private matches(value: AdmissionRecord | Ticket, input: ConfirmationInput): void {
    if (value.proposalId !== input.proposalId || value.plan.rootId !== this.rootId
      || value.plan.instanceRevision !== input.instanceRevision || value.plan.sequence !== input.sequence) fail('REQUEST_CONFLICT');
  }
  private same(value: AdmissionRecord, expected: AdmissionRecord | Ticket): void {
    const digest = 'inputDigest' in expected ? expected.inputDigest : transactionDigest(expected);
    if (value.inputDigest !== digest || 'taskId' in expected && value.taskId !== expected.taskId) fail();
  }
  private async read(requestId: string, input: ConfirmationInput): Promise<AdmissionRecord | undefined> {
    const observed = await this.ports.admissions.readByRequest(requestId);
    if (observed === undefined) return;
    const value = record(observed); this.matches(value, input); return value;
  }
  private async accept(requestId: string, input: ConfirmationInput, expected: AdmissionRecord | Ticket): Promise<AdmissionRecord> {
    let value: AdmissionRecord;
    try {
      const observed = 'inputDigest' in expected
        ? await this.ports.admissions.bindReceiptAlias(this.rootId, requestId, expected.proposalId, expected.inputDigest)
        : await this.ports.admissions.admit({ confirmRequestId: requestId, ...clone(expected) });
      value = record(observed);
    } catch (error) {
      // An acknowledgement may be lost after commit. Resolve only the original durable request identity.
      const saved = await this.read(requestId, input);
      if (!saved) throw error;
      value = saved;
    }
    this.matches(value, input); this.same(value, expected); return value;
  }

  private async projected(value: AdmissionRecord): Promise<TaskSnapshot> {
    const result = clone(await this.ports.reconcile());
    if (!exactObject(result, ['rootId', 'inspected', 'projected']) || result.rootId !== this.rootId
      || !Number.isSafeInteger(result.inspected) || result.inspected < 0 || result.inspected > 1024
      || !Number.isSafeInteger(result.projected) || result.projected < 0 || result.projected > result.inspected) fail();
    const observed = await this.ports.readProjections(this.rootId);
    if (!Array.isArray(observed) || observed.length > 1024 || observed.length !== result.inspected) fail();
    let bytes = 0;
    for (const row of observed) {
      const text = JSON.stringify(row); if (typeof text !== 'string') fail();
      bytes += Buffer.byteLength(text); if (bytes > MAX_ADMISSION_TOTAL_BYTES + 1024 * 128) fail();
    }
    const rows = structuredClone(observed); const proposals = new Set<string>(); const tasks = new Set<string>();
    let snapshot: TaskSnapshot | undefined;
    for (const row of rows) {
      if (!exactObject(row, ['proposalId', 'payloadDigest', 'task']) || !uuid(row.proposalId) || !hash(row.payloadDigest)
        || !exactObject(row.task, ['taskId', 'ownerId', 'kind', 'execution']) || !uuid(row.task.taskId)
        || row.task.ownerId !== this.rootId || row.task.kind !== 'distribution-install'
        || proposals.has(row.proposalId) || tasks.has(row.task.taskId)) fail();
      const execution = parseExecution(row.task.execution);
      proposals.add(row.proposalId); tasks.add(row.task.taskId);
      if (row.proposalId !== value.proposalId) continue;
      if (row.payloadDigest !== value.inputDigest || row.task.taskId !== value.taskId) fail();
      const stage = execution.state === 'queued' || execution.state === 'committing' || execution.state === 'completed'
        || execution.state === 'failed' || execution.state === 'cancelled' || execution.state === 'needsRecovery' ? execution.state : 'preparing';
      snapshot = { taskId: row.task.taskId, kind: 'distribution-install', state: execution.state, stage,
        revision: execution.revision, bytesDone: execution.bytesDone, ...(execution.bytesTotal === undefined ? {} : { bytesTotal: execution.bytesTotal }) };
    }
    if (!snapshot) fail();
    const saved = await this.ports.admissions.readByProposal(value.proposalId);
    if (!saved) fail();
    const after = record(saved); this.same(after, value);
    if (after.phase !== 'projected' || after.plan.rootId !== this.rootId) fail();
    return snapshot;
  }

  private async work(requestId: string, input: ConfirmationInput, digest: string): Promise<DistributionExecutionAccepted> {
    try {
      let value = await this.read(requestId, input);
      if (!value) {
        const previous = this.seen.get(requestId);
        if (previous !== undefined && previous !== digest) fail('REQUEST_CONFLICT');
        if (previous === undefined) {
          if (this.seen.size >= 1024) fail('CAPACITY_EXCEEDED');
          this.seen.set(requestId, digest);
        }
        const byProposal = await this.ports.admissions.readByProposal(input.proposalId);
        if (byProposal !== undefined) {
          const existing = record(byProposal); this.matches(existing, input);
          value = await this.accept(requestId, input, existing);
        } else {
          const material = ticket(await this.ports.ticket(input.proposalId)); this.matches(material, input);
          value = await this.accept(requestId, input, material);
        }
      }
      const accepted = { taskId: value.taskId, proposalId: value.proposalId, snapshot: await this.projected(value) };
      if (!isDistributionExecutionData(accepted, 'distribution:confirmExecution')) fail();
      return accepted;
    } catch (error) { throw redacted(error); }
  }

  /** Confirms or recovers the same durable identity; active callers share work and receive detached receipts. */
  confirm(requestId: string, input: ConfirmationInput): Promise<DistributionExecutionAccepted> {
    if (this.closed) return Promise.reject(new DistributionConfirmationError('UNAVAILABLE'));
    try {
      if (!isDistributionExecutionRequest({ contractVersion: 1, requestId, payload: input }, 'distribution:confirmExecution')) fail('INVALID_ARGUMENT');
      const copied = structuredClone(input); const digest = transactionDigest({ proposalId: copied.proposalId, instanceRevision: copied.instanceRevision, sequence: copied.sequence });
      const pending = this.active.get(requestId);
      if (pending && pending.digest !== digest) fail('REQUEST_CONFLICT');
      if (pending) return pending.result.then(value => structuredClone(value));
      if (this.active.size >= 16) fail('CAPACITY_EXCEEDED');
      const result = this.lane.then(() => this.work(requestId, copied, digest)).finally(() => { this.active.delete(requestId); });
      // Only the scheduling tail absorbs failure; callers retain their original result or rejection.
      this.lane = result.then(() => {}, () => {});
      this.active.set(requestId, { digest, result });
      return result.then(value => structuredClone(value));
    } catch (error) { return Promise.reject(redacted(error)); }
  }

  /** Stops new calls and drains admitted metadata work without cancelling or closing shared services. */
  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => { await Promise.allSettled([...this.active.values()].map(value => value.result)); this.seen.clear(); })();
  }
}
