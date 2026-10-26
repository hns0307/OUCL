import type { DownloadSpec, TransferOptions } from '../download/types.js';
import type { ObjectRef } from '../objects/store.js';
import type { ResourceRecord } from '../storage/resources.js';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, rename } from 'node:fs/promises';
import path from 'node:path';
import { release } from 'node:os';
import { resolveClientVersion } from '../../core/version/resolve.js';
import { parseAssetIndex } from '../../core/install/assets.js';
import { planVanillaInstall } from '../../core/install/plan.js';
import { applyWorkerEvent, controlTask } from '../../core/task/machine.js';
import type { Execution, WorkerEvent } from '../../core/task/machine.js';
import type { StoredTask } from '../storage/tasks.js';
import type { InstanceRecord, InstanceSummary } from '../storage/instance-records.js';
import { parseInstanceSummary } from '../storage/instance-records.js';
import { StorageClient } from '../workers/storage-client.js';
import { HashPool } from '../workers/hash-pool.js';
import { NativeExtractor } from '../workers/native-extractor.js';
import { ObjectStore } from '../objects/store.js';
import { DownloadCoordinator } from '../download/coordinator.js';
import { ArtifactTransfer } from '../download/artifact-transfer.js';
import { SourceTransfer } from '../download/source-transfer.js';
import { RequestBudget } from '../download/request-budget.js';
import { DEFAULT_DOWNLOAD_PREFERENCES } from '../../shared/contracts/download-preferences.js';
import type { DownloadPreferences } from '../../shared/contracts/download-preferences.js';
import type { InstallMetadataService, PreparedInstallMetadata } from '../catalog/install-metadata.js';
import { InstallDownloadService } from './downloads.js';
import type { InstallDownloadProgress } from './downloads.js';
import { artifactSpec } from './metadata-object.js';
import { FileViewService } from './file-views.js';
import { ensureChildDirectory, prepareInstanceDirectories, prepareInstanceNatives, viewTarget, writeDerivedJson } from './instance-files.js';
import { hasCode } from '../storage/files.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { verifyLaunchInputs } from './launch-inputs.js';
import type { JavaPackage } from '../java/runtime.js';
import { guardDirectory, hasCode as fileHasCode } from '../storage/files.js';

export class InstallerError extends Error {
  readonly category: 'disk' | 'biz' | 'system' | 'cancelled';
  constructor(readonly code: 'ROOT_UNAVAILABLE' | 'NAME_CONFLICT' | 'INSTANCE_NOT_FOUND' | 'INVALID_TASK_STATE' | 'CANCEL_TOO_LATE' | 'NEEDS_RECOVERY' | 'INSTALL_FAILED' | 'CANCELLED') {
    super(code); this.name = 'InstallerError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'NEEDS_RECOVERY' || code === 'ROOT_UNAVAILABLE' ? 'disk' : code === 'INSTALL_FAILED' ? 'system' : 'biz';
  }
}
export interface CreateInstanceInput { rootId: string; mcVersionId: string; displayName: string; isolation: InstanceSummary['isolation'] }
interface LiveInstall { task: StoredTask; stage: string; controller: AbortController; done: Promise<void>; changes: Promise<void>; progress?: InstallDownloadProgress; progressWrite?: Promise<void>; failure?: unknown }
interface Runtime { rootId: string; dataDirectory: string; objects: ObjectStore; hashes: HashPool; extractor: NativeExtractor; coordinator: DownloadCoordinator; downloads: InstallDownloadService; views: FileViewService }

/** Stable, separate internal UUIDs bind one instance and its consumers to a durable task identity. */
export function installIdentity(namespace: string, name: string): string {
  if (!UUID_PATTERN.test(namespace)) throw new InstallerError('NEEDS_RECOVERY');
  const hash = createHash('sha1').update(Buffer.from(namespace.replaceAll('-', ''), 'hex')).update(name).digest(); hash[6] = (hash[6]! & 15) | 80; hash[8] = (hash[8]! & 63) | 128;
  const hex = hash.subarray(0, 16).toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Reconstructs the pinned plan from exact original documents, not transient renderer state. */
export function restoreInstallMetadata(record: InstanceRecord): PreparedInstallMetadata {
  const stored = record.metadata; if (!stored) throw new InstallerError('NEEDS_RECOVERY');
  const documents = Object.fromEntries(Object.entries(stored.versionDocuments).map(([id, body]) => [id, JSON.parse(body) as unknown]));
  const version = resolveClientVersion(record.summary.mcVersionId, documents, stored.environment ?? { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
  const assets = parseAssetIndex(JSON.parse(stored.assetIndexBody) as unknown);
  return { version, assets, plan: planVanillaInstall(version, stored.metadataSha1ByVersion, assets), ...stored };
}

/** Owns actual vanilla installation effects and the existing JSON/SQLite task repositories. */
export class InstallerService {
  private runtime?: Promise<Runtime>;
  private readonly live = new Map<string, LiveInstall>();
  private readonly admissions = new Map<string, Promise<{ taskId: string }>>();
  private admissionTail: Promise<void> = Promise.resolve();
  private indexTail: Promise<void> = Promise.resolve();
  private fileTail: Promise<void> = Promise.resolve();
  private closed = false;
  private closing?: Promise<void>;
  private readonly requestBudget = new RequestBudget();
  constructor(private readonly storage: StorageClient, private readonly entry: string | URL, private readonly metadata: InstallMetadataService,
    private readonly downloadPreferences: () => Readonly<DownloadPreferences> = () => DEFAULT_DOWNLOAD_PREFERENCES) {}

  /** Publishes an immutable, content-addressed official JVM only after all files verify. Never overwrites an existing runtime. */
  async prepareJava(pack: JavaPackage, consumerId: string, signal: AbortSignal): Promise<string> {
    const runtime = await this.resources();
    const parent = await ensureChildDirectory(runtime.dataDirectory, 'runtimes', 'java');
    const destination = path.join(parent, pack.digest);
    let exists = false;
    try { await guardDirectory(destination); exists = true; } catch (error) { if (!fileHasCode(error, 'ENOENT')) throw error; }
    if (exists) {
      for (const file of pack.files) {
        if (signal.aborted) throw new InstallerError('CANCELLED');
        const target = path.join(destination, file.relative); await guardDirectory(path.dirname(target));
        const stat = await lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new InstallerError('NEEDS_RECOVERY');
        const hash = await runtime.hashes.hash(target, { maximumBytes: file.spec.expected.size, signal });
        if (hash.size !== file.spec.expected.size || hash.sha1 !== file.spec.expected.digest) throw new InstallerError('NEEDS_RECOVERY');
      }
    } else {
      const staging = await mkdtemp(path.join(parent, '.preparing-'));
      // Interrupted staging is never a published runtime. Verified objects remain resumable in the shared store.
      for (const file of pack.files) {
        if (signal.aborted) throw new InstallerError('CANCELLED');
        const object = await runtime.coordinator.request(file.spec, { consumerId, signal }).result;
        await runtime.views.materialize(staging, file.relative, file.spec, object, { mode: 'copy', signal });
      }
      if (signal.aborted) throw new InstallerError('CANCELLED');
      await guardDirectory(parent); await rename(staging, destination);
    }
    return path.join(destination, 'bin/java.exe');
  }

  /** Shares the single object-store owner and bounded coordinator with resource downloads. */
  async transferResource(spec: DownloadSpec, taskId: string, options: TransferOptions): Promise<ObjectRef> {
    const runtime = await this.resources();
    return runtime.coordinator.request(spec, { consumerId: taskId, ...options }).result;
  }
  /** Publishes a verified resource into its fixed task namespace; no instance files are touched. */
  async materializeResource(record: ResourceRecord, object: ObjectRef): Promise<void> {
    const runtime = await this.resources(); const library = await ensureChildDirectory(runtime.dataDirectory, 'resource-library');
    await runtime.views.materialize(library, `${record.kind}/${record.taskId}/${record.filename}`, record.spec, object, { mode: 'prefer-link' });
  }

  private async resources(): Promise<Runtime> {
    this.runtime ??= (async () => {
      const registration = await this.storage.readInstallation(); if (!registration) throw new InstallerError('ROOT_UNAVAILABLE');
      const { rootId, dataDirectory } = registration.data; const store = await ensureChildDirectory(dataDirectory, 'store');
      const hashes = new HashPool(this.entry); const extractor = new NativeExtractor(this.entry);
      try {
        const objects = await ObjectStore.open(store, this.storage, hashes);
        const concurrency = (): number => this.downloadPreferences().fileConcurrency;
        const coordinator = new DownloadCoordinator(new ArtifactTransfer(new SourceTransfer(this.downloadPreferences, fetch, this.requestBudget), this.storage, objects), objects, concurrency);
        return { rootId, dataDirectory, hashes, extractor, objects, coordinator, downloads: new InstallDownloadService(coordinator, objects, concurrency), views: new FileViewService(store, objects, hashes) };
      } catch (error) { await hashes.close(); await extractor.close(); throw error; }
    })();
    return this.runtime;
  }
  private index(summary: InstanceSummary): Promise<void> {
    const update = this.indexTail.then(async () => {
      const stored = await this.storage.readInstances(); const items = stored?.data.items ?? [];
      const others = items.filter(item => item.instanceId !== summary.instanceId);
      await this.storage.writeInstances(stored?.revision ?? 0, { items: [...others, summary] });
    });
    this.indexTail = update.catch(() => {}); return update;
  }
  private async save(record: InstanceRecord, phase: InstanceRecord['phase'], patch: Partial<Pick<InstanceRecord, 'metadata' | 'objects' | 'receipts'>> = {}): Promise<InstanceRecord> {
    const state = ['reserved', 'prepared', 'downloaded', 'materializing'].includes(phase) ? 'installing' : phase as InstanceSummary['state'];
    const next: InstanceRecord = { ...record, ...patch, phase, summary: { ...record.summary, state, revision: record.summary.revision + 1 } };
    const result = await this.storage.writeInstance(record.summary.instanceId, record.summary.revision, next);
    await this.index(result.data.summary); return result.data;
  }

  /** Reuses the existing object owner and serialized file lane to verify a ready instance before launch. */
  async prepareLaunch(instanceId: string, expectedRevision: number, signal: AbortSignal) {
    if (this.closed) throw new InstallerError('INSTALL_FAILED');
    const operation = this.fileTail.then(async () => {
      if (signal.aborted) throw new InstallerError('CANCELLED');
      const runtime = await this.resources(); const record = await this.storage.readInstance(instanceId);
      if (!record || record.data.summary.rootId !== runtime.rootId || record.data.phase !== 'ready') throw new InstallerError('INSTANCE_NOT_FOUND');
      if (record.revision !== expectedRevision) throw new InstallerError('NEEDS_RECOVERY');
      return verifyLaunchInputs(runtime, record, restoreInstallMetadata(record.data), signal);
    });
    this.fileTail = operation.then(() => {}, () => {}); return operation;
  }
  /** Persists idempotent acceptance and reserved identity before admitting background network/filesystem work. */
  create(requestId: string, input: CreateInstanceInput): Promise<{ taskId: string }> {
    const canonical: CreateInstanceInput = { rootId: input.rootId.toLowerCase(), mcVersionId: input.mcVersionId, displayName: input.displayName, isolation: input.isolation };
    const key = `${canonical.rootId}:${requestId.toLowerCase()}:${JSON.stringify(canonical)}`; const pending = this.admissions.get(key); if (pending) return pending;
    const admitted = this.admissionTail.then(() => this.admit(requestId.toLowerCase(), canonical));
    this.admissionTail = admitted.then(() => {}, () => {}); this.admissions.set(key, admitted);
    void admitted.finally(() => { this.admissions.delete(key); }).catch(() => {}); return admitted;
  }
  private async admit(requestId: string, input: CreateInstanceInput): Promise<{ taskId: string }> {
    if (this.closed) throw new InstallerError('INSTALL_FAILED');
    const runtime = await this.resources(); if (runtime.rootId !== input.rootId) throw new InstallerError('ROOT_UNAVAILABLE');
    // Validation happens before task acceptance; display names never enter directory paths.
    const defaultIsolation = (await this.storage.readSettings())?.data.isolationDefault ?? true;
    const seed = parseInstanceSummary({ ...input, isolation: input.isolation === 'inherit' ? defaultIsolation ? 'on' : 'off' : input.isolation,
      instanceId: input.rootId, taskId: input.rootId, state: 'installing', revision: 1 });
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const task = await this.storage.accept(input.rootId, requestId, 'install', digest);
    if (this.live.has(task.taskId)) return { taskId: task.taskId };
    const instanceId = installIdentity(task.taskId, 'instance'); const old = await this.storage.readInstance(instanceId);
    if (old) {
      const summary = old.data.summary;
      if (summary.rootId !== input.rootId || summary.taskId !== task.taskId || summary.mcVersionId !== input.mcVersionId
        || summary.displayName !== input.displayName || input.isolation !== 'inherit' && summary.isolation !== input.isolation) throw new InstallerError('NEEDS_RECOVERY');
      await this.index(summary); return { taskId: task.taskId };
    }
    const index = await this.storage.readInstances();
    if (index?.data.items.some(item => item.rootId === input.rootId && !['failed', 'cancelled'].includes(item.state) && item.displayName.toLowerCase() === input.displayName.toLowerCase())) {
      if (task.execution.state === 'queued') {
        let rejected = await this.storage.update(task.ownerId, task.taskId, task.execution.revision, controlTask(task.execution, 'start').execution);
        rejected = await this.storage.update(task.ownerId, task.taskId, rejected.execution.revision, applyWorkerEvent(rejected.execution, { kind: 'failed', attempt: rejected.execution.attempt, sequence: 1 }).execution);
        await this.storage.update(task.ownerId, task.taskId, rejected.execution.revision, applyWorkerEvent(rejected.execution, { kind: 'cleaned', attempt: rejected.execution.attempt, sequence: 2 }).execution);
      }
      throw new InstallerError('NAME_CONFLICT');
    }
    const record: InstanceRecord = { summary: { ...seed, instanceId, taskId: task.taskId }, phase: 'reserved' };
    await this.storage.writeInstance(instanceId, 0, record); await this.index(record.summary);
    const live: LiveInstall = { task, stage: 'metadata', controller: new AbortController(), done: Promise.resolve(), changes: Promise.resolve() };
    this.live.set(task.taskId, live);
    live.done = this.perform(record, live, runtime).finally(() => { this.live.delete(task.taskId); });
    void live.done.catch(() => {}); return { taskId: task.taskId };
  }
  private change(live: LiveInstall, transform: (current: Execution) => Execution): Promise<void> {
    const changed = live.changes.then(async () => {
      const next = transform(live.task.execution); if (next.revision === live.task.execution.revision) return;
      try { live.task = await this.storage.update(live.task.ownerId, live.task.taskId, live.task.execution.revision, next); }
      catch (error) { live.failure = error; live.controller.abort(); throw error; }
    });
    live.changes = changed.catch(() => {}); return changed;
  }
  private event(live: LiveInstall, event: Omit<WorkerEvent, 'attempt' | 'sequence'>): Promise<void> {
    return this.change(live, current => applyWorkerEvent(current, { ...event, attempt: current.attempt, sequence: current.lastSequence + 1 } as WorkerEvent).execution);
  }
  /** Reconciles summary mirrors conservatively after repository recovery; it never steals a stale store owner. */
  async initialize(): Promise<void> {
    const stored = await this.storage.readInstances();
    for (const summary of stored?.data.items ?? []) {
      const record = (await this.storage.readInstance(summary.instanceId))?.data;
      if (!record || record.summary.rootId !== summary.rootId || record.summary.taskId !== summary.taskId) throw new InstallerError('NEEDS_RECOVERY');
      const task = await this.storage.get(summary.rootId, summary.taskId);
      if (record.phase === 'ready' && task?.execution.state === 'completed') await this.index(record.summary);
      else if (record.summary.state === 'installing' || task?.execution.state === 'needsRecovery') await this.save(record, 'needsRecovery');
      else await this.index(record.summary);
    }
  }
  /** Lists persisted summaries; unfinished installs never become ready merely because download bytes exist. */
  async list(rootId: string): Promise<InstanceSummary[]> { return (await this.storage.readInstances())?.data.items.filter(item => item.rootId === rootId) ?? []; }
  /** Returns the current task plus a redacted phase; this API contains no paths or raw upstream documents. */
  async task(rootId: string, taskId: string): Promise<{ task: StoredTask; stage: string; instance?: InstanceSummary }> {
    const task = this.live.get(taskId)?.task ?? await this.storage.get(rootId, taskId);
    if (!task || task.ownerId !== rootId || task.kind !== 'install') throw new InstallerError('INSTANCE_NOT_FOUND');
    const instance = (await this.list(rootId)).find(item => item.taskId === taskId);
    return { task, stage: this.live.get(taskId)?.stage ?? (task.execution.state === 'completed' ? 'completed' : instance?.state ?? task.execution.state), ...(instance ? { instance } : {}) };
  }
  /** Cancellation is durably requested before aborting owned consumers; commit cannot be undone. */
  async cancel(rootId: string, taskId: string): Promise<void> {
    const live = this.live.get(taskId);
    if (!live) {
      if ((await this.storage.get(rootId, taskId))?.execution.state === 'completed') throw new InstallerError('CANCEL_TOO_LATE');
      throw new InstallerError('INVALID_TASK_STATE');
    }
    if (live.task.ownerId !== rootId) throw new InstallerError('INVALID_TASK_STATE');
    await this.change(live, current => {
      const transition = controlTask(current, 'cancel');
      if (transition.rejected) throw new InstallerError(transition.rejected === 'CANCEL_TOO_LATE' ? 'CANCEL_TOO_LATE' : 'INVALID_TASK_STATE');
      return transition.execution;
    }); live.controller.abort();
  }
  private async perform(initial: InstanceRecord, live: LiveInstall, runtime: Runtime): Promise<void> {
    let record = initial;
    const check = (): void => { if (live.failure) throw live.failure; if (live.controller.signal.aborted) throw new InstallerError('CANCELLED'); };
    try {
      await this.change(live, current => controlTask(current, 'start').execution); check();
      const environment = { os: 'windows' as const, arch: 'x64' as const, osVersion: release(), features: {} };
      const prepared = await this.metadata.prepare(record.summary.mcVersionId, environment); check();
      record = await this.save(record, 'prepared', { metadata: { versionDocuments: prepared.versionDocuments, metadataSha1ByVersion: prepared.metadataSha1ByVersion, assetIndexBody: prepared.assetIndexBody, environment } });
      live.stage = 'downloading'; let lastProgress = 0;
      const downloaded = await runtime.downloads.run(prepared, { signal: live.controller.signal,
        consumerId: id => installIdentity(record.summary.instanceId, id), onProgress: value => {
          live.progress = value;
          if (!live.progressWrite && Date.now() - lastProgress >= 100) {
            lastProgress = Date.now(); live.progressWrite = this.event(live, { kind: 'progress', bytesDone: value.verifiedBytes, bytesTotal: value.totalBytes } as WorkerEvent)
              .finally(() => { delete live.progressWrite; }); void live.progressWrite.catch(() => {});
          }
        } });
      await live.progressWrite; check();
      record = await this.save(record, 'downloaded', { objects: Object.fromEntries(downloaded.objects) });
      await this.event(live, { kind: 'progress', bytesDone: prepared.plan.totalBytes, bytesTotal: prepared.plan.totalBytes } as WorkerEvent);
      await this.event(live, { kind: 'transferred' }); live.stage = 'materializing';
      const work = this.fileTail.then(async () => {
        check(); const directories = await prepareInstanceDirectories(runtime.dataDirectory, record.summary, prepared);
        const inherited = new Map<string, { digest: string; mode: 'copy' | 'symlink' }>();
        for (const item of await this.list(record.summary.rootId)) {
          if (item.instanceId === record.summary.instanceId) continue;
          const previous = (await this.storage.readInstance(item.instanceId))?.data;
          for (const receipt of previous?.receipts ?? []) {
            if (receipt.area !== 'assets' && receipt.area !== 'libraries') continue;
            const object = previous?.objects?.[receipt.artifactId]; if (object) inherited.set(`${receipt.area}:${receipt.path.toLowerCase()}`, { digest: object.digest, mode: receipt.mode });
          }
        }
        // Check every unknown existing entry before persisting this operation's materialization intent.
        for (const view of prepared.plan.views) {
          check(); const target = viewTarget(directories, view); const object = downloaded.objects.get(view.artifactId)!;
          try {
            await lstat(path.join(target.directory, target.relative));
            if (inherited.get(`${view.area}:${view.path.toLowerCase()}`)?.digest !== object.digest) throw new InstallerError('NEEDS_RECOVERY');
          } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
        }
        record = await this.save(record, 'materializing', { receipts: [] });
        for (const view of prepared.plan.views) {
          check(); const artifact = prepared.plan.artifacts.find(item => item.artifactId === view.artifactId)!;
          const object = downloaded.objects.get(view.artifactId)!; const target = viewTarget(directories, view);
          const previous = inherited.get(`${view.area}:${view.path.toLowerCase()}`);
          const receipt = await runtime.views.materialize(target.directory, target.relative, artifactSpec(artifact), object, { mode: 'prefer-link', signal: live.controller.signal,
            ...(previous ? { existing: { relativePath: target.relative, objectDigest: previous.digest, size: object.size, mode: previous.mode } } : {}) });
          record.receipts!.push({ ...view, mode: receipt.mode });
          if (record.receipts!.length % 64 === 0) record = await this.save(record, 'materializing');
        }
        record = await this.save(record, 'materializing'); check();
        const archives = prepared.plan.natives.map(native => {
          const object = downloaded.objects.get(native.artifactId)!;
          return { file: path.join(runtime.dataDirectory, 'store', 'objects', 'sha256', object.digest.slice(0, 2), object.digest), sha256: object.digest, size: object.size, exclude: native.exclude };
        });
        await prepareInstanceNatives(directories.layout.versionDirectory, archives, runtime.extractor, runtime.hashes, live.controller.signal); check();
        const version = prepared.version;
        await writeDerivedJson(directories.layout.versionJson, { id: record.summary.instanceId, mainClass: version.mainClass, type: version.type,
          javaVersion: { majorVersion: version.javaMajor }, assetIndex: version.assetIndex, arguments: { game: version.gameArguments, jvm: version.jvmArguments },
          libraries: version.libraries.map(library => ({ name: library.name, downloads: library.artifact ? { artifact: library.artifact } : {} })) });
        if (version.jarVersionId !== version.id) {
          const dependencyId = path.basename(path.dirname(directories.layout.jar));
          await writeDerivedJson(path.join(path.dirname(directories.layout.jar), `${dependencyId}.json`), {
            schemaVersion: 1, revision: 1, data: { versionRecordId: dependencyId, mcVersionId: version.jarVersionId,
              metadataSha1: prepared.metadataSha1ByVersion[version.jarVersionId], document: JSON.parse(prepared.versionDocuments[version.jarVersionId]!) as unknown }
          });
        }
        await this.event(live, { kind: 'verified' }); live.stage = 'committing';
        const ready: InstanceRecord = { ...record, phase: 'ready', summary: { ...record.summary, state: 'ready', revision: record.summary.revision + 1 } };
        await writeDerivedJson(directories.layout.instanceJson, { schemaVersion: 1, revision: ready.summary.revision, data: ready });
        record = await this.save(record, 'ready'); await this.event(live, { kind: 'committed' }); live.stage = 'completed';
      });
      this.fileTail = work.catch(() => {}); await work;
    } catch (error) {
      await live.progressWrite?.catch(() => {}); await live.changes;
      const cancelled = !live.failure && hasCode(error, 'CANCELLED');
      try {
        if (hasCode(error, 'NEEDS_RECOVERY') || live.failure) {
          record = await this.save(record, 'needsRecovery'); await this.change(live, current => controlTask(current, 'interrupted').execution);
        } else if (live.task.execution.state === 'committing') {
          record = await this.save(record, 'needsRecovery'); await this.event(live, { kind: 'failed' });
        } else {
          if (cancelled) await this.change(live, current => controlTask(current, 'cancel').execution);
          else await this.event(live, { kind: 'failed' });
          record = await this.save(record, cancelled ? 'cancelled' : 'failed'); await this.event(live, { kind: 'cleaned' });
        }
      } catch {
        live.stage = 'needsRecovery'; await this.change(live, current => controlTask(current, 'interrupted').execution).catch(() => {});
        throw new InstallerError('NEEDS_RECOVERY');
      }
      if (record.phase === 'needsRecovery') { live.stage = 'needsRecovery'; throw new InstallerError('NEEDS_RECOVERY'); }
      live.stage = cancelled ? 'cancelled' : 'failed'; throw new InstallerError(cancelled ? 'CANCELLED' : 'INSTALL_FAILED');
    }
  }
  /** Cancels unfinished work, joins effects, then releases all object/hash/native owners before app shutdown. */
  close(): Promise<void> { this.closing ??= this.finishClose(); return this.closing; }
  private async finishClose(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.admissions.values()]);
    for (const live of this.live.values()) if (live.task.execution.state !== 'committing') await this.cancel(live.task.ownerId, live.task.taskId).catch(() => {});
    await Promise.allSettled([...this.live.values()].map(live => live.done));
    const runtime = await this.runtime?.catch(() => undefined);
    if (runtime) {
      const stopped = await Promise.allSettled([runtime.coordinator.close(), runtime.extractor.close()]);
      try { await runtime.objects.close(); } finally { await runtime.hashes.close(); }
      if (stopped.some(result => result.status === 'rejected')) throw new InstallerError('NEEDS_RECOVERY');
    }
  }
}
