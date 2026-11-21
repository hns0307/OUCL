import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { createExecution } from '../../core/task/machine.js';
import { ReleaseError } from '../../core/distribution/release.js';
import { parseExecution } from '../storage/tasks.js';
import type { DistributionTaskProjection, StoredTask } from '../storage/tasks.js';
import { MAX_RECORD_BYTES } from '../storage/files.js';
import { parseAdmissionRecord } from './admission-record.js';
import type { AdmissionRecord, AdmissionRepository } from './admission-record.js';
import { readAdmittedTerminal } from './admitted-terminal.js';
import type { AdmittedTerminalEvidence, AdmittedTerminalPorts } from './admitted-terminal.js';
import { DistributionTransactionError, transactionDigest } from './transaction-record.js';
import type { DirectoryProof, DistributionPlan } from './transaction-record.js';
import type { DistributionTransactionService } from './transaction.js';

export interface AdmittedExecutionPorts {
  rootId: string;
  admissions: Pick<AdmissionRepository, 'readByProposal'>;
  readProjections(expectedRootId: string): Promise<DistributionTaskProjection[]>;
  claimDistributionTask(expectedRootId: string, proposalId: string, payloadDigest: string, taskId: string): Promise<StoredTask>;
}
interface Dependencies extends AdmittedTerminalPorts {
  transactions: Pick<DistributionTransactionService, 'commitFreshBound' | 'cancel'>;
  protectedFactory: boolean;
  legacyBusy(): boolean;
  busy(): never;
  snapshot(plan: DistributionPlan, signal: AbortSignal): Promise<{ fingerprint: string; rootIdentity: DirectoryProof }>;
  authorize(record: AdmissionRecord, signal: AbortSignal): Promise<void>;
}
function fail(): never { throw new DistributionTransactionError('NEEDS_RECOVERY'); }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase();
function detached<T>(value: T, max: number): T {
  const text = JSON.stringify(value); if (typeof text !== 'string' || Buffer.byteLength(text) > max) fail();
  return structuredClone(value);
}
function task(value: unknown, rootId: string, taskId: string): StoredTask {
  if (!exactObject(value, ['taskId', 'ownerId', 'kind', 'execution']) || value.taskId !== taskId
    || value.ownerId !== rootId || value.kind !== 'distribution-install') fail();
  return { taskId, ownerId: rootId, kind: 'distribution-install', execution: parseExecution(value.execution) };
}
/** Private durable executor. Only the current successful claim acknowledgement permits first effects. */
export class AdmittedExecution {
  private active: { proposalId: string; taskId: string; controller: AbortController; executing: boolean; result: Promise<AdmittedTerminalEvidence> } | undefined;
  private readonly seen = new Set<string>();
  private readonly terminals = new Map<string, AdmittedTerminalEvidence['phase']>();
  private closed = false;
  private readonly rootId: string;
  constructor(private readonly ports: AdmittedExecutionPorts, private readonly deps: Dependencies) {
    if (!uuid(ports.rootId)) throw new DistributionTransactionError('INVALID_TRANSACTION');
    this.rootId = ports.rootId;
  }
  get busy(): boolean { return this.active !== undefined; }
  execute(proposalId: string, taskId: string): Promise<AdmittedTerminalEvidence> {
    if (this.closed) return Promise.reject(new DistributionTransactionError('CANCELLED'));
    if (!uuid(proposalId) || !uuid(taskId)) return Promise.reject(new DistributionTransactionError('INVALID_TRANSACTION'));
    if (this.active) return this.active.proposalId === proposalId && this.active.taskId === taskId
      ? this.active.result.then(value => structuredClone(value)) : Promise.reject(this.busyError());
    if (this.deps.legacyBusy() || !this.seen.has(proposalId) && this.seen.size >= 1024) return Promise.reject(this.busyError());
    this.seen.add(proposalId);
    const controller = new AbortController();
    const result = Promise.resolve().then(() => this.work(proposalId, taskId, controller.signal)).finally(() => { this.active = undefined; });
    this.active = { proposalId, taskId, controller, executing: false, result };
    return result.then(value => structuredClone(value));
  }
  private busyError(): unknown { try { this.deps.busy(); } catch (error) { return error; } }
  private check(signal: AbortSignal): void { if (this.closed || signal.aborted) throw new DistributionTransactionError('CANCELLED'); }
  private async record(proposalId: string, taskId: string): Promise<AdmissionRecord> {
    const raw = await this.ports.admissions.readByProposal(proposalId);
    if (raw === undefined) fail();
    const value = parseAdmissionRecord(detached(raw, MAX_RECORD_BYTES + 128));
    if (value.phase !== 'projected' || value.proposalId !== proposalId || value.taskId !== taskId || value.plan.rootId !== this.rootId) fail();
    return value;
  }
  private async projection(record: AdmissionRecord): Promise<StoredTask> {
    const observed = await this.ports.readProjections(this.rootId);
    if (!Array.isArray(observed) || observed.length > 1024) fail();
    const rows = detached(observed, 4 * 1024 * 1024); const proposals = new Set<string>(); const tasks = new Set<string>();
    let found: StoredTask | undefined;
    for (const row of rows) {
      if (!exactObject(row, ['proposalId', 'payloadDigest', 'task']) || !uuid(row.proposalId)
        || typeof row.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.payloadDigest) || !uuid(row.task?.taskId)) fail();
      const current = task(row.task, this.rootId, row.task.taskId);
      if (proposals.has(row.proposalId) || tasks.has(current.taskId)) fail();
      proposals.add(row.proposalId); tasks.add(current.taskId);
      if (row.proposalId === record.proposalId) {
        if (row.payloadDigest !== record.inputDigest || current.taskId !== record.taskId) fail(); found = current;
      } else if (current.taskId === record.taskId) fail();
    }
    if (!found) fail(); return found;
  }
  private async observe(record: AdmissionRecord, expected: StoredTask, signal: AbortSignal): Promise<void> {
    this.check(signal);
    const current = await this.record(record.proposalId, record.taskId); this.check(signal);
    if (transactionDigest(current) !== transactionDigest(record)) fail();
    const projection = await this.projection(record); this.check(signal);
    if (transactionDigest(projection) !== transactionDigest(expected)) fail();
    const snapshot = await this.deps.snapshot(record.plan, signal); this.check(signal);
    if (snapshot.fingerprint !== record.previewFingerprint || transactionDigest(snapshot.rootIdentity) !== transactionDigest(record.gameIdentity)) throw new DistributionTransactionError('FILES_CHANGED');
  }
  private async work(proposalId: string, taskId: string, signal: AbortSignal): Promise<AdmittedTerminalEvidence> {
    try {
      this.check(signal); const record = await this.record(proposalId, taskId); this.check(signal);
      const projected = await this.projection(record); this.check(signal);
      const terminal = await readAdmittedTerminal(this.rootId, record, this.deps); this.check(signal);
      if (terminal) {
        if (projected.execution.attempt < 1 || projected.execution.state === 'queued') fail();
        const after = await this.record(proposalId, taskId); this.check(signal);
        const afterTask = await this.projection(record); this.check(signal);
        if (transactionDigest(after) !== transactionDigest(record) || transactionDigest(afterTask) !== transactionDigest(projected)) fail();
        this.terminals.set(proposalId, terminal.phase); return terminal;
      }
      if (!this.deps.protectedFactory || transactionDigest(projected.execution) !== transactionDigest(createExecution())) fail();
      await this.observe(record, projected, signal);
      await this.deps.authorize(record, signal); this.check(signal);
      await this.observe(record, projected, signal);
      // No catch/read-back grants permission when this acknowledgement is lost.
      const claimed = task(detached(await this.ports.claimDistributionTask(this.rootId, proposalId, record.inputDigest, taskId), 16384), this.rootId, taskId);
      this.check(signal);
      if (transactionDigest(claimed.execution) !== transactionDigest({ state: 'running', attempt: 1, lastSequence: 0, revision: 2, bytesDone: 0 })) fail();
      await this.observe(record, claimed, signal);
      await this.deps.authorize(record, signal); this.check(signal);
      await this.observe(record, claimed, signal);
      this.check(signal); this.active!.executing = true;
      await this.deps.transactions.commitFreshBound(record.plan, record.gameIdentity, signal);
      // Once commit starts, terminal verification and cleanup must not be interrupted by cancellation.
      const completed = await readAdmittedTerminal(this.rootId, record, this.deps);
      if (!completed) fail(); this.terminals.set(proposalId, completed.phase); return completed;
    } catch (error) {
      if (error instanceof DistributionTransactionError || error instanceof ReleaseError) throw error;
      if (!this.active?.executing && (signal.aborted || this.closed)) throw new DistributionTransactionError('CANCELLED');
      throw new DistributionTransactionError('NEEDS_RECOVERY');
    }
  }
  async cancel(proposalId: string): Promise<boolean> {
    const job = this.active;
    if (job?.proposalId === proposalId) {
      if (job.executing) await this.deps.transactions.cancel(proposalId);
      else job.controller.abort();
      return true;
    }
    const phase = this.terminals.get(proposalId);
    if (phase === 'committed') throw new DistributionTransactionError('CANCEL_TOO_LATE');
    return phase !== undefined;
  }
  async close(): Promise<void> {
    this.closed = true;
    const job = this.active;
    if (job) {
      if (job.executing) await this.deps.transactions.cancel(job.proposalId).catch(() => {});
      else job.controller.abort();
      await Promise.allSettled([job.result]);
    }
    this.seen.clear(); this.terminals.clear();
  }
}
