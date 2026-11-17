import type { LaunchSettings } from '../storage/settings.js';
import type { ModInstallResult } from '../storage/mod-results.js';
import type { ResourceLibrary } from '../storage/resources.js';
import type { DesktopState } from '../../shared/contracts/desktop.js';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { Execution } from '../../core/task/machine.js';
import type { StoredTask, TaskKind, ModConfirmation } from '../storage/tasks.js';
import { parseReply, parseStorageRequest, WorkerError } from './protocol.js';
import type { StorageCommand } from './protocol.js';
import type { ModTargets, ModTargetsInput } from './mod-targets.js';
import type { IndexedObject } from '../storage/object-index.js';
import type { Installation } from '../storage/installation.js';
import type { RecordEnvelope } from '../storage/records.js';
import type { CatalogCache } from '../storage/catalog-cache.js';
import type { TransferRecord } from '../download/types.js';
import type { InstanceIndex, InstanceRecord } from '../storage/instance-records.js';
import type { LaunchProfiles } from '../storage/launch-profiles.js';
import type { GameSessions } from '../storage/game-sessions.js';
import type { ModJobs, StoredModReport } from '../storage/mod-jobs.js';
import type { StoredModPlan } from '../storage/mod-plans.js';
import type { ModTransaction } from '../storage/mod-transactions.js';
import { OwnerGuard } from '../storage/owner-guard.js';
import { StorageError } from '../storage/files.js';
type StorageData = { task?: StoredTask; object?: IndexedObject; installation?: RecordEnvelope<Installation>; catalog?: RecordEnvelope<CatalogCache>; transfer?: TransferRecord; instances?: RecordEnvelope<InstanceIndex>; instance?: RecordEnvelope<InstanceRecord>; profiles?: RecordEnvelope<LaunchProfiles>; sessions?: RecordEnvelope<GameSessions>; desktop?: RecordEnvelope<DesktopState>; settings?: RecordEnvelope<LaunchSettings>; resources?: RecordEnvelope<ResourceLibrary>; modJobs?: RecordEnvelope<ModJobs>; modReport?: RecordEnvelope<StoredModReport>; modPlan?: RecordEnvelope<StoredModPlan>; modTransaction?: RecordEnvelope<ModTransaction>; modConfirmations?: ModConfirmation[]; modResult?: RecordEnvelope<ModInstallResult>; modTargets?: ModTargets };

interface Pending {
  resolve: (data: StorageData) => void;
  reject: (error: WorkerError) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Single SQLite writer in a worker, with a bounded number of outstanding requests.
 * A response timeout means unknown outcome. It never terminates or rolls back a mutation.
 */
export class StorageClient {
  private readonly pending = new Map<string, Pending>();
  private stopped = false;
  private targetFeature = false;
  /** True only after a new storage worker explicitly advertises its target reader. */
  get supportsModTargets(): boolean { return this.targetFeature; }
  private closing = false;
  private readonly ended: Promise<void>;
  private constructor(private readonly worker: Worker, private readonly timeoutMs: number, private readonly owner?: OwnerGuard) {
    this.ended = new Promise(resolve => { worker.once('exit', () => { this.fail(); resolve(); }); });
    worker.on('error', () => { this.fail(); });
  }

  /** Starts only the repository-owned worker entry; directory is supplied by a trusted platform adapter. */
  static async open(entry: string | URL, directory: string, timeoutMs = 10000): Promise<StorageClient> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new WorkerError('INVALID_MESSAGE');
    let owner: OwnerGuard | undefined;
    try { if (process.platform === 'win32') owner = await OwnerGuard.acquire(directory); }
    catch (error) { throw new WorkerError(error instanceof StorageError ? error.code : 'STORAGE_IO'); }
    let worker: Worker;
    try { worker = new Worker(entry, { workerData: { version: 1, kind: 'storage', directory, ...(owner ? { ownerToken: owner.token } : {}) }, resourceLimits: { maxOldGenerationSizeMb: 128 } }); }
    catch (error) { owner?.abandon(); throw error; }
    const client = new StorageClient(worker, timeoutMs, owner);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new WorkerError('TIMEOUT')); }, timeoutMs);
        const finish = (error?: WorkerError): void => {
          clearTimeout(timer); worker.off('message', receive); worker.off('exit', exited); worker.off('error', failed);
          if (error) reject(error); else resolve();
        };
        const exited = (): void => { finish(new WorkerError('WORKER_FAILED')); };
        const failed = (): void => { finish(new WorkerError('WORKER_FAILED')); };
        const receive = (input: unknown): void => {
          try {
            const reply = parseReply(input);
            if (reply.kind === 'ready') { client.targetFeature = reply.features?.includes('mod-targets.read.v1') ?? false; finish(); }
            else finish(new WorkerError(reply.kind === 'startup-failed' ? reply.code : 'INVALID_MESSAGE'));
          } catch { finish(new WorkerError('INVALID_MESSAGE')); }
        };
        worker.on('message', receive); worker.once('exit', exited); worker.once('error', failed);
      });
      worker.on('message', input => { client.receive(input); });
      return client;
    } catch (error) { await worker.terminate(); await client.ended; owner?.abandon(); throw error; }
  }

  private fail(): void {
    this.stopped = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new WorkerError('WORKER_FAILED')); }
    this.pending.clear();
  }

  private receive(input: unknown): void {
    try {
      const reply = parseReply(input);
      if (reply.kind !== 'response') { this.fail(); void this.worker.terminate(); return; }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.ok) pending.resolve({ ...(reply.task === undefined ? {} : { task: reply.task }), ...(reply.object === undefined ? {} : { object: reply.object }),
        ...(reply.installation === undefined ? {} : { installation: reply.installation }), ...(reply.catalog === undefined ? {} : { catalog: reply.catalog }),
        ...(reply.transfer === undefined ? {} : { transfer: reply.transfer }), ...(reply.instances === undefined ? {} : { instances: reply.instances }),
        ...(reply.instance === undefined ? {} : { instance: reply.instance }), ...(reply.profiles === undefined ? {} : { profiles: reply.profiles }), ...(reply.sessions === undefined ? {} : { sessions: reply.sessions }), ...(reply.settings === undefined ? {} : { settings: reply.settings }), ...(reply.desktop === undefined ? {} : { desktop: reply.desktop }), ...(reply.resources === undefined ? {} : { resources: reply.resources }), ...(reply.modJobs === undefined ? {} : { modJobs: reply.modJobs }), ...(reply.modReport === undefined ? {} : { modReport: reply.modReport }), ...(reply.modPlan === undefined ? {} : { modPlan: reply.modPlan }), ...(reply.modTransaction === undefined ? {} : { modTransaction: reply.modTransaction }), ...(reply.modConfirmations === undefined ? {} : { modConfirmations: reply.modConfirmations }), ...(reply.modResult === undefined ? {} : { modResult: reply.modResult }), ...(reply.modTargets === undefined ? {} : { modTargets: reply.modTargets }) }); else pending.reject(new WorkerError(reply.code));
    } catch { this.fail(); void this.worker.terminate(); }
  }

  private request(command: StorageCommand, shuttingDown = false, untilReply = false): Promise<StorageData> {
    if (this.stopped || this.closing && !shuttingDown) return Promise.reject(new WorkerError('WORKER_FAILED'));
    if (this.pending.size >= 32 && !shuttingDown) return Promise.reject(new WorkerError('QUEUE_FULL'));
    const request = parseStorageRequest({ version: 1, id: randomUUID(), command });
    return new Promise((resolve, reject) => {
      const timer = untilReply ? undefined : setTimeout(() => {
        // Keep the slot until the worker replies/exits: timeouts must not permit an unbounded hidden backlog.
        reject(new WorkerError('TIMEOUT'));
      }, this.timeoutMs);
      this.pending.set(request.id, { resolve, reject, timer });
      try { this.worker.postMessage(request); }
      catch { this.pending.delete(request.id); clearTimeout(timer); reject(new WorkerError('INVALID_MESSAGE')); }
    });
  }

  /** Loads only the request-correlated saved Mod plan domain. */
  async readModTransaction(taskId: string): Promise<RecordEnvelope<ModTransaction> | undefined> {
    return (await this.request({ kind: 'mod-txn:get', taskId })).modTransaction;
  }
  async readModResult(taskId: string): Promise<RecordEnvelope<ModInstallResult> | undefined> {
    return (await this.request({ kind: 'mod-result:get', taskId })).modResult;
  }
  async writeModResult(taskId: string, expectedRevision: number, data: ModInstallResult): Promise<RecordEnvelope<ModInstallResult>> {
    const result = (await this.request({ kind: 'mod-result:set', taskId, expectedRevision, data })).modResult;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  async writeModTransaction(taskId: string, expectedRevision: number, data: ModTransaction): Promise<RecordEnvelope<ModTransaction>> {
    const result = (await this.request({ kind: 'mod-txn:set', taskId, expectedRevision, data })).modTransaction;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  async readModPlan(requestId: string): Promise<RecordEnvelope<StoredModPlan> | undefined> {
    return (await this.request({ kind: 'mod-plan:get', requestId })).modPlan;
  }
  /** Main-only fixed identity projection; application owner comes from the worker's installation record. */
  async projectDistributionTask(expectedRootId: string, proposalId: string, payloadDigest: string, taskId: string): Promise<StoredTask> {
    const result = (await this.request({ kind: 'distribution-task:project', expectedRootId, proposalId, payloadDigest, taskId })).task;
    if (!result || result.kind !== 'distribution-install' || result.taskId !== taskId) throw new WorkerError('INVALID_MESSAGE');
    return result;
  }

  /** Durable admission only; executors must separately revalidate and run the accepted task. */
  async acceptModConfirmation(planRequestId: string, planId: string, confirmed: true): Promise<StoredTask> {
    const result = (await this.request({ kind: 'mod-confirm:accept', planRequestId, planId, confirmed })).task;
    if (!result || result.kind !== 'mod-install') throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  /** Reads proven targets only when the worker has advertised the matching protocol. */
  async readModTargets(input: ModTargetsInput): Promise<ModTargets> {
    if (!this.targetFeature) throw new WorkerError('WORKER_FAILED');
    const result = (await this.request({ kind: 'mod-targets:read', ...input }, false, true)).modTargets;
    if (!result || result.rootId !== input.rootId.toLowerCase() || result.rootRevision !== input.rootRevision
      || result.items.some(item => item.instanceId !== input.instanceId.toLowerCase() || !input.kinds.some(kind => kind === item.task.kind)))
      throw new WorkerError('INVALID_MESSAGE');
    return result;
  }
  async readModConfirmations(): Promise<ModConfirmation[]> {
    const result = (await this.request({ kind: 'mod-confirm:list' })).modConfirmations;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  async writeModPlan(requestId: string, expectedRevision: number, data: StoredModPlan): Promise<RecordEnvelope<StoredModPlan>> {
    const result = (await this.request({ kind: 'mod-plan:set', requestId, expectedRevision, data })).modPlan;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  /** Reads the fixed Mod inspection index. */
  async readModJobs(): Promise<RecordEnvelope<ModJobs> | undefined> { return (await this.request({ kind: 'mod-jobs:get' })).modJobs; }
  async writeModJobs(expectedRevision: number, data: ModJobs): Promise<RecordEnvelope<ModJobs>> {
    const result = (await this.request({ kind: 'mod-jobs:set', expectedRevision, data })).modJobs;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  async readModReport(taskId: string): Promise<RecordEnvelope<StoredModReport> | undefined> {
    return (await this.request({ kind: 'mod-report:get', taskId })).modReport;
  }
  /** Immutable reports have one atomic JSON commit and cannot overwrite an existing observation. */
  async writeModReport(taskId: string, data: StoredModReport): Promise<RecordEnvelope<StoredModReport>> {
    const result = (await this.request({ kind: 'mod-report:set', taskId, expectedRevision: 0, data })).modReport;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }

  /** Reads the fixed resource ownership index. */
  async readResources(): Promise<RecordEnvelope<ResourceLibrary> | undefined> { return (await this.request({ kind: 'resources:get' })).resources; }
  /** CAS-writes bounded resource ownership metadata through the JSON commit journal. */
  async writeResources(expectedRevision: number, data: ResourceLibrary): Promise<RecordEnvelope<ResourceLibrary>> {
    const result = (await this.request({ kind: 'resources:set', expectedRevision, data })).resources;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }

  /** Reads only the fixed launch settings domain. */
  async readDesktop(): Promise<RecordEnvelope<DesktopState> | undefined> { return (await this.request({ kind: 'desktop:get' })).desktop; }
  /** Fixed desktop CAS write using the existing JSON journal and worker. */
  async writeDesktop(expectedRevision: number, data: DesktopState): Promise<RecordEnvelope<DesktopState>> {
    const result = (await this.request({ kind: 'desktop:set', expectedRevision, data })).desktop; if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  /** Reads launch preferences independently of appearance. */
  async readSettings(): Promise<RecordEnvelope<LaunchSettings> | undefined> { return (await this.request({ kind: 'settings:get' })).settings; }
  /** Atomically persists a revision-checked settings change. */
  async writeSettings(expectedRevision: number, data: LaunchSettings): Promise<RecordEnvelope<LaunchSettings>> {
    const value = (await this.request({ kind: 'settings:set', expectedRevision, data })).settings;
    if (!value) throw new WorkerError('INVALID_MESSAGE'); return value;
  }

  /** Reads fixed private session metadata, never arbitrary records or process identifiers. */
  async readGameSessions(): Promise<RecordEnvelope<GameSessions> | undefined> { return (await this.request({ kind: 'sessions:get' })).sessions; }
  /** CAS commit of fixed game-session metadata; does not accept arbitrary record IDs or paths. */
  async writeGameSessions(expectedRevision: number, data: GameSessions): Promise<RecordEnvelope<GameSessions>> {
    const result = (await this.request({ kind: 'sessions:set', expectedRevision, data })).sessions;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  /** Reads only the fixed private Java/offline identity record. */
  async readLaunchProfiles(): Promise<RecordEnvelope<LaunchProfiles> | undefined> { return (await this.request({ kind: 'profiles:get' })).profiles; }
  /** CAS commit of the fixed typed Java/offline profile domain, never arbitrary JSON. */
  async writeLaunchProfiles(expectedRevision: number, data: LaunchProfiles): Promise<RecordEnvelope<LaunchProfiles>> {
    const result = (await this.request({ kind: 'profiles:set', expectedRevision, data })).profiles;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  /** Durable idempotent acceptance; retry with the same business requestId after an unknown outcome. */
  async accept(ownerId: string, requestId: string, taskKind: TaskKind, payloadDigest: string): Promise<StoredTask> {
    const { task } = await this.request({ kind: 'accept', ownerId, requestId, taskKind, payloadDigest });
    if (!task) throw new WorkerError('INVALID_MESSAGE'); return task;
  }

  /** Recovers an exact accepted request without admitting a new task, even after a renderer restart. */
  async findAccepted(ownerId: string, requestId: string, taskKind: TaskKind, payloadDigest: string): Promise<StoredTask | undefined> {
    const { task } = await this.request({ kind: 'find-accepted', ownerId, requestId, taskKind, payloadDigest });
    if (task && (task.ownerId !== ownerId || task.kind !== taskKind)) throw new WorkerError('INVALID_MESSAGE');
    return task;
  }

  /** Queries only the stable owner's task, including after a caller timeout. */
  async get(ownerId: string, taskId: string): Promise<StoredTask | undefined> { return (await this.request({ kind: 'get', ownerId, taskId })).task; }

  /** Saves a transition before its effects run outside the storage worker. */
  async update(ownerId: string, taskId: string, expectedRevision: number, execution: Execution): Promise<StoredTask> {
    const { task } = await this.request({ kind: 'update', ownerId, taskId, expectedRevision, execution });
    if (!task) throw new WorkerError('INVALID_MESSAGE'); return task;
  }

  /** Gets a disposable object hint, never a trust decision. */
  async lookup(sourceKey: string): Promise<IndexedObject | undefined> { return (await this.request({ kind: 'object:lookup', sourceKey })).object; }
  /** Saves a search hint after authoritative object/provenance verification. */
  async remember(sourceKey: string, object: IndexedObject): Promise<void> { await this.request({ kind: 'object:remember', sourceKey, object }); }
  /** Resets only the independent search cache for a provenance-based rebuild. */
  async clear(): Promise<void> { await this.request({ kind: 'object:clear' }); }
  /** Reads the fixed data-directory registration, privately within the main process. */
  async readInstallation(): Promise<RecordEnvelope<Installation> | undefined> { return (await this.request({ kind: 'installation:get' })).installation; }
  /** Registers once; migration/overwriting an existing data location is intentionally unavailable. */
  async createInstallation(data: Installation): Promise<RecordEnvelope<Installation>> {
    const result = (await this.request({ kind: 'installation:set', data })).installation;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  /** Reads the validated official catalog cache privately in the main process. */
  async readCatalog(): Promise<RecordEnvelope<CatalogCache> | undefined> { return (await this.request({ kind: 'catalog:get' })).catalog; }
  /** Atomically updates the fixed cache record through the existing recovery journal. */
  async writeCatalog(expectedRevision: number, data: CatalogCache): Promise<RecordEnvelope<CatalogCache>> {
    const result = (await this.request({ kind: 'catalog:set', expectedRevision, data })).catalog;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  /** Reads authoritative transfer identity and its fsynced prefix, never a disposable search hint. */
  async getTransfer(key: string): Promise<TransferRecord | undefined> { return (await this.request({ kind: 'transfer:get', key })).transfer; }
  /** Persists a revision-checked transfer checkpoint in SQLite before acknowledging it to the downloader. */
  async saveTransfer(expectedRevision: number, record: TransferRecord): Promise<void> { await this.request({ kind: 'transfer:set', expectedRevision, record }); }
  /** Reads the fixed instance index without interpreting a list entry as proof of completed installation. */
  async readInstances(): Promise<RecordEnvelope<InstanceIndex> | undefined> { return (await this.request({ kind: 'instances:get' })).instances; }
  /** CAS-writes only the bounded typed instance index, through the existing JSON commit journal. */
  async writeInstances(expectedRevision: number, data: InstanceIndex): Promise<RecordEnvelope<InstanceIndex>> {
    const result = (await this.request({ kind: 'instances:set', expectedRevision, data })).instances;
    if (!result) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  /** Reads one UUID-bound installation record; no caller-controlled record name is accepted. */
  async readInstance(instanceId: string): Promise<RecordEnvelope<InstanceRecord> | undefined> {
    const result = (await this.request({ kind: 'instance:get', instanceId })).instance;
    if (result && result.data.summary.instanceId !== instanceId.toLowerCase()) throw new WorkerError('INVALID_MESSAGE'); return result;
  }
  /** CAS-writes a private installation checkpoint, keeping its summary revision equal to its envelope. */
  async writeInstance(instanceId: string, expectedRevision: number, data: InstanceRecord): Promise<RecordEnvelope<InstanceRecord>> {
    const result = (await this.request({ kind: 'instance:set', instanceId, expectedRevision, data })).instance;
    if (!result || result.data.summary.instanceId !== instanceId.toLowerCase()) throw new WorkerError('INVALID_MESSAGE'); return result;
  }

  /** Drains earlier requests, closes the database, releases its own lease and waits for thread exit. */
  async close(): Promise<void> {
    if (this.stopped) { await this.ended; return; }
    if (this.closing) { await this.ended; return; }
    this.closing = true;
    try { await this.request({ kind: 'close' }, true); await this.ended; await this.owner?.close(); }
    catch (error) { await this.worker.terminate(); await this.ended; throw error; }
  }
}
