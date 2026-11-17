import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { settleDistributionExecution } from '../../core/distribution/task-settlement.js';
import type { Execution } from '../../core/task/machine.js';
import { MAX_RECORD_BYTES } from '../storage/files.js';
import { parseExecution } from '../storage/tasks.js';
import type { DistributionTaskProjection, StoredTask } from '../storage/tasks.js';
import { parseAdmissionRecord } from './admission-record.js';
import type { AdmissionRecord, AdmissionRepository } from './admission-record.js';
import { readAdmittedTerminal } from './admitted-terminal.js';
import { parseDistributionJournal, transactionDigest } from './transaction-record.js';
import type { JournalRepository, ReceiptRepository, TransactionEnvelope, DistributionJournal } from './transaction-record.js';

export interface DistributionSettlementPorts {
  admissions: Pick<AdmissionRepository, 'readByProposal'>;
  readProjections(expectedRootId: string): Promise<DistributionTaskProjection[]>;
  journals: Pick<JournalRepository, 'read'>;
  receipts: Pick<ReceiptRepository, 'read'>;
  updateTask(expectedRootId: string, taskId: string, expectedRevision: number, execution: Execution): Promise<StoredTask>;
}
export class DistributionSettlementError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NEEDS_RECOVERY' | 'CAPACITY_EXCEEDED' | 'REQUEST_CONFLICT' | 'UNAVAILABLE') {
    super(code); this.name = 'DistributionSettlementError';
  }
}
function fail(): never { throw new DistributionSettlementError('NEEDS_RECOVERY'); }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase();
function snapshot<T>(value: T, maximum: number): T {
  const text = JSON.stringify(value); if (typeof text !== 'string' || Buffer.byteLength(text) > maximum) fail();
  return structuredClone(value);
}
function stored(value: unknown, rootId: string, taskId: string): StoredTask {
  if (!exactObject(value, ['taskId', 'ownerId', 'kind', 'execution']) || value.taskId !== taskId || value.ownerId !== rootId
    || value.kind !== 'distribution-install') fail();
  return { taskId, ownerId: rootId, kind: 'distribution-install', execution: parseExecution(value.execution) };
}

/** Metadata-only receipt settlement. It never starts, claims, cancels or replays file operations. */
export class DistributionTaskSettlementService {
  private readonly rootId: string;
  private readonly seen = new Set<string>();
  private readonly active = new Map<string, { taskId: string; result: Promise<StoredTask> }>();
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(rootId: string, private readonly ports: DistributionSettlementPorts) {
    if (!uuid(rootId)) throw new DistributionSettlementError('INVALID_ARGUMENT'); this.rootId = rootId;
  }
  private async record(proposalId: string, taskId: string): Promise<AdmissionRecord> {
    const raw = await this.ports.admissions.readByProposal(proposalId); if (!raw) fail();
    const record = parseAdmissionRecord(snapshot(raw, MAX_RECORD_BYTES + 128));
    if (record.phase !== 'projected' || record.plan.rootId !== this.rootId || record.proposalId !== proposalId || record.taskId !== taskId) fail();
    return record;
  }
  private async projection(record: AdmissionRecord): Promise<StoredTask> {
    const raw = await this.ports.readProjections(this.rootId);
    if (!Array.isArray(raw) || raw.length > 1024) fail();
    const rows = snapshot(raw, 4 * 1024 * 1024); const ids = new Set<string>(); const tasks = new Set<string>();
    let found: StoredTask | undefined;
    for (const row of rows) {
      if (!exactObject(row, ['proposalId', 'payloadDigest', 'task']) || !uuid(row.proposalId)
        || typeof row.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.payloadDigest) || !uuid(row.task?.taskId)) fail();
      const task = stored(row.task, this.rootId, row.task.taskId);
      if (ids.has(row.proposalId) || tasks.has(task.taskId)) fail(); ids.add(row.proposalId); tasks.add(task.taskId);
      if (row.proposalId === record.proposalId) {
        if (task.taskId !== record.taskId || row.payloadDigest !== record.inputDigest) fail(); found = task;
      } else if (task.taskId === record.taskId) fail();
    }
    if (!found) fail(); return found;
  }
  private async unchanged(record: AdmissionRecord, task: StoredTask): Promise<void> {
    const current = await this.record(record.proposalId, record.taskId);
    if (transactionDigest(current) !== transactionDigest(record) || transactionDigest(await this.projection(record)) !== transactionDigest(task)) fail();
  }
  private async journal(record: AdmissionRecord): Promise<TransactionEnvelope<DistributionJournal>> {
    const raw = await this.ports.journals.read(record.proposalId); if (!raw) fail();
    const envelope = snapshot(raw, MAX_RECORD_BYTES + 128);
    if (!exactObject(envelope, ['revision', 'data']) || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1) fail();
    const text = JSON.stringify(envelope.data); if (Buffer.byteLength(text) > MAX_RECORD_BYTES) fail();
    const data = parseDistributionJournal(envelope.data); const digest = transactionDigest(record.plan);
    if (data.planDigest !== digest || transactionDigest(data.plan) !== digest || data.plan.txId !== record.proposalId
      || transactionDigest(data.gameIdentity) !== transactionDigest(record.gameIdentity)) fail();
    return { revision: envelope.revision, data };
  }
  private async historical(record: AdmissionRecord, task: StoredTask): Promise<StoredTask> {
    if (task.execution.attempt !== 1 || task.execution.revision < 3) fail();
    const first = await this.journal(record); const second = await this.journal(record);
    if (transactionDigest(first) !== transactionDigest(second)
      || first.data.phase !== (task.execution.state === 'completed' ? 'committed' : 'rolledBack')) fail();
    await this.unchanged(record, task); return task;
  }
  private async work(proposalId: string, taskId: string): Promise<StoredTask> {
    try {
      const record = await this.record(proposalId, taskId);
      if (!this.seen.has(proposalId)) {
        if (this.seen.size >= 1024) throw new DistributionSettlementError('CAPACITY_EXCEEDED'); this.seen.add(proposalId);
      }
      const task = await this.projection(record);
      if (task.execution.state === 'completed' || task.execution.state === 'failed') return await this.historical(record, task);
      if (task.execution.attempt !== 1 || task.execution.revision < 2 || !['running', 'needsRecovery'].includes(task.execution.state)) fail();
      const terminal = await readAdmittedTerminal(this.rootId, record, this.ports); if (!terminal) fail();
      await this.unchanged(record, task);
      const expected: StoredTask = { ...task, execution: settleDistributionExecution(task.execution, terminal.phase) };
      let result: StoredTask;
      try {
        result = stored(snapshot(await this.ports.updateTask(this.rootId, taskId, task.execution.revision, structuredClone(expected.execution)), 16384), this.rootId, taskId);
      } catch {
        // An unknown CAS outcome is resolved only by an exact durable result, never by another write.
        const after = await this.record(proposalId, taskId);
        if (transactionDigest(after) !== transactionDigest(record)) fail();
        result = await this.projection(record);
      }
      if (transactionDigest(result) !== transactionDigest(expected)) fail();
      await this.unchanged(record, expected);
      return expected;
    } catch (error) { throw error instanceof DistributionSettlementError ? error : new DistributionSettlementError('NEEDS_RECOVERY'); }
  }
  /** Shared in-flight work returns detached metadata. Failed wrong-task calls do not poison the durable identity. */
  settle(proposalId: string, taskId: string): Promise<StoredTask> {
    if (this.closed) return Promise.reject(new DistributionSettlementError('UNAVAILABLE'));
    if (!uuid(proposalId) || !uuid(taskId)) return Promise.reject(new DistributionSettlementError('INVALID_ARGUMENT'));
    const old = this.active.get(proposalId);
    if (old) return old.taskId === taskId ? old.result.then(value => structuredClone(value)) : Promise.reject(new DistributionSettlementError('REQUEST_CONFLICT'));
    if (this.active.size >= 16) return Promise.reject(new DistributionSettlementError('CAPACITY_EXCEEDED'));
    const result = Promise.resolve().then(() => this.work(proposalId, taskId)).finally(() => { this.active.delete(proposalId); });
    this.active.set(proposalId, { taskId, result }); return result.then(value => structuredClone(value));
  }
  /** Stops new requests and drains CAS/read-back settlement without cancelling uncertain writes. */
  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => { await Promise.allSettled([...this.active.values()].map(value => value.result)); this.seen.clear(); })();
  }
}
