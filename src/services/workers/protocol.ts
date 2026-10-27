import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import type { Execution } from '../../core/task/machine.js';
import type { StoredTask, TaskKind, ModConfirmation } from '../storage/tasks.js';
import { parseExecution, TASK_KINDS } from '../storage/tasks.js';
import { parseModJobs, parseStoredModReport } from '../storage/mod-jobs.js';
import type { ModJobs, StoredModReport } from '../storage/mod-jobs.js';
import { modPlanRecordId, parseStoredModPlan } from '../storage/mod-plans.js';
import type { StoredModPlan } from '../storage/mod-plans.js';
import { parseModTransaction } from '../storage/mod-transactions.js';
import type { ModTransaction } from '../storage/mod-transactions.js';
import { parseModInstallResult } from '../storage/mod-results.js';
import type { ModInstallResult } from '../storage/mod-results.js';
import type { IndexedObject } from '../storage/object-index.js';
import { parseInstallation } from '../storage/installation.js';
import type { Installation } from '../storage/installation.js';
import type { RecordEnvelope } from '../storage/records.js';
import { parseCatalogCache } from '../storage/catalog-cache.js';
import type { CatalogCache } from '../storage/catalog-cache.js';
import { parseTransferRecord } from '../download/types.js';
import type { TransferRecord } from '../download/types.js';
import { parseInstanceIndex, parseInstanceRecord } from '../storage/instance-records.js';
import type { InstanceIndex, InstanceRecord } from '../storage/instance-records.js';
import { parseLaunchProfiles } from '../storage/launch-profiles.js';
import type { LaunchProfiles } from '../storage/launch-profiles.js';
import { parseGameSessions } from '../storage/game-sessions.js';
import type { GameSessions } from '../storage/game-sessions.js';
import { parseResourceLibrary } from '../storage/resources.js';
import type { ResourceLibrary } from '../storage/resources.js';
import path from 'node:path';
import { parseSettings } from '../storage/settings.js';
import type { LaunchSettings } from '../storage/settings.js';

export type WorkerCode = 'INVALID_RECORD' | 'REVISION_CONFLICT' | 'NEEDS_RECOVERY' | 'STORE_BUSY' | 'UNSAFE_PATH' | 'STORAGE_IO'
  | 'WORKER_FAILED' | 'INVALID_MESSAGE' | 'QUEUE_FULL' | 'CANCELLED' | 'TIMEOUT' | 'FILE_TOO_LARGE' | 'CANCEL_TOO_LATE';
const CODES: readonly string[] = ['INVALID_RECORD', 'REVISION_CONFLICT', 'NEEDS_RECOVERY', 'STORE_BUSY', 'UNSAFE_PATH', 'STORAGE_IO',
  'WORKER_FAILED', 'INVALID_MESSAGE', 'QUEUE_FULL', 'CANCELLED', 'TIMEOUT', 'FILE_TOO_LARGE', 'CANCEL_TOO_LATE'];

/** Fixed internal failure without source paths, worker stacks or arbitrary messages. */
export class WorkerError extends Error {
  readonly category: 'system' | 'cancelled' | 'validation';
  constructor(readonly code: WorkerCode) {
    super(code); this.name = 'WorkerError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'INVALID_MESSAGE' ? 'validation' : 'system';
  }
}

export type StorageCommand = { kind: 'accept'; ownerId: string; requestId: string; taskKind: TaskKind; payloadDigest: string }
  | { kind: 'find-accepted'; ownerId: string; requestId: string; taskKind: TaskKind; payloadDigest: string }
  | { kind: 'get'; ownerId: string; taskId: string }
  | { kind: 'update'; ownerId: string; taskId: string; expectedRevision: number; execution: Execution }
  | { kind: 'object:lookup'; sourceKey: string }
  | { kind: 'object:remember'; sourceKey: string; object: IndexedObject }
  | { kind: 'object:clear' }
  | { kind: 'installation:get' }
  | { kind: 'installation:set'; data: Installation }
  | { kind: 'catalog:get' }
  | { kind: 'catalog:set'; expectedRevision: number; data: CatalogCache }
  | { kind: 'transfer:get'; key: string }
  | { kind: 'transfer:set'; expectedRevision: number; record: TransferRecord }
  | { kind: 'instances:get' }
  | { kind: 'instances:set'; expectedRevision: number; data: InstanceIndex }
  | { kind: 'instance:get'; instanceId: string }
  | { kind: 'instance:set'; instanceId: string; expectedRevision: number; data: InstanceRecord }
  | { kind: 'profiles:get' }
  | { kind: 'profiles:set'; expectedRevision: number; data: LaunchProfiles }
  | { kind: 'sessions:get' }
  | { kind: 'sessions:set'; expectedRevision: number; data: GameSessions }
  | { kind: 'settings:get' }
  | { kind: 'settings:set'; expectedRevision: number; data: LaunchSettings }
  | { kind: 'resources:get' }
  | { kind: 'resources:set'; expectedRevision: number; data: ResourceLibrary }
  | { kind: 'mod-jobs:get' }
  | { kind: 'mod-jobs:set'; expectedRevision: number; data: ModJobs }
  | { kind: 'mod-report:get'; taskId: string }
  | { kind: 'mod-report:set'; taskId: string; expectedRevision: 0; data: StoredModReport }
  | { kind: 'mod-plan:get'; requestId: string }
  | { kind: 'mod-confirm:accept'; planRequestId: string; planId: string; confirmed: true }
  | { kind: 'mod-confirm:list' }
  | { kind: 'mod-plan:set'; requestId: string; expectedRevision: number; data: StoredModPlan }
  | { kind: 'mod-txn:get'; taskId: string }
  | { kind: 'mod-result:get'; taskId: string }
  | { kind: 'mod-result:set'; taskId: string; expectedRevision: number; data: ModInstallResult }
  | { kind: 'mod-txn:set'; taskId: string; expectedRevision: number; data: ModTransaction }
  | { kind: 'close' };
export interface StorageRequest { version: 1; id: string; command: StorageCommand }
export interface HashResult { size: number; sha1: string; sha256: string }
export interface HashJobRequest { version: 1; kind: 'hash-job'; jobId: string; file: string; maximumBytes: number }
export type WorkerReply = { version: 1; kind: 'ready' }
  | { version: 1; kind: 'startup-failed'; code: WorkerCode }
  | { version: 1; kind: 'response'; id: string; ok: true; task?: StoredTask; object?: IndexedObject; installation?: RecordEnvelope<Installation>; catalog?: RecordEnvelope<CatalogCache>; transfer?: TransferRecord; instances?: RecordEnvelope<InstanceIndex>; instance?: RecordEnvelope<InstanceRecord>; profiles?: RecordEnvelope<LaunchProfiles>; sessions?: RecordEnvelope<GameSessions>; settings?: RecordEnvelope<LaunchSettings>; resources?: RecordEnvelope<ResourceLibrary>; modJobs?: RecordEnvelope<ModJobs>; modReport?: RecordEnvelope<StoredModReport>; modPlan?: RecordEnvelope<StoredModPlan>; modTransaction?: RecordEnvelope<ModTransaction>; modConfirmations?: ModConfirmation[]; modResult?: RecordEnvelope<ModInstallResult> }
  | { version: 1; kind: 'response'; id: string; ok: false; code: WorkerCode }
  | { version: 1; kind: 'hash-progress'; bytesDone: number; bytesTotal: number }
  | { version: 1; kind: 'hash-result'; result: HashResult }
  | { version: 1; kind: 'hash-ready' }
  | { version: 1; kind: 'hash-job-progress'; jobId: string; bytesDone: number; bytesTotal: number }
  | { version: 1; kind: 'hash-job-result'; jobId: string; result: HashResult }
  | { version: 1; kind: 'hash-job-failed'; jobId: string; code: WorkerCode };

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).sort().join(',') === keys.sort().join(','); }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID_PATTERN.test(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function requireMessage(condition: unknown): asserts condition { if (!condition) throw new WorkerError('INVALID_MESSAGE'); }

/** Accepts only bounded hash requests from the trusted owning process, correlated by a fresh UUID. */
export function parseHashJobRequest(value: unknown): HashJobRequest {
  requireMessage(object(value) && exact(value, ['version', 'kind', 'jobId', 'file', 'maximumBytes']) && value.version === 1
    && value.kind === 'hash-job' && uuid(value.jobId) && typeof value.file === 'string' && value.file.length <= 32760
    && path.isAbsolute(value.file) && integer(value.maximumBytes) && value.maximumBytes <= 64 * 1024 ** 3);
  return { version: 1, kind: 'hash-job', jobId: value.jobId, file: value.file, maximumBytes: value.maximumBytes };
}

/** Parses a private allowlist; no arbitrary paths, SQL, callbacks or scripts are accepted as commands. */
export function parseStorageRequest(value: unknown): StorageRequest {
  requireMessage(object(value) && exact(value, ['version', 'id', 'command']) && value.version === 1 && uuid(value.id) && object(value.command));
  const command = value.command;
  if (command.kind === 'close' || command.kind === 'object:clear' || command.kind === 'installation:get' || command.kind === 'catalog:get' || command.kind === 'instances:get' || command.kind === 'profiles:get' || command.kind === 'sessions:get' || command.kind === 'settings:get' || command.kind === 'resources:get' || command.kind === 'mod-jobs:get') requireMessage(exact(command, ['kind']));
  else if (command.kind === 'mod-confirm:list') requireMessage(exact(command, ['kind']));
  else if (command.kind === 'mod-confirm:accept') requireMessage(exact(command, ['kind', 'planRequestId', 'planId', 'confirmed'])
    && uuid(command.planRequestId) && typeof command.planId === 'string' && /^[a-f0-9]{64}$/.test(command.planId) && command.confirmed === true);
  else if (command.kind === 'mod-jobs:set') { requireMessage(exact(command, ['kind', 'expectedRevision', 'data']) && integer(command.expectedRevision)); parseModJobs(command.data); }
  else if (command.kind === 'mod-result:get' || command.kind === 'mod-txn:get') requireMessage(exact(command, ['kind', 'taskId']) && uuid(command.taskId));
  else if (command.kind === 'mod-result:set') {
    requireMessage(exact(command, ['kind', 'taskId', 'expectedRevision', 'data']) && uuid(command.taskId) && integer(command.expectedRevision));
    requireMessage(parseModInstallResult(command.data).taskId === command.taskId.toLowerCase());
  }
  else if (command.kind === 'mod-txn:set') {
    requireMessage(exact(command, ['kind', 'taskId', 'expectedRevision', 'data']) && uuid(command.taskId) && integer(command.expectedRevision));
    requireMessage(parseModTransaction(command.data).taskId.toLowerCase() === command.taskId.toLowerCase());
  }
  else if (command.kind === 'mod-plan:get') {
    requireMessage(exact(command, ['kind', 'requestId']) && uuid(command.requestId)); modPlanRecordId(command.requestId);
  }
  else if (command.kind === 'mod-plan:set') {
    requireMessage(exact(command, ['kind', 'requestId', 'expectedRevision', 'data']) && uuid(command.requestId)
      && integer(command.expectedRevision) && command.expectedRevision < 2);
    const data = parseStoredModPlan(command.data);
    requireMessage(data.requestId === command.requestId.toLowerCase() && command.expectedRevision === (data.status === 'preview' ? 0 : 1));
  }
  else if (command.kind === 'mod-report:get') requireMessage(exact(command, ['kind', 'taskId']) && uuid(command.taskId));
  else if (command.kind === 'mod-report:set') {
    requireMessage(exact(command, ['kind', 'taskId', 'expectedRevision', 'data']) && uuid(command.taskId) && command.expectedRevision === 0);
    requireMessage(parseStoredModReport(command.data).taskId.toLowerCase() === command.taskId.toLowerCase());
  }
  else if (command.kind === 'resources:set') { requireMessage(exact(command, ['kind', 'expectedRevision', 'data']) && integer(command.expectedRevision)); parseResourceLibrary(command.data); }
  else if (command.kind === 'settings:set') { requireMessage(exact(command, ['kind', 'expectedRevision', 'data']) && integer(command.expectedRevision)); parseSettings(command.data); }
  else if (command.kind === 'sessions:set') { requireMessage(exact(command, ['kind', 'expectedRevision', 'data']) && integer(command.expectedRevision)); parseGameSessions(command.data); }
  else if (command.kind === 'profiles:set') { requireMessage(exact(command, ['kind', 'expectedRevision', 'data']) && integer(command.expectedRevision)); parseLaunchProfiles(command.data); }
  else if (command.kind === 'instances:set') { requireMessage(exact(command, ['kind', 'expectedRevision', 'data']) && integer(command.expectedRevision)); parseInstanceIndex(command.data); }
  else if (command.kind === 'instance:get') requireMessage(exact(command, ['kind', 'instanceId']) && uuid(command.instanceId));
  else if (command.kind === 'instance:set') {
    requireMessage(exact(command, ['kind', 'instanceId', 'expectedRevision', 'data']) && uuid(command.instanceId) && integer(command.expectedRevision));
    const data = parseInstanceRecord(command.data);
    requireMessage(data.summary.instanceId === command.instanceId.toLowerCase() && data.summary.revision === command.expectedRevision + 1);
  }
  else if (command.kind === 'installation:set') { requireMessage(exact(command, ['kind', 'data'])); parseInstallation(command.data); }
  else if (command.kind === 'catalog:set') { requireMessage(exact(command, ['kind', 'expectedRevision', 'data']) && integer(command.expectedRevision)); parseCatalogCache(command.data); }
  else if (command.kind === 'transfer:get') requireMessage(exact(command, ['kind', 'key']) && typeof command.key === 'string' && /^[a-f0-9]{64}$/.test(command.key));
  else if (command.kind === 'transfer:set') { requireMessage(exact(command, ['kind', 'expectedRevision', 'record']) && integer(command.expectedRevision)); parseTransferRecord(command.record); }
  else if (command.kind === 'object:lookup' || command.kind === 'object:remember') {
    requireMessage(typeof command.sourceKey === 'string' && /^[a-f0-9]{64}$/.test(command.sourceKey)
      && exact(command, command.kind === 'object:lookup' ? ['kind', 'sourceKey'] : ['kind', 'sourceKey', 'object']));
    if (command.kind === 'object:remember') parseIndexed(command.object);
  }
  else {
    requireMessage(uuid(command.ownerId));
    if (command.kind === 'accept' || command.kind === 'find-accepted') requireMessage(exact(command, ['kind', 'ownerId', 'requestId', 'taskKind', 'payloadDigest'])
      && uuid(command.requestId) && typeof command.taskKind === 'string' && (TASK_KINDS as readonly string[]).includes(command.taskKind)
      && (command.kind !== 'accept' || command.taskKind !== 'mod-install')
      && typeof command.payloadDigest === 'string' && /^[a-f0-9]{64}$/.test(command.payloadDigest));
    else if (command.kind === 'get') requireMessage(exact(command, ['kind', 'ownerId', 'taskId']) && uuid(command.taskId));
    else if (command.kind === 'update') {
      requireMessage(exact(command, ['kind', 'ownerId', 'taskId', 'expectedRevision', 'execution']) && uuid(command.taskId) && integer(command.expectedRevision));
      parseExecution(command.execution);
    } else throw new WorkerError('INVALID_MESSAGE');
  }
  return value as unknown as StorageRequest;
}

function parseModConfirmations(value: unknown): ModConfirmation[] {
  requireMessage(Array.isArray(value) && value.length <= 1000);
  const requests = new Set<string>(); const tasks = new Set<string>();
  return value.map((item: unknown) => {
    requireMessage(object(item) && exact(item, ['planRequestId', 'payloadDigest', 'task']) && uuid(item.planRequestId)
      && typeof item.payloadDigest === 'string' && /^[a-f0-9]{64}$/.test(item.payloadDigest));
    const task = parseTask(item.task); const id = item.planRequestId.toLowerCase();
    requireMessage(task.kind === 'mod-install' && !requests.has(id) && !tasks.has(task.taskId.toLowerCase()));
    requests.add(id); tasks.add(task.taskId.toLowerCase());
    return { planRequestId: id, payloadDigest: item.payloadDigest, task };
  });
}
function parseTask(value: unknown): StoredTask {
  requireMessage(object(value) && exact(value, ['taskId', 'ownerId', 'kind', 'execution']) && uuid(value.taskId) && uuid(value.ownerId)
    && typeof value.kind === 'string' && (TASK_KINDS as readonly string[]).includes(value.kind));
  return { taskId: value.taskId, ownerId: value.ownerId, kind: value.kind as TaskKind, execution: parseExecution(value.execution) };
}

function parseIndexed(value: unknown): IndexedObject {
  requireMessage(object(value) && exact(value, ['digest', 'size']) && typeof value.digest === 'string'
    && /^[a-f0-9]{64}$/.test(value.digest) && integer(value.size));
  return { digest: value.digest, size: value.size };
}

/** Validates every worker response before it can update application state. */
export function parseReply(value: unknown): WorkerReply {
  requireMessage(object(value) && value.version === 1);
  if (value.kind === 'ready') { requireMessage(exact(value, ['version', 'kind'])); return { version: 1, kind: 'ready' }; }
  if (value.kind === 'hash-ready') { requireMessage(exact(value, ['version', 'kind'])); return { version: 1, kind: 'hash-ready' }; }
  if (value.kind === 'startup-failed') {
    requireMessage(exact(value, ['version', 'kind', 'code']) && typeof value.code === 'string' && CODES.includes(value.code));
    return { version: 1, kind: 'startup-failed', code: value.code as WorkerCode };
  }
  if (value.kind === 'response') {
    requireMessage(uuid(value.id));
    if (value.ok === true) {
      requireMessage([value.task, value.object, value.installation, value.catalog, value.transfer, value.instances, value.instance, value.profiles, value.sessions, value.settings, value.resources, value.modJobs, value.modReport, value.modPlan, value.modTransaction, value.modConfirmations, value.modResult].filter(item => item !== undefined).length <= 1
        && exact(value, ['version', 'kind', 'id', 'ok', ...(value.task === undefined ? [] : ['task']), ...(value.object === undefined ? [] : ['object']), ...(value.installation === undefined ? [] : ['installation']), ...(value.catalog === undefined ? [] : ['catalog']), ...(value.transfer === undefined ? [] : ['transfer']), ...(value.instances === undefined ? [] : ['instances']), ...(value.instance === undefined ? [] : ['instance']), ...(value.profiles === undefined ? [] : ['profiles']), ...(value.sessions === undefined ? [] : ['sessions']), ...(value.settings === undefined ? [] : ['settings']), ...(value.resources === undefined ? [] : ['resources']), ...(value.modJobs === undefined ? [] : ['modJobs']), ...(value.modReport === undefined ? [] : ['modReport']), ...(value.modPlan === undefined ? [] : ['modPlan']), ...(value.modTransaction === undefined ? [] : ['modTransaction']), ...(value.modConfirmations === undefined ? [] : ['modConfirmations']), ...(value.modResult === undefined ? [] : ['modResult'])]));
      let modTransaction: RecordEnvelope<ModTransaction> | undefined;
      let modResult: RecordEnvelope<ModInstallResult> | undefined;
      if (value.modResult !== undefined) {
        requireMessage(object(value.modResult) && exact(value.modResult, ['schemaVersion', 'revision', 'data'])
          && value.modResult.schemaVersion === 1 && integer(value.modResult.revision) && value.modResult.revision >= 1);
        modResult = { schemaVersion: 1, revision: value.modResult.revision, data: parseModInstallResult(value.modResult.data) };
      }
      if (value.modTransaction !== undefined) {
        requireMessage(object(value.modTransaction) && exact(value.modTransaction, ['schemaVersion', 'revision', 'data'])
          && value.modTransaction.schemaVersion === 1 && integer(value.modTransaction.revision) && value.modTransaction.revision >= 1);
        modTransaction = { schemaVersion: 1, revision: value.modTransaction.revision, data: parseModTransaction(value.modTransaction.data) };
      }
      let modPlan: RecordEnvelope<StoredModPlan> | undefined;
      if (value.modPlan !== undefined) {
        requireMessage(object(value.modPlan) && exact(value.modPlan, ['schemaVersion', 'revision', 'data'])
          && value.modPlan.schemaVersion === 1 && (value.modPlan.revision === 1 || value.modPlan.revision === 2));
        const data = parseStoredModPlan(value.modPlan.data);
        requireMessage(value.modPlan.revision === (data.status === 'preview' ? 1 : 2));
        modPlan = { schemaVersion: 1, revision: value.modPlan.revision, data };
      }
      let modJobs: RecordEnvelope<ModJobs> | undefined; let modReport: RecordEnvelope<StoredModReport> | undefined;
      if (value.modJobs !== undefined) {
        requireMessage(object(value.modJobs) && exact(value.modJobs, ['schemaVersion', 'revision', 'data']) && value.modJobs.schemaVersion === 1 && integer(value.modJobs.revision) && value.modJobs.revision > 0);
        modJobs = { schemaVersion: 1, revision: value.modJobs.revision, data: parseModJobs(value.modJobs.data) };
      }
      if (value.modReport !== undefined) {
        requireMessage(object(value.modReport) && exact(value.modReport, ['schemaVersion', 'revision', 'data']) && value.modReport.schemaVersion === 1 && value.modReport.revision === 1);
        modReport = { schemaVersion: 1, revision: 1, data: parseStoredModReport(value.modReport.data) };
      }
      let resources: RecordEnvelope<ResourceLibrary> | undefined;
      if (value.resources !== undefined) {
        requireMessage(object(value.resources) && exact(value.resources, ['schemaVersion', 'revision', 'data']) && value.resources.schemaVersion === 1 && integer(value.resources.revision) && value.resources.revision > 0);
        resources = { schemaVersion: 1, revision: value.resources.revision, data: parseResourceLibrary(value.resources.data) };
      }
      let settings: RecordEnvelope<LaunchSettings> | undefined;
      if (value.settings !== undefined) {
        requireMessage(object(value.settings) && exact(value.settings, ['schemaVersion', 'revision', 'data']) && value.settings.schemaVersion === 1 && integer(value.settings.revision) && value.settings.revision > 0);
        settings = { schemaVersion: 1, revision: value.settings.revision, data: parseSettings(value.settings.data) };
      }
      let sessions: RecordEnvelope<GameSessions> | undefined;
      if (value.sessions !== undefined) {
        requireMessage(object(value.sessions) && exact(value.sessions, ['schemaVersion', 'revision', 'data']) && value.sessions.schemaVersion === 1 && integer(value.sessions.revision) && value.sessions.revision > 0);
        sessions = { schemaVersion: 1, revision: value.sessions.revision, data: parseGameSessions(value.sessions.data) };
      }
      let profiles: RecordEnvelope<LaunchProfiles> | undefined;
      if (value.profiles !== undefined) {
        requireMessage(object(value.profiles) && exact(value.profiles, ['schemaVersion', 'revision', 'data']) && value.profiles.schemaVersion === 1
          && integer(value.profiles.revision) && value.profiles.revision > 0);
        profiles = { schemaVersion: 1, revision: value.profiles.revision, data: parseLaunchProfiles(value.profiles.data) };
      }
      let installation: RecordEnvelope<Installation> | undefined;
      if (value.installation !== undefined) {
        requireMessage(object(value.installation) && exact(value.installation, ['schemaVersion', 'revision', 'data'])
          && value.installation.schemaVersion === 1 && integer(value.installation.revision) && value.installation.revision > 0);
        installation = { schemaVersion: 1, revision: value.installation.revision, data: parseInstallation(value.installation.data) };
      }
      let catalog: RecordEnvelope<CatalogCache> | undefined;
      if (value.catalog !== undefined) {
        requireMessage(object(value.catalog) && exact(value.catalog, ['schemaVersion', 'revision', 'data'])
          && value.catalog.schemaVersion === 1 && integer(value.catalog.revision) && value.catalog.revision > 0);
        catalog = { schemaVersion: 1, revision: value.catalog.revision, data: parseCatalogCache(value.catalog.data) };
      }
      let instances: RecordEnvelope<InstanceIndex> | undefined;
      if (value.instances !== undefined) {
        requireMessage(object(value.instances) && exact(value.instances, ['schemaVersion', 'revision', 'data']) && value.instances.schemaVersion === 1
          && integer(value.instances.revision) && value.instances.revision > 0);
        instances = { schemaVersion: 1, revision: value.instances.revision, data: parseInstanceIndex(value.instances.data) };
      }
      let instance: RecordEnvelope<InstanceRecord> | undefined;
      if (value.instance !== undefined) {
        requireMessage(object(value.instance) && exact(value.instance, ['schemaVersion', 'revision', 'data']) && value.instance.schemaVersion === 1
          && integer(value.instance.revision) && value.instance.revision > 0);
        const data = parseInstanceRecord(value.instance.data); requireMessage(data.summary.revision === value.instance.revision);
        instance = { schemaVersion: 1, revision: value.instance.revision, data };
      }
      return { version: 1, kind: 'response', id: value.id, ok: true, ...(value.task === undefined ? {} : { task: parseTask(value.task) }),
        ...(value.object === undefined ? {} : { object: parseIndexed(value.object) }), ...(installation === undefined ? {} : { installation }), ...(catalog === undefined ? {} : { catalog }),
        ...(value.transfer === undefined ? {} : { transfer: parseTransferRecord(value.transfer) }), ...(instances === undefined ? {} : { instances }), ...(instance === undefined ? {} : { instance }), ...(profiles === undefined ? {} : { profiles }), ...(sessions === undefined ? {} : { sessions }), ...(settings === undefined ? {} : { settings }), ...(resources === undefined ? {} : { resources }), ...(modJobs === undefined ? {} : { modJobs }), ...(modReport === undefined ? {} : { modReport }), ...(modPlan === undefined ? {} : { modPlan }), ...(modTransaction === undefined ? {} : { modTransaction }), ...(value.modConfirmations === undefined ? {} : { modConfirmations: parseModConfirmations(value.modConfirmations) }), ...(modResult === undefined ? {} : { modResult }) };
    }
    requireMessage(value.ok === false && exact(value, ['version', 'kind', 'id', 'ok', 'code']) && typeof value.code === 'string' && CODES.includes(value.code));
    return { version: 1, kind: 'response', id: value.id, ok: false, code: value.code as WorkerCode };
  }
  if (value.kind === 'hash-job-failed') {
    requireMessage(exact(value, ['version', 'kind', 'jobId', 'code']) && uuid(value.jobId) && typeof value.code === 'string' && CODES.includes(value.code));
    return { version: 1, kind: 'hash-job-failed', jobId: value.jobId, code: value.code as WorkerCode };
  }
  if (value.kind === 'hash-progress' || value.kind === 'hash-job-progress') {
    requireMessage(exact(value, value.kind === 'hash-progress' ? ['version', 'kind', 'bytesDone', 'bytesTotal'] : ['version', 'kind', 'jobId', 'bytesDone', 'bytesTotal'])
      && integer(value.bytesDone) && integer(value.bytesTotal) && value.bytesDone <= value.bytesTotal);
    if (value.kind === 'hash-job-progress') {
      requireMessage(uuid(value.jobId));
      return { version: 1, kind: 'hash-job-progress', jobId: value.jobId, bytesDone: value.bytesDone, bytesTotal: value.bytesTotal };
    }
    return { version: 1, kind: 'hash-progress', bytesDone: value.bytesDone, bytesTotal: value.bytesTotal };
  }
  requireMessage((value.kind === 'hash-result' || value.kind === 'hash-job-result')
    && exact(value, value.kind === 'hash-result' ? ['version', 'kind', 'result'] : ['version', 'kind', 'jobId', 'result']) && object(value.result));
  const result = value.result;
  requireMessage(exact(result, ['size', 'sha1', 'sha256']) && integer(result.size) && typeof result.sha1 === 'string'
    && /^[a-f0-9]{40}$/.test(result.sha1) && typeof result.sha256 === 'string' && /^[a-f0-9]{64}$/.test(result.sha256));
  const parsed = { size: result.size, sha1: result.sha1, sha256: result.sha256 };
  if (value.kind === 'hash-job-result') {
    requireMessage(uuid(value.jobId));
    return { version: 1, kind: 'hash-job-result', jobId: value.jobId, result: parsed };
  }
  return { version: 1, kind: 'hash-result', result: parsed };
}
