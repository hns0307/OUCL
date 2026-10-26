import { createHash, randomUUID } from 'node:crypto';
import { applyWorkerEvent, controlTask } from '../../core/task/machine.js';
import type { Execution, WorkerEvent } from '../../core/task/machine.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isModPayload, isModCode, ModContractError } from '../../shared/contracts/mods.js';
import type { ModCode, ModData } from '../../shared/contracts/mods.js';
import { instanceFailure, InstanceContractError } from '../../shared/contracts/instances.js';
import type { InstanceData, TaskSnapshot } from '../../shared/contracts/instances.js';
import type { StorageClient } from '../workers/storage-client.js';
import type { ModJobRecord, ModJobs, StoredModReport } from '../storage/mod-jobs.js';
import type { StoredTask } from '../storage/tasks.js';
import { WorkerError } from '../workers/protocol.js';
import type { ModInventoryService } from './inventory.js';
import type { ModInspectionService, ModInspectionStage } from './inspection.js';
import { publicModReport } from './report.js';

interface Job { task: StoredTask; record: ModJobRecord; controller: AbortController; done: Promise<void> }
const terminal = (state: string): boolean => ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(state);
function failure(error: unknown): ModCode {
  if (error instanceof WorkerError) return 'NEEDS_RECOVERY';
  if (typeof error === 'object' && error !== null && 'code' in error && isModCode(error.code)) return error.code;
  return 'SCAN_FAILED';
}

/** Durable, read-only Mod work. Common task subscriptions/cancellation can observe it across renderer reconnects. */
export class ModTaskService {
  private readonly jobs = new Map<string, Job>();
  private readonly lost = new Set<string>();
  private admissions: Promise<void> = Promise.resolve();
  private writes: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private readonly storage: StorageClient, private readonly inventory: Pick<ModInventoryService, 'scan'>,
    private readonly inspections: Pick<ModInspectionService, 'check'>) {}

  private async root(): Promise<string> {
    const root = await this.storage.readInstallation(); if (!root) throw new ModContractError('ROOT_UNAVAILABLE'); return root.data.rootId;
  }
  private async index(root: string): Promise<ModJobs> {
    const index = await this.storage.readModJobs();
    if (index && index.data.rootId !== root) throw new ModContractError('NEEDS_RECOVERY');
    return index?.data ?? { formatVersion: 1, rootId: root, items: [] };
  }
  private save(root: string, record: ModJobRecord): Promise<void> {
    const operation = this.writes.then(async () => {
      const current = await this.storage.readModJobs();
      if (current && current.data.rootId !== root) throw new ModContractError('NEEDS_RECOVERY');
      const items = current?.data.items ?? [];
      if (JSON.stringify(items.find(item => item.taskId === record.taskId)) === JSON.stringify(record)) return;
      await this.storage.writeModJobs(current?.revision ?? 0, { formatVersion: 1, rootId: root,
        items: [...items.filter(item => item.taskId !== record.taskId), record] });
    }); this.writes = operation.then(() => {}, () => {}); return operation;
  }
  private validReport(root: string, record: ModJobRecord, stored: StoredModReport): boolean {
    return stored.rootId === root && stored.taskId === record.taskId && stored.report.instanceId === record.instanceId
      && stored.report.instanceRevision === record.instanceRevision && stored.report.mode === record.mode;
  }
  /** Published JSON is the commit proof. Incomplete old reads are never silently rerun against changed files. */
  async initialize(): Promise<void> {
    const registered = await this.storage.readInstallation(); if (!registered) return;
    const root = registered.data.rootId;
    for (const record of (await this.index(root)).items) {
      let task = await this.storage.get(root, record.taskId);
      if (!task || task.kind !== 'mod-check') throw new ModContractError('NEEDS_RECOVERY');
      const published = await this.storage.readModReport(record.taskId);
      if (published) {
        if (!this.validReport(root, record, published.data) || !['completed', 'committing', 'needsRecovery'].includes(task.execution.state)) throw new ModContractError('NEEDS_RECOVERY');
        await this.save(root, { ...record, stage: 'completed', reportRevision: 1, errorCode: null });
        if (task.execution.state !== 'completed') await this.storage.update(root, task.taskId, task.execution.revision,
          { ...task.execution, state: 'completed', revision: task.execution.revision + 1 });
      } else {
        if (record.reportRevision !== 0 || task.execution.state === 'completed') throw new ModContractError('NEEDS_RECOVERY');
        if (!['failed', 'cancelled', 'needsRecovery'].includes(task.execution.state)) task = await this.storage.update(root, task.taskId, task.execution.revision,
          { ...task.execution, state: 'needsRecovery', revision: task.execution.revision + 1 });
        await this.save(root, { ...record, stage: task.execution.state as 'failed' | 'cancelled' | 'needsRecovery',
          errorCode: record.errorCode ?? (task.execution.state === 'cancelled' ? 'CANCELLED' : 'NEEDS_RECOVERY') });
      }
    }
  }
  /** Admission is quick and idempotent; hashing and network work start after durable task/index acceptance. */
  start(requestId: string, mode: 'list' | 'check', input: { instanceId: string; expectedRevision: number }): Promise<{ taskId: string }> {
    const operation = this.admissions.then(() => this.admit(requestId, mode, input));
    this.admissions = operation.then(() => {}, () => {}); return operation;
  }
  private async admit(requestId: string, mode: 'list' | 'check', input: { instanceId: string; expectedRevision: number }): Promise<{ taskId: string }> {
    if (this.closed) throw new ModContractError('UNAVAILABLE');
    if (!UUID_PATTERN.test(requestId) || mode !== 'list' && mode !== 'check' || !isModPayload(input, mode === 'list' ? 'mods:list' : 'mods:check')) throw new ModContractError('INVALID_ARGUMENT');
    const root = await this.root(); const canonical = { instanceId: input.instanceId.toLowerCase(), expectedRevision: input.expectedRevision, mode };
    const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex'); const index = await this.index(root);
    const existing = index.items.find(item => item.requestId === requestId.toLowerCase());
    if (existing) { if (existing.payloadDigest !== digest) throw new ModContractError('REVISION_CONFLICT'); return { taskId: existing.taskId }; }
    if (this.jobs.size) throw new ModContractError('SCAN_BUSY'); if (index.items.length >= 1000) throw new ModContractError('MOD_LIMIT');
    const instances = await this.storage.readInstances(); const instance = instances?.data.items.find(item => item.instanceId === canonical.instanceId && item.rootId === root);
    if (!instance || instance.state !== 'ready') throw new ModContractError('INVALID_ARGUMENT');
    if (instance.revision !== canonical.expectedRevision) throw new ModContractError('REVISION_CONFLICT');
    const task = await this.storage.accept(root, requestId.toLowerCase(), 'mod-check', digest);
    const record: ModJobRecord = { taskId: task.taskId, requestId: requestId.toLowerCase(), payloadDigest: digest, instanceId: canonical.instanceId,
      instanceRevision: canonical.expectedRevision, mode, stage: task.execution.state === 'queued' ? 'queued' : 'needsRecovery', reportRevision: 0,
      errorCode: task.execution.state === 'queued' ? null : 'NEEDS_RECOVERY' };
    await this.save(root, record);
    if (task.execution.state === 'queued') {
      const job: Job = { task, record, controller: new AbortController(), done: Promise.resolve() }; this.jobs.set(task.taskId, job);
      job.done = this.run(root, job).finally(() => { this.jobs.delete(task.taskId); });
      void job.done.catch(() => { this.lost.add(task.taskId); console.warn(JSON.stringify({ level: 'warn', event: 'mod-task-recovery-required', code: 'NEEDS_RECOVERY' })); });
    }
    return { taskId: task.taskId };
  }
  private async change(job: Job, execution: Execution): Promise<void> {
    if (execution !== job.task.execution) job.task = await this.storage.update(job.task.ownerId, job.task.taskId, job.task.execution.revision, execution);
  }
  private event(job: Job, kind: 'transferred' | 'verified' | 'committed' | 'failed' | 'cleaned' | 'progress'): Promise<void> {
    return this.change(job, applyWorkerEvent(job.task.execution, { kind, ...(kind === 'progress' ? { bytesDone: 0 } : {}),
      attempt: job.task.execution.attempt, sequence: job.task.execution.lastSequence + 1 } as WorkerEvent).execution);
  }
  private async run(root: string, job: Job): Promise<void> {
    const check = (): void => { if (job.controller.signal.aborted) throw new ModContractError('CANCELLED'); };
    const progress = async (stage: ModInspectionStage): Promise<void> => {
      check(); if (stage === 'completed') return;
      job.record = { ...job.record, stage }; await this.save(root, job.record); await this.event(job, 'progress'); check();
    };
    try {
      await this.change(job, controlTask(job.task.execution, 'start').execution); check();
      let report;
      if (job.record.mode === 'check') {
        const inspection = await this.inspections.check(job.record.instanceId, job.record.instanceRevision, job.controller.signal, progress);
        report = publicModReport(inspection.inventory, inspection);
      } else {
        await progress('local'); report = publicModReport(await this.inventory.scan(job.record.instanceId, job.record.instanceRevision, job.controller.signal));
      }
      check(); await this.event(job, 'transferred'); check(); await this.event(job, 'verified');
      const published = await this.storage.writeModReport(job.task.taskId, { formatVersion: 1, rootId: root, taskId: job.task.taskId, report });
      job.record = { ...job.record, stage: 'completed', reportRevision: published.revision as 1, errorCode: null };
      await this.save(root, job.record); await this.event(job, 'committed');
    } catch (error) {
      const code = failure(error);
      if (code === 'NEEDS_RECOVERY') {
        const current = await this.storage.get(root, job.task.taskId);
        if (!current || current.kind !== 'mod-check') throw new ModContractError('NEEDS_RECOVERY'); job.task = current;
        if (current.execution.state === 'completed' && job.record.reportRevision === 1) {
          const published = await this.storage.readModReport(job.task.taskId);
          if (!published || !this.validReport(root, job.record, published.data)) throw new ModContractError('NEEDS_RECOVERY');
          job.record = { ...job.record, stage: 'completed', errorCode: null }; await this.save(root, job.record); return;
        }
      }
      if (job.task.execution.state === 'committing' || code === 'NEEDS_RECOVERY') {
        if (!terminal(job.task.execution.state)) await this.change(job, { ...job.task.execution, state: 'needsRecovery', revision: job.task.execution.revision + 1 });
        job.record = { ...job.record, stage: 'needsRecovery', errorCode: job.record.reportRevision ? null : 'NEEDS_RECOVERY' };
        await this.save(root, job.record);
      } else if (code === 'CANCELLED') {
        await this.change(job, controlTask(job.task.execution, 'cancel').execution);
        job.record = { ...job.record, stage: 'cancelled', errorCode: 'CANCELLED' };
        await this.save(root, job.record); await this.event(job, 'cleaned');
      } else {
        await this.event(job, 'failed'); job.record = { ...job.record, stage: 'failed', errorCode: code };
        await this.save(root, job.record); await this.event(job, 'cleaned');
      }
    }
  }
  async report(taskId: string): Promise<ModData['mods:report']> {
    if (!UUID_PATTERN.test(taskId)) throw new ModContractError('INVALID_ARGUMENT');
    const root = await this.root(); const record = (await this.index(root)).items.find(item => item.taskId === taskId.toLowerCase());
    if (!record) throw new ModContractError('TASK_NOT_FOUND'); if (this.lost.has(record.taskId)) throw new ModContractError('NEEDS_RECOVERY');
    const task = await this.storage.get(root, record.taskId);
    if (!task || task.kind !== 'mod-check') throw new ModContractError('NEEDS_RECOVERY');
    if (record.stage !== 'completed' || task?.execution.state !== 'completed') return { report: null, errorCode: record.errorCode };
    const stored = await this.storage.readModReport(record.taskId);
    if (!stored || !this.validReport(root, record, stored.data)) throw new ModContractError('NEEDS_RECOVERY');
    return { report: stored.data.report, errorCode: null };
  }
  async get(root: string, taskId: string): Promise<InstanceData['tasks:get'] | undefined> {
    const record = (await this.index(root)).items.find(item => item.taskId === taskId.toLowerCase()); if (!record) return undefined;
    return this.taskView(root, record);
  }
  private async taskView(root: string, record: ModJobRecord): Promise<InstanceData['tasks:get']> {
    const task = this.jobs.get(record.taskId)?.task ?? await this.storage.get(root, record.taskId);
    if (!task || task.kind !== 'mod-check') throw new InstanceContractError('NEEDS_RECOVERY');
    const execution = task.execution; const state = this.lost.has(record.taskId) ? 'needsRecovery' : execution.state;
    const stage = terminal(state) ? state : state === 'committing' ? 'committing' : 'preparing';
    const snapshot: TaskSnapshot = { taskId: task.taskId, kind: 'mod-check', state, stage: stage as TaskSnapshot['stage'], revision: execution.revision, bytesDone: 0 };
    if (state === 'failed' || state === 'needsRecovery') { const failed = instanceFailure(randomUUID(), state === 'needsRecovery' ? 'NEEDS_RECOVERY' : 'UNAVAILABLE', randomUUID()); if (!failed.ok) snapshot.error = failed.error; }
    return { snapshot };
  }
  async list(root: string): Promise<TaskSnapshot[]> { const snapshots: TaskSnapshot[] = []; for (const record of (await this.index(root)).items) snapshots.push((await this.taskView(root, record)).snapshot); return snapshots; }
  async cancel(root: string, taskId: string): Promise<void> {
    if (!(await this.index(root)).items.some(item => item.taskId === taskId)) throw new InstanceContractError('TASK_NOT_FOUND');
    const job = this.jobs.get(taskId);
    if (!job) {
      const task = await this.storage.get(root, taskId);
      if (task?.execution.state === 'cancelled') return;
      if (task?.execution.state === 'completed' || task?.execution.state === 'committing') throw new InstanceContractError('CANCEL_TOO_LATE');
      throw new InstanceContractError('INVALID_TASK_STATE');
    }
    if (job.task.execution.state === 'committing' || job.task.execution.state === 'completed') throw new InstanceContractError('CANCEL_TOO_LATE');
    job.controller.abort(); await job.done;
  }
  async close(): Promise<void> {
    this.closed = true; await this.admissions;
    for (const job of this.jobs.values()) if (job.task.execution.state !== 'committing') job.controller.abort();
    const results = await Promise.allSettled([...this.jobs.values()].map(job => job.done)); await this.writes;
    if (this.lost.size || results.some(result => result.status === 'rejected')) throw new ModContractError('NEEDS_RECOVERY');
  }
}
