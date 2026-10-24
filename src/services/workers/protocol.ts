import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import type { Execution } from '../../core/task/machine.js';
import type { StoredTask, TaskKind } from '../storage/tasks.js';
import { parseExecution } from '../storage/tasks.js';
import type { IndexedObject } from '../storage/object-index.js';
import { parseInstallation } from '../storage/installation.js';
import type { Installation } from '../storage/installation.js';
import type { RecordEnvelope } from '../storage/records.js';
import { parseCatalogCache } from '../storage/catalog-cache.js';
import type { CatalogCache } from '../storage/catalog-cache.js';
import { parseTransferRecord } from '../download/types.js';
import type { TransferRecord } from '../download/types.js';

export type WorkerCode = 'INVALID_RECORD' | 'REVISION_CONFLICT' | 'NEEDS_RECOVERY' | 'STORE_BUSY' | 'UNSAFE_PATH' | 'STORAGE_IO'
  | 'WORKER_FAILED' | 'INVALID_MESSAGE' | 'QUEUE_FULL' | 'CANCELLED' | 'TIMEOUT' | 'FILE_TOO_LARGE';
const CODES: readonly string[] = ['INVALID_RECORD', 'REVISION_CONFLICT', 'NEEDS_RECOVERY', 'STORE_BUSY', 'UNSAFE_PATH', 'STORAGE_IO',
  'WORKER_FAILED', 'INVALID_MESSAGE', 'QUEUE_FULL', 'CANCELLED', 'TIMEOUT', 'FILE_TOO_LARGE'];

/** Fixed internal failure without source paths, worker stacks or arbitrary messages. */
export class WorkerError extends Error {
  readonly category: 'system' | 'cancelled' | 'validation';
  constructor(readonly code: WorkerCode) {
    super(code); this.name = 'WorkerError';
    this.category = code === 'CANCELLED' ? 'cancelled' : code === 'INVALID_MESSAGE' ? 'validation' : 'system';
  }
}

export type StorageCommand = { kind: 'accept'; ownerId: string; requestId: string; taskKind: TaskKind; payloadDigest: string }
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
  | { kind: 'close' };
export interface StorageRequest { version: 1; id: string; command: StorageCommand }
export interface HashResult { size: number; sha1: string; sha256: string }
export type WorkerReply = { version: 1; kind: 'ready' }
  | { version: 1; kind: 'startup-failed'; code: WorkerCode }
  | { version: 1; kind: 'response'; id: string; ok: true; task?: StoredTask; object?: IndexedObject; installation?: RecordEnvelope<Installation>; catalog?: RecordEnvelope<CatalogCache>; transfer?: TransferRecord }
  | { version: 1; kind: 'response'; id: string; ok: false; code: WorkerCode }
  | { version: 1; kind: 'hash-progress'; bytesDone: number; bytesTotal: number }
  | { version: 1; kind: 'hash-result'; result: HashResult };

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).sort().join(',') === keys.sort().join(','); }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID_PATTERN.test(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function requireMessage(condition: unknown): asserts condition { if (!condition) throw new WorkerError('INVALID_MESSAGE'); }

/** Parses a private allowlist; no arbitrary paths, SQL, callbacks or scripts are accepted as commands. */
export function parseStorageRequest(value: unknown): StorageRequest {
  requireMessage(object(value) && exact(value, ['version', 'id', 'command']) && value.version === 1 && uuid(value.id) && object(value.command));
  const command = value.command;
  if (command.kind === 'close' || command.kind === 'object:clear' || command.kind === 'installation:get' || command.kind === 'catalog:get') requireMessage(exact(command, ['kind']));
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
    if (command.kind === 'accept') requireMessage(exact(command, ['kind', 'ownerId', 'requestId', 'taskKind', 'payloadDigest'])
      && uuid(command.requestId) && typeof command.taskKind === 'string' && ['download', 'install', 'java', 'launch', 'stop'].includes(command.taskKind)
      && typeof command.payloadDigest === 'string' && /^[a-f0-9]{64}$/.test(command.payloadDigest));
    else if (command.kind === 'get') requireMessage(exact(command, ['kind', 'ownerId', 'taskId']) && uuid(command.taskId));
    else if (command.kind === 'update') {
      requireMessage(exact(command, ['kind', 'ownerId', 'taskId', 'expectedRevision', 'execution']) && uuid(command.taskId) && integer(command.expectedRevision));
      parseExecution(command.execution);
    } else throw new WorkerError('INVALID_MESSAGE');
  }
  return value as unknown as StorageRequest;
}

function parseTask(value: unknown): StoredTask {
  requireMessage(object(value) && exact(value, ['taskId', 'ownerId', 'kind', 'execution']) && uuid(value.taskId) && uuid(value.ownerId)
    && typeof value.kind === 'string' && ['download', 'install', 'java', 'launch', 'stop'].includes(value.kind));
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
  if (value.kind === 'startup-failed') {
    requireMessage(exact(value, ['version', 'kind', 'code']) && typeof value.code === 'string' && CODES.includes(value.code));
    return { version: 1, kind: 'startup-failed', code: value.code as WorkerCode };
  }
  if (value.kind === 'response') {
    requireMessage(uuid(value.id));
    if (value.ok === true) {
      requireMessage([value.task, value.object, value.installation, value.catalog, value.transfer].filter(item => item !== undefined).length <= 1
        && exact(value, ['version', 'kind', 'id', 'ok', ...(value.task === undefined ? [] : ['task']), ...(value.object === undefined ? [] : ['object']), ...(value.installation === undefined ? [] : ['installation']), ...(value.catalog === undefined ? [] : ['catalog']), ...(value.transfer === undefined ? [] : ['transfer'])]));
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
      return { version: 1, kind: 'response', id: value.id, ok: true, ...(value.task === undefined ? {} : { task: parseTask(value.task) }),
        ...(value.object === undefined ? {} : { object: parseIndexed(value.object) }), ...(installation === undefined ? {} : { installation }), ...(catalog === undefined ? {} : { catalog }),
        ...(value.transfer === undefined ? {} : { transfer: parseTransferRecord(value.transfer) }) };
    }
    requireMessage(value.ok === false && exact(value, ['version', 'kind', 'id', 'ok', 'code']) && typeof value.code === 'string' && CODES.includes(value.code));
    return { version: 1, kind: 'response', id: value.id, ok: false, code: value.code as WorkerCode };
  }
  if (value.kind === 'hash-progress') {
    requireMessage(exact(value, ['version', 'kind', 'bytesDone', 'bytesTotal']) && integer(value.bytesDone) && integer(value.bytesTotal) && value.bytesDone <= value.bytesTotal);
    return { version: 1, kind: 'hash-progress', bytesDone: value.bytesDone, bytesTotal: value.bytesTotal };
  }
  requireMessage(value.kind === 'hash-result' && exact(value, ['version', 'kind', 'result']) && object(value.result));
  const result = value.result;
  requireMessage(exact(result, ['size', 'sha1', 'sha256']) && integer(result.size) && typeof result.sha1 === 'string'
    && /^[a-f0-9]{40}$/.test(result.sha1) && typeof result.sha256 === 'string' && /^[a-f0-9]{64}$/.test(result.sha256));
  return { version: 1, kind: 'hash-result', result: { size: result.size, sha1: result.sha1, sha256: result.sha256 } };
}
