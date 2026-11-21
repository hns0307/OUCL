import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isTaskSnapshot } from '../../shared/contracts/instances.js';
import type { TaskSnapshot } from '../../shared/contracts/instances.js';
import { MAX_RECORD_BYTES } from '../storage/files.js';
import { parseInstallation } from '../storage/installation.js';
import { parseInstanceRecord } from '../storage/instance-records.js';
import { parseExecution } from '../storage/tasks.js';
import type { DistributionTaskProjection, StoredTask } from '../storage/tasks.js';
import type { StorageClient } from '../workers/storage-client.js';
import { MAX_ADMISSION_TOTAL_BYTES, parseAdmissionRecord } from './admission-record.js';
import type { AdmissionRecord, AdmissionRepository } from './admission-record.js';
import { transactionDigest } from './transaction-record.js';

export interface DistributionTaskViewPorts {
  ready(): Promise<void>;
  admissions: Pick<AdmissionRepository, 'readByTask' | 'listAll'>;
  storage: Pick<StorageClient, 'readInstallation' | 'readInstance' | 'get' | 'findAccepted' | 'readDistributionTaskProjections'>;
}
export interface DistributionTaskTarget { instanceId: string; instanceRevision: number; task: TaskSnapshot }
export class DistributionTaskViewError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'UNAVAILABLE' | 'NEEDS_RECOVERY' | 'CAPACITY_EXCEEDED' | 'ROOT_UNAVAILABLE' | 'OUT_OF_SCOPE') {
    super(code); this.name = 'DistributionTaskViewError';
  }
}
function fail(): never { throw new DistributionTaskViewError('NEEDS_RECOVERY'); }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase();
function snapshot<T>(value: T, limit: number): T {
  const text = JSON.stringify(value); if (typeof text !== 'string' || Buffer.byteLength(text) > limit) fail();
  return structuredClone(value);
}
function task(value: unknown, rootId: string, taskId: string): StoredTask {
  if (!exactObject(value, ['taskId', 'ownerId', 'kind', 'execution']) || value.taskId !== taskId || value.ownerId !== rootId
    || value.kind !== 'distribution-install') fail();
  return { taskId, ownerId: rootId, kind: 'distribution-install', execution: parseExecution(value.execution) };
}
function view(stored: StoredTask): TaskSnapshot {
  const execution = stored.execution; const state = execution.state;
  const stage = ['queued', 'committing', 'completed', 'failed', 'cancelled', 'needsRecovery'].includes(state)
    ? state as TaskSnapshot['stage'] : 'preparing';
  const result: TaskSnapshot = { taskId: stored.taskId, kind: 'distribution-install', state, stage,
    revision: execution.revision, bytesDone: execution.bytesDone,
    ...(execution.bytesTotal === undefined ? {} : { bytesTotal: execution.bytesTotal }) };
  if (!isTaskSnapshot(result)) fail(); return result;
}
interface Bound { record: AdmissionRecord; task: StoredTask }

/** Passive root-owned observations. Startup reconciliation must succeed before any task read is admitted. */
export class DistributionTaskViewProvider {
  private readonly rootId: string;
  private readonly gets = new Map<string, Promise<{ snapshot: TaskSnapshot } | undefined>>();
  private readonly targetReads = new Map<string, Promise<DistributionTaskTarget[]>>();
  private listing: Promise<TaskSnapshot[]> | undefined;
  private readonly jobs = new Set<Promise<unknown>>();
  private inventory: Promise<Bound[]> | undefined;
  private startup: Promise<void> | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(rootId: string, private readonly ports: DistributionTaskViewPorts) {
    if (!uuid(rootId)) throw new DistributionTaskViewError('INVALID_ARGUMENT'); this.rootId = rootId;
  }
  private ready(): Promise<void> {
    return this.startup ??= Promise.resolve().then(() => this.ports.ready()).catch(() => { throw new DistributionTaskViewError('UNAVAILABLE'); });
  }
  private full(): boolean { return this.gets.size + this.targetReads.size + (this.listing ? 1 : 0) >= 8; }
  private track<T>(work: Promise<T>): Promise<T> {
    const safe = work.catch((error: unknown) => { throw error instanceof DistributionTaskViewError ? error : new DistributionTaskViewError('NEEDS_RECOVERY'); });
    this.jobs.add(safe); const finished = (): void => { this.jobs.delete(safe); };
    void safe.then(finished, finished); return safe;
  }
  private async root(): Promise<string> {
    const raw = await this.ports.storage.readInstallation();
    if (!raw) throw new DistributionTaskViewError('ROOT_UNAVAILABLE');
    const envelope = snapshot(raw, MAX_RECORD_BYTES + 128);
    if (!exactObject(envelope, ['schemaVersion', 'revision', 'data']) || envelope.schemaVersion !== 1
      || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1) fail();
    const data = parseInstallation(envelope.data);
    if (data.rootId !== this.rootId) throw new DistributionTaskViewError('ROOT_UNAVAILABLE');
    return transactionDigest({ revision: envelope.revision, data });
  }
  private async sameRoot(expected: string): Promise<void> {
    if (await this.root() !== expected) throw new DistributionTaskViewError('ROOT_UNAVAILABLE');
  }
  private parseRecord(raw: AdmissionRecord, taskId?: string): AdmissionRecord {
    const record = parseAdmissionRecord(snapshot(raw, MAX_RECORD_BYTES + 128));
    if (record.plan.rootId !== this.rootId || taskId !== undefined && record.taskId !== taskId) fail();
    return record;
  }
  private async point(taskId: string): Promise<{ snapshot: TaskSnapshot } | undefined> {
    await this.ready(); const root = await this.root();
    const raw = await this.ports.admissions.readByTask(taskId);
    const record = raw === undefined ? undefined : this.parseRecord(raw, taskId);
    const stored = await this.ports.storage.get(this.rootId, taskId);
    if (!record) {
      if (stored?.kind === 'distribution-install') fail();
      // A missing task is not proof that the task database has no dangling request alias.
      const observed = await this.ports.storage.readDistributionTaskProjections(this.rootId);
      if (!Array.isArray(observed) || observed.length > 1024) fail();
      const rows = snapshot(observed, 4 * 1024 * 1024); const ids = new Set<string>(); const tasks = new Set<string>();
      for (const row of rows) {
        if (!exactObject(row, ['proposalId', 'payloadDigest', 'task']) || !uuid(row.proposalId) || !uuid(row.task?.taskId)
          || typeof row.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.payloadDigest)) fail();
        const current = task(row.task, this.rootId, row.task.taskId);
        if (current.taskId === taskId || ids.has(row.proposalId) || tasks.has(current.taskId)) fail();
        ids.add(row.proposalId); tasks.add(current.taskId);
      }
      const after = await this.ports.admissions.readByTask(taskId);
      if (after !== undefined) {
        if (this.parseRecord(after, taskId).phase === 'accepted') throw new DistributionTaskViewError('UNAVAILABLE');
        fail();
      }
      await this.sameRoot(root); return;
    }
    if (record.phase === 'accepted') throw new DistributionTaskViewError('UNAVAILABLE');
    if (!stored) fail();
    const current = task(snapshot(stored, 16384), this.rootId, taskId);
    const accepted = await this.ports.storage.findAccepted(this.rootId, record.proposalId, 'distribution-install', record.inputDigest);
    if (!accepted || transactionDigest(task(snapshot(accepted, 16384), this.rootId, taskId)) !== transactionDigest(current)) fail();
    const after = await this.ports.admissions.readByTask(taskId);
    if (!after || transactionDigest(this.parseRecord(after, taskId)) !== transactionDigest(record)) fail();
    const latest = await this.ports.storage.get(this.rootId, taskId);
    if (!latest || transactionDigest(task(snapshot(latest, 16384), this.rootId, taskId)) !== transactionDigest(current)) fail();
    await this.sameRoot(root); return { snapshot: view(current) };
  }
  private parseInventory(records: AdmissionRecord[], projections: DistributionTaskProjection[]): Bound[] {
    if (!Array.isArray(records) || records.length > 1024 || !Array.isArray(projections) || projections.length > 1024) fail();
    const admissions = snapshot(records, MAX_ADMISSION_TOTAL_BYTES + 1024 * 128);
    const rows = snapshot(projections, 4 * 1024 * 1024);
    const byProposal = new Map<string, AdmissionRecord>(); const allTasks = new Set<string>(); const allIds = new Set<string>();
    let pending = false;
    for (const raw of admissions) {
      const record = parseAdmissionRecord(snapshot(raw, MAX_RECORD_BYTES + 128));
      if (allIds.has(record.proposalId) || allTasks.has(record.taskId)) fail(); allIds.add(record.proposalId); allTasks.add(record.taskId);
      if (record.plan.rootId !== this.rootId) continue;
      byProposal.set(record.proposalId, record); if (record.phase === 'accepted') pending = true;
    }
    const found = new Set<string>(); const taskIds = new Set<string>(); const result: Bound[] = [];
    for (const row of rows) {
      if (!exactObject(row, ['proposalId', 'payloadDigest', 'task']) || !uuid(row.proposalId) || !uuid(row.task?.taskId)) fail();
      const record = byProposal.get(row.proposalId);
      if (!record || row.payloadDigest !== record.inputDigest || row.task.taskId !== record.taskId || found.has(row.proposalId) || taskIds.has(row.task.taskId)) fail();
      found.add(row.proposalId); taskIds.add(row.task.taskId);
      result.push({ record, task: task(row.task, this.rootId, record.taskId) });
    }
    for (const record of byProposal.values()) if (record.phase === 'projected' && !found.has(record.proposalId)) fail();
    if (pending) throw new DistributionTaskViewError('UNAVAILABLE');
    return result.sort((a, b) => a.task.taskId.localeCompare(b.task.taskId));
  }
  private readInventory(): Promise<Bound[]> {
    if (this.inventory) return this.inventory;
    const work = Promise.resolve().then(async () => {
      await this.ready(); const root = await this.root();
      const capture = (raw: AdmissionRecord[]): AdmissionRecord[] => {
        if (!Array.isArray(raw) || raw.length > 1024) fail();
        return snapshot(raw, MAX_ADMISSION_TOTAL_BYTES + 1024 * 128);
      };
      const records = capture(await this.ports.admissions.listAll());
      const projections = await this.ports.storage.readDistributionTaskProjections(this.rootId);
      const first = this.parseInventory(records, projections);
      const secondRecords = capture(await this.ports.admissions.listAll());
      const again = this.parseInventory(secondRecords, await this.ports.storage.readDistributionTaskProjections(this.rootId));
      if (transactionDigest(first) !== transactionDigest(again)) fail(); await this.sameRoot(root); return first;
    }).finally(() => { this.inventory = undefined; });
    this.inventory = this.track(work); return this.inventory;
  }
  private async instance(instanceId: string): Promise<string> {
    const raw = await this.ports.storage.readInstance(instanceId);
    if (!raw) throw new DistributionTaskViewError('OUT_OF_SCOPE');
    const envelope = snapshot(raw, MAX_RECORD_BYTES + 128);
    if (!exactObject(envelope, ['schemaVersion', 'revision', 'data']) || envelope.schemaVersion !== 1
      || !Number.isSafeInteger(envelope.revision) || envelope.revision < 1) fail();
    const record = parseInstanceRecord(envelope.data);
    if (record.summary.revision !== envelope.revision) fail();
    if (record.summary.rootId !== this.rootId || record.summary.instanceId !== instanceId) throw new DistributionTaskViewError('OUT_OF_SCOPE');
    return transactionDigest({ revision: envelope.revision, data: record });
  }
  /** Single-task lookup still retains the repository's full bounded integrity audit. */
  get(taskId: string): Promise<{ snapshot: TaskSnapshot } | undefined> {
    if (this.closed) return Promise.reject(new DistributionTaskViewError('UNAVAILABLE'));
    if (!uuid(taskId)) return Promise.reject(new DistributionTaskViewError('INVALID_ARGUMENT'));
    const old = this.gets.get(taskId); if (old) return old.then(value => structuredClone(value));
    if (this.full()) return Promise.reject(new DistributionTaskViewError('CAPACITY_EXCEEDED'));
    const work = Promise.resolve().then(() => this.point(taskId)).finally(() => { this.gets.delete(taskId); });
    const safe = this.track(work); this.gets.set(taskId, safe); return safe.then(value => structuredClone(value));
  }
  /** Returns all proven tasks without requiring their historical instance to remain registered. */
  list(): Promise<TaskSnapshot[]> {
    if (this.closed) return Promise.reject(new DistributionTaskViewError('UNAVAILABLE'));
    if (this.listing) return this.listing.then(value => structuredClone(value));
    if (this.full()) return Promise.reject(new DistributionTaskViewError('CAPACITY_EXCEEDED'));
    const work = this.readInventory().then(rows => rows.map(row => view(row.task))).finally(() => { this.listing = undefined; });
    this.listing = this.track(work); return this.listing.then(value => structuredClone(value));
  }
  /** Filters only after the complete root inventory is audited. Row revisions are historical admission targets. */
  targets(instanceId: string): Promise<DistributionTaskTarget[]> {
    if (this.closed) return Promise.reject(new DistributionTaskViewError('UNAVAILABLE'));
    if (!uuid(instanceId)) return Promise.reject(new DistributionTaskViewError('INVALID_ARGUMENT'));
    const old = this.targetReads.get(instanceId); if (old) return old.then(value => structuredClone(value));
    if (this.full() || this.targetReads.size >= 2) return Promise.reject(new DistributionTaskViewError('CAPACITY_EXCEEDED'));
    const work = Promise.resolve().then(async () => {
      await this.ready(); const root = await this.root(); const scope = await this.instance(instanceId);
      const rows = await this.readInventory();
      if (await this.instance(instanceId) !== scope) throw new DistributionTaskViewError('OUT_OF_SCOPE');
      await this.sameRoot(root);
      return rows.filter(row => row.record.plan.instanceId === instanceId).map(row => ({ instanceId,
        instanceRevision: row.record.plan.instanceRevision, task: view(row.task) }));
    }).finally(() => { this.targetReads.delete(instanceId); });
    const safe = this.track(work); this.targetReads.set(instanceId, safe); return safe.then(value => structuredClone(value));
  }
  /** Passive reads drain; this provider never cancels shared work or closes shared stores. */
  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => { while (this.jobs.size) await Promise.allSettled([...this.jobs]); })();
  }
}
