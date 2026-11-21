import { createHash, randomUUID } from 'node:crypto';
import { applyWorkerEvent, controlTask } from '../../core/task/machine.js';
import type { WorkerEvent } from '../../core/task/machine.js';
import { instanceFailure, InstanceContractError } from '../../shared/contracts/instances.js';
import type { InstanceData, TaskSnapshot } from '../../shared/contracts/instances.js';
import { ResourceContractError } from '../../shared/contracts/resources.js';
import type { LibraryItem, ResourcePayloads, ResourceCode } from '../../shared/contracts/resources.js';
import type { ResourceRecord } from '../storage/resources.js';
import type { StoredTask } from '../storage/tasks.js';
import type { StorageClient } from '../workers/storage-client.js';
import type { InstallerService } from '../install/installer.js';
import type { AdditionalTasks } from '../../ipc/installer-adapter.js';
import { ModrinthClient } from './modrinth.js';
import { hasCode } from '../storage/files.js';

interface Job { task: StoredTask; controller: AbortController; done: Promise<void>; tail: Promise<void>; lastProgress: number }
const terminal = (state: string): boolean => ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(state);
/** Resource tasks use existing SQLite acceptance, object trust, transport and JSON commit recovery. */
export class ResourceService implements AdditionalTasks {
  private readonly jobs = new Map<string, Job>();
  private admissions: Promise<void> = Promise.resolve();
  private indexTail: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private readonly storage: StorageClient, private readonly installer: Pick<InstallerService, 'transferResource' | 'materializeResource'>,
    readonly client = new ModrinthClient()) {}
  private async root(): Promise<string> { const root = await this.storage.readInstallation(); if (!root) throw new ResourceContractError('ROOT_UNAVAILABLE'); return root.data.rootId; }
  private async records(root: string): Promise<ResourceRecord[]> {
    const record = await this.storage.readResources(); if (record && record.data.rootId !== root) throw new ResourceContractError('NEEDS_RECOVERY'); return record?.data.items ?? [];
  }
  private save(root: string, item: ResourceRecord): Promise<void> {
    const pending = this.indexTail.then(async () => {
      const current = await this.storage.readResources(); if (current && current.data.rootId !== root) throw new ResourceContractError('NEEDS_RECOVERY');
      const items = current?.data.items ?? []; await this.storage.writeResources(current?.revision ?? 0, { rootId: root, items: [...items.filter(r => r.taskId !== item.taskId), item] });
    }); this.indexTail = pending.then(() => {}, () => {}); return pending;
  }
  /** Interrupted downloads stay visible and retryable; a completed JSON commit can finish its task. */
  async initialize(): Promise<void> {
    const registration = await this.storage.readInstallation(); if (!registration) return;
    for (const item of await this.records(registration.data.rootId)) {
      const task = await this.storage.get(registration.data.rootId, item.taskId); if (!task || task.kind !== 'download') throw new ResourceContractError('NEEDS_RECOVERY');
      if (terminal(task.execution.state)) continue;
      if (item.downloaded && task.execution.state === 'committing') {
        const next = applyWorkerEvent(task.execution, { kind: 'committed', attempt: task.execution.attempt, sequence: task.execution.lastSequence + 1 }).execution;
        await this.storage.update(task.ownerId, task.taskId, task.execution.revision, next);
      } else {
        const execution = { ...task.execution, state: 'needsRecovery' as const, revision: task.execution.revision + 1 };
        await this.storage.update(task.ownerId, task.taskId, task.execution.revision, execution);
      }
    }
  }
  /** Public library has no paths, URLs, identity UUIDs or private object metadata. */
  async library(): Promise<{ items: LibraryItem[] }> {
    const items = await this.records(await this.root());
    return { items: items.map(item => ({ fileId: item.fileId, taskId: item.taskId, projectId: item.projectId, versionId: item.versionId, kind: item.kind,
      title: item.title, versionName: item.versionName, filename: item.filename, size: item.size, downloaded: item.downloaded, ...(item.errorCode ? { errorCode: item.errorCode } : {}) })) };
  }
  /** Serial admission makes repeated request IDs converge on one durable task. */
  download(requestId: string, input: ResourcePayloads['resources:download']): Promise<{ taskId: string }> {
    const result = this.admissions.then(() => this.admit(requestId, input)); this.admissions = result.then(() => {}, () => {}); return result;
  }
  private async admit(requestId: string, input: ResourcePayloads['resources:download']): Promise<{ taskId: string }> {
    if (this.closed || this.jobs.size >= 4) throw new ResourceContractError('UNAVAILABLE');
    const root = await this.root(); const entries = await this.records(root);
    const existing = entries.find(item => item.projectId === input.projectId && item.versionId === input.versionId && item.spec.expected.digest === input.fileId && (item.downloaded || this.jobs.has(item.taskId)));
    if (existing) return { taskId: existing.taskId };
    if (entries.length >= 512) throw new ResourceContractError('UNAVAILABLE');
    const selected = await this.client.select(input);
    const digest = createHash('sha256').update(JSON.stringify({ projectId: input.projectId, versionId: input.versionId, fileId: input.fileId })).digest('hex');
    const task = await this.storage.accept(root, requestId.toLowerCase(), 'download', digest);
    if (entries.some(item => item.taskId === task.taskId)) return { taskId: task.taskId };
    const record: ResourceRecord = { fileId: input.fileId, taskId: task.taskId, projectId: input.projectId, versionId: input.versionId, kind: selected.kind,
      title: selected.title, versionName: selected.version.name, filename: selected.filename, size: selected.spec.expected.size, downloaded: false, spec: selected.spec };
    await this.save(root, record);
    const job: Job = { task, controller: new AbortController(), done: Promise.resolve(), tail: Promise.resolve(), lastProgress: 0 };
    this.jobs.set(task.taskId, job);
    job.done = this.perform(root, record, job).finally(() => { this.jobs.delete(task.taskId); });
    // Failures remain observable via the durable task; shutdown also joins every active operation.
    void job.done.catch(() => {});
    return { taskId: task.taskId };
  }
  private transition(job: Job, event: Omit<WorkerEvent, 'attempt' | 'sequence'> | { kind: 'progress'; bytesDone: number; bytesTotal: number }): Promise<void> {
    const pending = job.tail.then(async () => {
      const next = applyWorkerEvent(job.task.execution, { ...event, attempt: job.task.execution.attempt, sequence: job.task.execution.lastSequence + 1 } as WorkerEvent).execution;
      if (next !== job.task.execution) job.task = await this.storage.update(job.task.ownerId, job.task.taskId, job.task.execution.revision, next);
    }); job.tail = pending; return pending;
  }
  private async perform(root: string, record: ResourceRecord, job: Job): Promise<void> {
    try {
      job.task = await this.storage.update(root, job.task.taskId, job.task.execution.revision, controlTask(job.task.execution, 'start').execution);
      const object = await this.installer.transferResource(record.spec, job.task.taskId, { signal: job.controller.signal, onProgress: (bytesDone, bytesTotal) => {
        if (Date.now() - job.lastProgress < 300 && bytesDone !== bytesTotal) return; job.lastProgress = Date.now();
        void this.transition(job, { kind: 'progress', bytesDone, bytesTotal }).catch(() => { job.controller.abort(); });
      } });
      await job.tail;
      if (job.controller.signal.aborted) throw new ResourceContractError('UNAVAILABLE');
      await this.transition(job, { kind: 'transferred' });
      if (job.controller.signal.aborted) throw new ResourceContractError('UNAVAILABLE');
      await this.transition(job, { kind: 'verified' });
      // At committing cancellation is too late. JSON publication follows the verified derived view.
      await this.installer.materializeResource(record, object);
      await this.save(root, { ...record, downloaded: true, object });
      await this.transition(job, { kind: 'committed' });
    } catch (error) {
      await job.tail.catch(() => {});
      const known = ['INVALID_TRANSFER', 'NETWORK_FAILED', 'BAD_RESPONSE', 'TIMEOUT', 'CANCELLED', 'DISK_FULL', 'DISK_PERMISSION', 'TRANSFER_IO', 'RETRY_LATER', 'TRANSFER_BUSY', 'HASH_MISMATCH', 'NEEDS_RECOVERY', 'INVALID_CONSUMER', 'QUEUE_FULL', 'WORKER_FAILED'];
      const detail = known.find(code => hasCode(error, code)) ?? 'UNAVAILABLE';
      console.warn(JSON.stringify({ level: 'warn', event: 'resource-download-failed', code: detail }));
      const failure: ResourceCode = hasCode(error, 'HASH_MISMATCH') ? 'HASH_MISMATCH' : hasCode(error, 'NEEDS_RECOVERY') ? 'NEEDS_RECOVERY'
        : hasCode(error, 'TIMEOUT') ? 'TIMEOUT' : hasCode(error, 'RETRY_LATER') ? 'RETRY_LATER' : 'NETWORK_FAILED';
      const persisted = (await this.records(root)).find(item => item.taskId === record.taskId);
      if (!job.controller.signal.aborted && !persisted?.downloaded) await this.save(root, { ...record, errorCode: failure });
      const state = job.task.execution.state;
      if (state === 'committing') {
        job.task = await this.storage.update(root, job.task.taskId, job.task.execution.revision, controlTask(job.task.execution, 'interrupted').execution);
      } else if (job.controller.signal.aborted && !hasCode(error, 'HASH_MISMATCH')) {
        if (state !== 'cancelling') job.task = await this.storage.update(root, job.task.taskId, job.task.execution.revision, controlTask(job.task.execution, 'cancel').execution);
        job.tail = Promise.resolve(); await this.transition(job, { kind: 'cleaned' });
      } else {
        job.tail = Promise.resolve(); await this.transition(job, { kind: 'failed' }); await this.transition(job, { kind: 'cleaned' });
      }
    }
  }
  async get(root: string, taskId: string): Promise<InstanceData['tasks:get'] | undefined> {
    if (!(await this.records(root)).some(item => item.taskId === taskId.toLowerCase())) return undefined;
    return this.taskView(root, taskId);
  }
  private async taskView(root: string, taskId: string): Promise<InstanceData['tasks:get']> {
    const task = this.jobs.get(taskId)?.task ?? await this.storage.get(root, taskId); if (!task || task.kind !== 'download') throw new InstanceContractError('TASK_NOT_FOUND');
    const e = task.execution; const snapshot: TaskSnapshot = { taskId: task.taskId, kind: 'download', state: e.state,
      stage: e.state === 'completed' ? 'completed' : e.state === 'cancelled' ? 'cancelled' : e.state === 'failed' || e.state === 'failing' ? 'failed' : e.state === 'needsRecovery' ? 'needsRecovery' : e.state === 'committing' ? 'committing' : 'downloading',
      revision: e.revision, bytesDone: e.bytesDone, ...(e.bytesTotal === undefined ? {} : { bytesTotal: e.bytesTotal }) };
    if (['failed', 'needsRecovery'].includes(e.state)) { const fail = instanceFailure(randomUUID(), e.state === 'needsRecovery' ? 'NEEDS_RECOVERY' : 'UNAVAILABLE', randomUUID()); if (!fail.ok) snapshot.error = fail.error; }
    return { snapshot };
  }
  async list(root: string): Promise<TaskSnapshot[]> { const result: TaskSnapshot[] = []; for (const item of await this.records(root)) result.push((await this.taskView(root, item.taskId)).snapshot); return result; }
  async cancel(root: string, taskId: string): Promise<void> {
    if (!(await this.records(root)).some(item => item.taskId === taskId)) throw new InstanceContractError('TASK_NOT_FOUND');
    const job = this.jobs.get(taskId); if (!job) throw new InstanceContractError('INVALID_TASK_STATE');
    if (['committing', 'completed'].includes(job.task.execution.state)) throw new InstanceContractError('CANCEL_TOO_LATE');
    job.controller.abort(); await job.done;
  }
  /** Stops admissions and joins cancelled transfers before the shared object owner closes. */
  async close(): Promise<void> { this.closed = true; await this.admissions; for (const job of this.jobs.values()) if (job.task.execution.state !== 'committing') job.controller.abort(); await Promise.allSettled([...this.jobs.values()].map(j => j.done)); await this.indexTail; }
}
