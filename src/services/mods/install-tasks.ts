import { applyWorkerEvent, controlTask } from '../../core/task/machine.js';
import type { Execution, WorkerEvent } from '../../core/task/machine.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isModCode, ModContractError } from '../../shared/contracts/mods.js';
import type { ModCode } from '../../shared/contracts/mods.js';
import type { ModReport } from '../../shared/contracts/mods-report.js';
import type { StoredTask } from '../storage/tasks.js';
import type { ModTransaction } from '../storage/mod-transactions.js';
import type { StorageClient } from '../workers/storage-client.js';
import type { ModConfirmation, ModInstallPreparation } from './preparation.js';
import { ModPreparationError } from './preparation.js';
import { publicModReport } from './report.js';
import { WorkerError } from '../workers/protocol.js';
import type { ModInstallResult } from '../storage/mod-results.js';
import type { ModTransactionService } from './transaction.js';

type Repository = Pick<StorageClient, 'readInstallation' | 'acceptModConfirmation' | 'readModConfirmations' | 'readModPlan'
  | 'get' | 'update' | 'readModTransaction' | 'readModResult' | 'writeModResult'>;
interface Job { task: StoredTask; controller: AbortController; done: Promise<void>; writes: Promise<void>; committing: boolean }
const terminal = (task: StoredTask): boolean => ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(task.execution.state);

/** Private executor: durable admission precedes downloads, and only a transaction receipt proves completion. */
export class ModInstallTaskService {
  private admission: Promise<void> = Promise.resolve();
  private active: Job | undefined;
  private closed = false;
  private readonly lost = new Set<string>();
  constructor(private readonly storage: Repository, private readonly preparation: Pick<ModInstallPreparation, 'prepare'>,
    private readonly transaction: Pick<ModTransactionService, 'commit' | 'recover'>) {}
  private async root(): Promise<string> {
    const root = await this.storage.readInstallation(); if (!root) throw new ModContractError('ROOT_UNAVAILABLE'); return root.data.rootId;
  }
  private matches(receipt: ModTransaction, task: StoredTask, input: ModConfirmation): boolean {
    return receipt.taskId === task.taskId && receipt.rootId === task.ownerId
      && receipt.planRequestId === input.planRequestId && receipt.planId === input.planId;
  }
  private async change(job: Job, execution: Execution): Promise<void> {
    if (execution === job.task.execution) return;
    job.task = await this.storage.update(job.task.ownerId, job.task.taskId, job.task.execution.revision, execution);
  }
  private event(job: Job, kind: WorkerEvent['kind']): Promise<void> {
    return this.change(job, applyWorkerEvent(job.task.execution, { kind, attempt: job.task.execution.attempt,
      sequence: job.task.execution.lastSequence + 1 } as WorkerEvent).execution);
  }
  private async finish(task: StoredTask, state: ModInstallResult['state'], errorCode?: ModCode, assessment: ModReport | null = null): Promise<StoredTask> {
    const accepted = (await this.storage.readModConfirmations()).find(item => item.task.taskId === task.taskId);
    const plan = accepted && await this.storage.readModPlan(accepted.planRequestId);
    if (!accepted || !plan) throw new ModContractError('NEEDS_RECOVERY');
    const previous = await this.storage.readModResult(task.taskId);
    const data: ModInstallResult = { formatVersion: 1, rootId: task.ownerId, taskId: task.taskId,
      planRequestId: accepted.planRequestId, planId: plan.data.plan.planId, instanceId: plan.data.plan.instanceId,
      instanceRevision: plan.data.plan.instanceRevision, state,
      errorCode: state === 'completed' ? null : state === 'needsRecovery' ? 'NEEDS_RECOVERY' : state === 'cancelled' ? 'CANCELLED' : errorCode ?? 'SCAN_FAILED', assessment };
    if (previous && ['rootId', 'taskId', 'planRequestId', 'planId', 'instanceId', 'instanceRevision'].some(key =>
      previous.data[key as keyof ModInstallResult] !== data[key as keyof ModInstallResult])) throw new ModContractError('NEEDS_RECOVERY');
    if (previous?.data.state !== state || !previous) {
      try { await this.storage.writeModResult(task.taskId, previous?.revision ?? 0, data); }
      catch (error) {
        const persisted = error instanceof WorkerError && ['TIMEOUT', 'REVISION_CONFLICT'].includes(error.code) ? await this.storage.readModResult(task.taskId) : undefined;
        if (!persisted || JSON.stringify(persisted.data) !== JSON.stringify(data)) throw new ModContractError('NEEDS_RECOVERY');
      }
    }
    if (task.execution.state === state) return task;
    return this.storage.update(task.ownerId, task.taskId, task.execution.revision, { ...task.execution, state, revision: task.execution.revision + 1 });
  }
  /** Never repeats interrupted preparation; recovery may only complete/roll back an existing owned transaction. */
  async initialize(): Promise<void> {
    if (!await this.storage.readInstallation()) return;
    for (const accepted of await this.storage.readModConfirmations()) {
      const task = accepted.task; const plan = await this.storage.readModPlan(accepted.planRequestId);
      if (!plan) throw new ModContractError('NEEDS_RECOVERY');
      const input: ModConfirmation = { planRequestId: accepted.planRequestId, planId: plan.data.plan.planId, confirmed: true };
      const stored = await this.storage.readModTransaction(task.taskId);
      const outcome = await this.storage.readModResult(task.taskId);
      if (stored && !this.matches(stored.data, task, input)) throw new ModContractError('NEEDS_RECOVERY');
      if (terminal(task) && task.execution.state !== 'needsRecovery') {
        if (task.execution.state === 'completed' && stored?.data.phase !== 'committed'
          || task.execution.state !== 'completed' && stored && stored.data.phase !== 'rolledBack') throw new ModContractError('NEEDS_RECOVERY');
        await this.finish(task, task.execution.state as ModInstallResult['state']); continue;
      }
      if (!stored) {
        if (outcome && ['failed', 'cancelled'].includes(outcome.data.state)) await this.finish(task, outcome.data.state, outcome.data.errorCode ?? undefined, outcome.data.assessment);
        else await this.finish(task, 'needsRecovery');
        continue;
      }
      try {
        const receipt = await this.transaction.recover(task.taskId);
        if (!this.matches(receipt, task, input)) throw new ModContractError('NEEDS_RECOVERY');
        await this.finish(task, receipt.phase === 'committed' ? 'completed' : receipt.phase === 'rolledBack'
          ? outcome?.data.state === 'cancelled' ? 'cancelled' : 'failed' : 'needsRecovery', outcome?.data.errorCode ?? undefined, outcome?.data.assessment ?? null);
      } catch { await this.finish(task, 'needsRecovery'); }
    }
  }
  confirm(input: ModConfirmation): Promise<{ taskId: string }> {
    if (this.closed) return Promise.reject(new ModContractError('UNAVAILABLE'));
    if (!input || !UUID_PATTERN.test(input.planRequestId) || !/^[a-f0-9]{64}$/.test(input.planId) || input.confirmed !== true
      || Object.keys(input).sort().join(',') !== 'confirmed,planId,planRequestId') return Promise.reject(new ModContractError('INVALID_ARGUMENT'));
    const selected = { ...input, planRequestId: input.planRequestId.toLowerCase() };
    const operation = this.admission.then(async () => {
      if (this.closed) throw new ModContractError('UNAVAILABLE');
      const root = await this.root();
      const previous = (await this.storage.readModConfirmations()).find(item => item.planRequestId === selected.planRequestId);
      if (this.active && !previous) throw new ModContractError('SCAN_BUSY');
      const task = await this.storage.acceptModConfirmation(selected.planRequestId, selected.planId, true);
      if (task.ownerId !== root) throw new ModContractError('NEEDS_RECOVERY');
      if (!previous) {
        const job: Job = { task, controller: new AbortController(), done: Promise.resolve(), writes: Promise.resolve(), committing: false }; this.active = job;
        job.done = this.run(job, selected).catch(() => { this.lost.add(task.taskId); }).finally(() => { if (this.active === job) this.active = undefined; });
      }
      return { taskId: task.taskId };
    });
    this.admission = operation.then(() => {}, () => {}); return operation;
  }
  private async run(job: Job, input: ModConfirmation): Promise<void> {
    try {
      await this.change(job, controlTask(job.task.execution, 'start').execution);
      const prepared = await this.preparation.prepare(input, job.task.taskId, job.controller.signal, progress => {
        const update = job.writes.then(async () => {
          if (job.task.execution.state !== 'running') return;
          await this.change(job, applyWorkerEvent(job.task.execution, { kind: 'progress', attempt: job.task.execution.attempt,
            sequence: job.task.execution.lastSequence + 1, bytesDone: progress.bytesDone, bytesTotal: progress.bytesTotal }).execution);
        }); job.writes = update;
        // Rejection is joined below before the commit boundary, never emitted as an unhandled callback promise.
        void update.catch(() => {});
      });
      await job.writes;
      if (job.controller.signal.aborted) throw new ModContractError('CANCELLED');
      if (prepared.consumerId !== job.task.taskId || prepared.rootId !== job.task.ownerId || prepared.planRequestId !== input.planRequestId
        || prepared.planId !== input.planId) throw new ModContractError('NEEDS_RECOVERY');
      await this.event(job, 'transferred');
      if (job.controller.signal.aborted) throw new ModContractError('CANCELLED');
      job.committing = true; await this.event(job, 'verified');
      const receipt = await this.transaction.commit(prepared);
      if (!this.matches(receipt, job.task, input) || receipt.phase !== 'committed') throw new ModContractError('NEEDS_RECOVERY');
      job.task = await this.finish(job.task, 'completed');
    } catch (error) {
      await job.writes.catch(() => {});
      const receipt = await this.storage.readModTransaction(job.task.taskId);
      if (receipt && !this.matches(receipt.data, job.task, input)) throw new ModContractError('NEEDS_RECOVERY');
      if (receipt?.data.phase === 'committed') {
        const recovered = await this.transaction.recover(job.task.taskId);
        if (recovered.phase !== 'committed' || !this.matches(recovered, job.task, input)) throw new ModContractError('NEEDS_RECOVERY');
        job.task = await this.finish(job.task, 'completed');
      } else if (receipt && receipt.data.phase !== 'rolledBack' || job.task.execution.state === 'committing' && !receipt
        || error instanceof ModContractError && error.code === 'NEEDS_RECOVERY') job.task = await this.finish(job.task, 'needsRecovery');
      else {
        const plan = await this.storage.readModPlan(input.planRequestId); let assessment: ModReport | null = null;
        if (plan && error instanceof ModPreparationError && error.assessment) {
          // Preparation can fail before a real inventory exists. Preserve dependency facts, but never
          // attach issue IDs to files that were not projected into this report's empty inventory.
          const inventory = { instanceId: plan.data.plan.instanceId, revision: plan.data.plan.instanceRevision,
            fingerprint: plan.data.plan.fingerprint, items: [], local: { ...error.assessment.local,
              issues: error.assessment.local.issues.map(issue => ({ ...issue, fileId: '' })) } };
          const states = [error.assessment.local.state, error.assessment.platform.state];
          const state = states.includes('unsatisfied') ? 'unsatisfied' : states.includes('unknown') ? 'unknown' : 'satisfied';
          assessment = publicModReport(inventory, { inventory, platform: { ...error.assessment.platform, state,
            issues: error.assessment.platform.issues.map(issue => ({ ...issue, fileId: '' })) }, platformFailures: [] });
        }
        const code = typeof error === 'object' && error !== null && 'code' in error && isModCode(error.code) ? error.code : 'SCAN_FAILED';
        job.task = await this.finish(job.task, job.controller.signal.aborted ? 'cancelled' : 'failed', code, assessment);
      }
    }
  }
  async get(taskId: string): Promise<StoredTask | undefined> {
    if (!UUID_PATTERN.test(taskId)) throw new ModContractError('INVALID_ARGUMENT');
    const root = await this.root(); const task = await this.storage.get(root, taskId.toLowerCase());
    if (!task || task.kind !== 'mod-install') return undefined;
    return this.lost.has(task.taskId) ? { ...task, execution: { ...task.execution, state: 'needsRecovery' } } : task;
  }
  async cancel(taskId: string): Promise<void> {
    const task = await this.get(taskId); if (!task) throw new ModContractError('TASK_NOT_FOUND');
    if (['committing', 'completed'].includes(task.execution.state)) throw new ModContractError('CANCEL_TOO_LATE');
    if (task.execution.state === 'cancelled') return;
    const job = this.active;
    if (!job || job.task.taskId !== task.taskId || terminal(task)) throw new ModContractError('INVALID_ARGUMENT');
    // Recheck live state after async reads: cancellation cannot race across the commit boundary.
    if (job.committing) throw new ModContractError('CANCEL_TOO_LATE');
    job.controller.abort(); await job.done;
    const final = await this.get(taskId);
    if (final?.execution.state !== 'cancelled') throw new ModContractError(final?.execution.state === 'completed' ? 'CANCEL_TOO_LATE' : 'NEEDS_RECOVERY');
  }
  async close(): Promise<void> {
    this.closed = true; await this.admission; const job = this.active;
    if (job && !job.committing) job.controller.abort();
    await job?.done;
    if (this.lost.size) throw new ModContractError('NEEDS_RECOVERY');
  }
}
