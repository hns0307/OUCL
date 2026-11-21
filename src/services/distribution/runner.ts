import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { createExecution } from '../../core/task/machine.js';
import { ReleaseError } from '../../core/distribution/release.js';
import { MAX_RECORD_BYTES } from '../storage/files.js';
import { parseExecution } from '../storage/tasks.js';
import type { DistributionTaskProjection, StoredTask } from '../storage/tasks.js';
import { parseAdmissionRecord } from './admission-record.js';
import type { AdmissionRecord, AdmissionRepository } from './admission-record.js';
import { DistributionExecutionLifecycleError } from './execution.js';
import type { DistributionExecutionCoordinator } from './execution.js';
import type { DistributionTaskSettlementService } from './settlement.js';
import { DistributionTransactionError, transactionDigest } from './transaction-record.js';
import { parseDistributionJournal } from './transaction-record.js';
import type { JournalRepository } from './transaction-record.js';

export interface DistributionRunnerPorts {
  admissions: Pick<AdmissionRepository, 'readByProposal'>;
  readProjections(expectedRootId: string): Promise<DistributionTaskProjection[]>;
  coordinator: Pick<DistributionExecutionCoordinator, 'executeAdmitted' | 'cancel'>;
  settlement: Pick<DistributionTaskSettlementService, 'settle'>;
  recovery?: { journals: Pick<JournalRepository, 'read'>; coordinator: Pick<DistributionExecutionCoordinator, 'recoverProtected'> };
}
export class DistributionRunnerError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NEEDS_RECOVERY' | 'INSTANCE_BUSY' | 'CAPACITY_EXCEEDED'
    | 'REQUEST_CONFLICT' | 'UNAVAILABLE' | 'CANCEL_TOO_LATE') { super(code); this.name = 'DistributionRunnerError'; }
}
function fail(): never { throw new DistributionRunnerError('NEEDS_RECOVERY'); }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase();
function snapshot<T>(value: T, limit: number): T {
  const text = JSON.stringify(value); if (typeof text !== 'string' || Buffer.byteLength(text) > limit) fail();
  return structuredClone(value);
}
function stored(value: unknown, rootId: string, taskId: string): StoredTask {
  if (!exactObject(value, ['taskId', 'ownerId', 'kind', 'execution']) || value.taskId !== taskId || value.ownerId !== rootId
    || value.kind !== 'distribution-install') fail();
  return { taskId, ownerId: rootId, kind: 'distribution-install', execution: parseExecution(value.execution) };
}
function pristine(task: StoredTask): boolean { return transactionDigest(task.execution) === transactionDigest(createExecution()); }
function trusted(error: unknown): error is DistributionTransactionError | ReleaseError | DistributionExecutionLifecycleError {
  return error instanceof DistributionTransactionError || error instanceof ReleaseError || error instanceof DistributionExecutionLifecycleError;
}
interface Job {
  proposalId: string; taskId: string; mode: 'run' | 'recover';
  phase: 'reading' | 'executing' | 'recovering' | 'settling'; cancelled: boolean; result: Promise<StoredTask>;
}

/** One root-owned job spans execution and settlement. All execution writers for the root must use this owner;
 * this local mutex cannot stop callers that independently invoke shared coordinators or transactions.
 */
export class DistributionExecutionRunner {
  private readonly rootId: string;
  private readonly seen = new Set<string>();
  private active: Job | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(rootId: string, private readonly ports: DistributionRunnerPorts) {
    if (!uuid(rootId)) throw new DistributionRunnerError('INVALID_ARGUMENT'); this.rootId = rootId;
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
        if (row.payloadDigest !== record.inputDigest || task.taskId !== record.taskId) fail(); found = task;
      } else if (task.taskId === record.taskId) fail();
    }
    if (!found) fail(); return found;
  }
  private async readBound(record: AdmissionRecord): Promise<StoredTask> {
    const current = await this.record(record.proposalId, record.taskId);
    if (transactionDigest(current) !== transactionDigest(record)) fail();
    return this.projection(record);
  }
  private beforeExecution(job: Job): void {
    if (job.cancelled || this.closed) throw new DistributionTransactionError('CANCELLED');
  }
  private async settle(job: Job, record: AdmissionRecord): Promise<StoredTask> {
    job.phase = 'settling';
    const result = stored(snapshot(await this.ports.settlement.settle(record.proposalId, record.taskId), 16384), this.rootId, record.taskId);
    if (!['completed', 'failed'].includes(result.execution.state) || result.execution.attempt !== 1 || result.execution.revision < 3) fail();
    if (transactionDigest(await this.readBound(record)) !== transactionDigest(result)) fail();
    return result;
  }
  private async recoverJob(job: Job, record: AdmissionRecord, task: StoredTask): Promise<StoredTask> {
    const recovery = this.ports.recovery;
    if (!recovery) throw new DistributionRunnerError('UNAVAILABLE');
    if (task.execution.state === 'completed' || task.execution.state === 'failed') return this.settle(job, record);
    if (task.execution.state !== 'needsRecovery' || task.execution.attempt !== 1 || task.execution.revision < 3) fail();
    const raw = await recovery.journals.read(record.proposalId);
    if (!raw) fail();
    const envelope = snapshot(raw, MAX_RECORD_BYTES + 128);
    if (!exactObject(envelope, ['revision', 'data']) || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1) fail();
    const journal = parseDistributionJournal(envelope.data);
    if (journal.planDigest !== transactionDigest(record.plan)
      || transactionDigest(journal.gameIdentity) !== transactionDigest(record.gameIdentity)) fail();
    if (transactionDigest(await this.readBound(record)) !== transactionDigest(task)) fail();
    this.beforeExecution(job);
    job.phase = 'recovering';
    // The transaction checks predecessor ownership, the original lease and the receipt direction.
    await recovery.coordinator.recoverProtected(record.proposalId);
    return this.settle(job, record);
  }
  private async work(job: Job): Promise<StoredTask> {
    try {
      this.beforeExecution(job);
      const record = await this.record(job.proposalId, job.taskId); this.beforeExecution(job);
      const task = await this.projection(record); this.beforeExecution(job);
      if (!this.seen.has(job.proposalId)) {
        if (this.seen.size >= 1024) throw new DistributionRunnerError('CAPACITY_EXCEEDED'); this.seen.add(job.proposalId);
      }
      if (job.mode === 'recover') return await this.recoverJob(job, record, task);
      // Persisted attempts are never restarted. K alone may prove a historical terminal outcome.
      if (['completed', 'failed', 'running', 'needsRecovery'].includes(task.execution.state)) return await this.settle(job, record);
      if (!pristine(task)) fail();
      if (transactionDigest(await this.readBound(record)) !== transactionDigest(task)) fail(); this.beforeExecution(job);
      job.phase = 'executing';
      try {
        await this.ports.coordinator.executeAdmitted(record.proposalId, record.taskId);
      } catch (original) {
        let settled: StoredTask | undefined;
        try { settled = await this.settle(job, record); } catch { /* Resolve below using the exact durable task state. */ }
        if (settled?.execution.state === 'completed') return settled;
        if (settled?.execution.state === 'failed') {
          if (trusted(original)) throw original; return fail();
        }
        const latest = await this.readBound(record);
        // Only a still-pristine task proves that no successful first-start claim was consumed.
        if (pristine(latest) && trusted(original)) throw original;
        return fail();
      }
      return await this.settle(job, record);
    } catch (error) {
      if (error instanceof DistributionRunnerError || trusted(error)) throw error;
      throw new DistributionRunnerError('NEEDS_RECOVERY');
    }
  }
  /** Returns a real durable terminal task, never a thin execution acknowledgement. */
  run(proposalId: string, taskId: string): Promise<StoredTask> {
    return this.start(proposalId, taskId, 'run');
  }
  /** Explicitly recovers a predecessor's journal through the same root slot as new work. */
  recover(proposalId: string, taskId: string): Promise<StoredTask> {
    return this.start(proposalId, taskId, 'recover');
  }
  private start(proposalId: string, taskId: string, mode: Job['mode']): Promise<StoredTask> {
    if (this.closed) return Promise.reject(new DistributionRunnerError('UNAVAILABLE'));
    if (!uuid(proposalId) || !uuid(taskId)) return Promise.reject(new DistributionRunnerError('INVALID_ARGUMENT'));
    const old = this.active;
    if (old) {
      if (old.proposalId === proposalId && old.taskId === taskId && old.mode === mode) return old.result.then(value => structuredClone(value));
      return Promise.reject(new DistributionRunnerError(old.proposalId === proposalId ? 'REQUEST_CONFLICT' : 'INSTANCE_BUSY'));
    }
    const job: Job = { proposalId, taskId, mode, phase: 'reading', cancelled: false,
      result: Promise.resolve().then(() => this.work(job)).finally(() => { this.active = undefined; }) };
    this.active = job;
    return job.result.then(value => structuredClone(value));
  }
  /** Cancels only this owner's active attempt. Settlement cannot be interrupted as a substitute for cancellation. */
  async cancel(proposalId: string): Promise<void> {
    if (!uuid(proposalId)) throw new DistributionRunnerError('INVALID_ARGUMENT');
    const job = this.active;
    if (!job || job.proposalId !== proposalId) fail();
    if (job.phase === 'settling' || job.phase === 'recovering') throw new DistributionRunnerError('CANCEL_TOO_LATE');
    if (job.phase === 'reading') { job.cancelled = true; return; }
    try { await this.ports.coordinator.cancel(proposalId); }
    catch (error) { if (trusted(error)) throw error; throw new DistributionRunnerError('NEEDS_RECOVERY'); }
  }
  /** Stops admission, requests J to stop, then drains J/K. Shared services remain owned by their caller. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; const job = this.active;
    if (job?.phase === 'reading') job.cancelled = true;
    let cancellation: Promise<void> | undefined;
    if (job?.phase === 'executing') {
      try { cancellation = this.ports.coordinator.cancel(job.proposalId).catch(() => {}); }
      catch { /* A throwing wrapper cannot abandon the actual owned job. */ }
    }
    this.closing = (async () => { await cancellation; if (job) await Promise.allSettled([job.result]); this.seen.clear(); })();
    return this.closing;
  }
}
