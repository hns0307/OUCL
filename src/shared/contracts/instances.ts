import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';
import type { TaskState } from '../../core/task/machine.js';

export const INSTANCES_CAPABILITY = 'instances.v1' as const;
export const TASKS_CAPABILITY = 'tasks.v1' as const;
export const INSTANCES_LIST_CHANNEL = 'instances:list' as const;
export const INSTANCES_CREATE_CHANNEL = 'instances:create' as const;
export const TASKS_LIST_CHANNEL = 'tasks:list' as const;
export const TASKS_GET_CHANNEL = 'tasks:get' as const;
export const TASKS_CONTROL_CHANNEL = 'tasks:control' as const;
export const TASKS_SUBSCRIBE_CHANNEL = 'tasks:subscribe' as const;
export const EVENTS_UNSUBSCRIBE_CHANNEL = 'events:unsubscribe' as const;
export const TASK_EVENT_CHANNEL = 'events:task' as const;
export const INSTANCE_CHANNELS = [INSTANCES_LIST_CHANNEL, INSTANCES_CREATE_CHANNEL, TASKS_LIST_CHANNEL, TASKS_GET_CHANNEL,
  TASKS_CONTROL_CHANNEL, TASKS_SUBSCRIBE_CHANNEL, EVENTS_UNSUBSCRIBE_CHANNEL] as const;
export type InstanceChannel = typeof INSTANCE_CHANNELS[number];
export type InstanceCode = AppError['code'] | 'OUT_OF_SCOPE' | 'ROOT_UNAVAILABLE' | 'VERSION_UNSUPPORTED' | 'NAME_CONFLICT'
  | 'DISK_FULL' | 'PERMISSION_DENIED' | 'TASK_STORE_UNAVAILABLE' | 'TASK_NOT_FOUND' | 'TASK_NOT_OWNED' | 'INVALID_TASK_STATE'
  | 'CANCEL_TOO_LATE' | 'CURSOR_EXPIRED' | 'SUBSCRIPTION_NOT_OWNED' | 'NEEDS_RECOVERY' | 'INSTALL_FAILED'
  | 'LAUNCH_FAILED' | 'JAVA_INCOMPATIBLE' | 'AUTH_REQUIRED' | 'DEPENDENCY_MISSING' | 'MEMORY_OUT_OF_RANGE' | 'INSTANCE_BUSY' | 'REVISION_CONFLICT' | 'STOP_UNSUPPORTED' | 'CONFIRMATION_REQUIRED' | 'SESSION_NOT_FOUND' | 'SESSION_NOT_OWNED';
export interface InstanceError extends Omit<AppError, 'code'> { code: InstanceCode }
export interface Page<T> { items: T[]; nextCursor?: string }
export interface InstanceSummary {
  instanceId: string; displayName: string; mcVersionId: string; isolation: 'inherit' | 'on' | 'off';
  state: 'installing' | 'ready' | 'failed' | 'cancelled' | 'needsRecovery'; revision: number;
}
export type InstallStage = 'metadata' | 'downloading' | 'materializing' | 'committing' | 'completed' | 'failed' | 'cancelled' | 'needsRecovery' | 'queued' | 'preparing';
export interface TaskSnapshot {
  taskId: string; kind: 'install' | 'launch' | 'stop'; state: TaskState; stage: InstallStage; revision: number; bytesDone: number;
  bytesTotal?: number; error?: InstanceError;
}
export interface InstancePayloads {
  'instances:list': { rootId: string; cursor?: string; limit: number };
  'instances:create': { rootId: string; mcVersionId: string; displayName: string; isolation: InstanceSummary['isolation'] };
  'tasks:list': { cursor?: string; limit: number; state?: TaskState };
  'tasks:get': { taskId: string };
  'tasks:control': { taskId: string; action: 'pause' | 'resume' | 'cancel' };
  'tasks:subscribe': { taskId: string; afterSeq?: number };
  'events:unsubscribe': { subscriptionId: string };
}
export interface InstanceData {
  'instances:list': Page<InstanceSummary>;
  'instances:create': { taskId: string };
  'tasks:list': Page<TaskSnapshot>;
  'tasks:get': { snapshot: TaskSnapshot; result?: { instanceId: string } | { sessionId: string; stopped?: true; exitCode?: number } };
  'tasks:control': { taskId: string; accepted: true; state: TaskState };
  'tasks:subscribe': { subscriptionId: string; snapshot: TaskSnapshot; seq: number };
  'events:unsubscribe': { removed: boolean };
}
export interface InstanceRequest<C extends InstanceChannel = InstanceChannel> { contractVersion: 1; requestId: string; payload: InstancePayloads[C] }
export type InstanceResult<C extends InstanceChannel = InstanceChannel> = { contractVersion: 1; requestId: string; ok: true; data: InstanceData[C] }
  | { contractVersion: 1; requestId: string; ok: false; error: InstanceError };
export interface TaskChangedEvent {
  contractVersion: 1; subscriptionId: string; seq: number; taskId: string; revision: number; kind: 'task:changed'; payload: TaskSnapshot;
}
export interface InstanceDispatcher {
  <C extends InstanceChannel>(channel: C, payload: InstancePayloads[C], requestId: string): Promise<InstanceData[C]>;
}
export interface InstanceBridge {
  listInstances(query: InstancePayloads['instances:list']): Promise<InstanceResult<'instances:list'>>;
  createInstance(requestId: string, input: InstancePayloads['instances:create']): Promise<InstanceResult<'instances:create'>>;
  listTasks(query: InstancePayloads['tasks:list']): Promise<InstanceResult<'tasks:list'>>;
  getTask(taskId: string): Promise<InstanceResult<'tasks:get'>>;
  controlTask(taskId: string, action: InstancePayloads['tasks:control']['action']): Promise<InstanceResult<'tasks:control'>>;
  subscribeTask(taskId: string, listener: (snapshot: TaskSnapshot) => void): Promise<{ result: InstanceResult<'tasks:subscribe'>; dispose: () => void }>;
}
const STATES: readonly TaskState[] = ['queued', 'running', 'verifying', 'committing', 'pausing', 'paused', 'cancelling', 'cancelled', 'completed', 'failing', 'failed', 'needsRecovery'];
const STAGES: readonly InstallStage[] = ['metadata', 'downloading', 'materializing', 'committing', 'completed', 'failed', 'cancelled', 'needsRecovery', 'queued', 'preparing'];
const ERRORS: Record<InstanceCode, { category: AppError['category']; key: MessageKey; retryable: boolean }> = {
  INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument', retryable: false },
  UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract', retryable: false },
  INVALID_SENDER: { category: 'permission', key: 'invalidSender', retryable: false },
  OUT_OF_SCOPE: { category: 'permission', key: 'invalidSender', retryable: false },
  TIMEOUT: { category: 'system', key: 'timeout', retryable: true },
  UNAVAILABLE: { category: 'system', key: 'unavailable', retryable: true },
  ROOT_UNAVAILABLE: { category: 'disk', key: 'rootUnavailable', retryable: true },
  VERSION_UNSUPPORTED: { category: 'minecraft', key: 'unavailable', retryable: false },
  NAME_CONFLICT: { category: 'biz', key: 'invalidArgument', retryable: false },
  DISK_FULL: { category: 'disk', key: 'unavailable', retryable: true },
  PERMISSION_DENIED: { category: 'permission', key: 'permissionDenied', retryable: true },
  TASK_STORE_UNAVAILABLE: { category: 'disk', key: 'unavailable', retryable: true },
  TASK_NOT_FOUND: { category: 'biz', key: 'unavailable', retryable: false },
  TASK_NOT_OWNED: { category: 'permission', key: 'invalidSender', retryable: false },
  INVALID_TASK_STATE: { category: 'biz', key: 'unavailable', retryable: false },
  CANCEL_TOO_LATE: { category: 'biz', key: 'unavailable', retryable: false },
  CURSOR_EXPIRED: { category: 'biz', key: 'unavailable', retryable: true },
  SUBSCRIPTION_NOT_OWNED: { category: 'permission', key: 'invalidSender', retryable: false },
  NEEDS_RECOVERY: { category: 'disk', key: 'unavailable', retryable: false },
  INSTALL_FAILED: { category: 'minecraft', key: 'unavailable', retryable: true },
  LAUNCH_FAILED: { category: 'minecraft', key: 'launchFailed', retryable: true },
  JAVA_INCOMPATIBLE: { category: 'validation', key: 'javaIncompatible', retryable: false },
  AUTH_REQUIRED: { category: 'auth', key: 'chooseAccountFirst', retryable: false },
  DEPENDENCY_MISSING: { category: 'minecraft', key: 'dependencyMissing', retryable: true },
  MEMORY_OUT_OF_RANGE: { category: 'validation', key: 'memoryInvalid', retryable: false },
  INSTANCE_BUSY: { category: 'biz', key: 'instanceBusy', retryable: true },
  REVISION_CONFLICT: { category: 'biz', key: 'instanceChanged', retryable: true },
  STOP_UNSUPPORTED: { category: 'biz', key: 'stopUnsupported', retryable: false },
  CONFIRMATION_REQUIRED: { category: 'permission', key: 'stopConfirmation', retryable: false },
  SESSION_NOT_FOUND: { category: 'biz', key: 'unavailable', retryable: false }, SESSION_NOT_OWNED: { category: 'permission', key: 'invalidSender', retryable: false },
};
/** Fixed domain failure for injected adapters; arbitrary exception messages never cross IPC. */
export class InstanceContractError extends Error {
  constructor(readonly code: InstanceCode) { super(code); this.name = 'InstanceContractError'; }
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID_PATTERN.test(value); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function state(value: unknown): value is TaskState { return typeof value === 'string' && STATES.includes(value as TaskState); }
function version(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_.+ -]{1,160}$/.test(value) && value.trim() === value && value !== '.' && value !== '..';
}
function name(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80 && value.trim() === value && !/[\p{C}]/u.test(value);
}
function isolation(value: unknown): boolean { return value === 'inherit' || value === 'on' || value === 'off'; }
function optionalKeys(value: unknown, required: string[], optional: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && exactObject(value, [...required, ...optional.filter(key => Object.hasOwn(value, key))]);
}
function cursor(value: unknown): boolean { return typeof value === 'string' && value.length >= 1 && value.length <= 512 && !/[\p{C}]/u.test(value); }
function query(value: unknown, withRoot: boolean): boolean {
  return optionalKeys(value, withRoot ? ['rootId', 'limit'] : ['limit'], withRoot ? ['cursor'] : ['cursor', 'state'])
    && integer(value.limit) && value.limit >= 1 && value.limit <= 100 && (!withRoot || uuid(value.rootId))
    && (!Object.hasOwn(value, 'cursor') || cursor(value.cursor)) && (!Object.hasOwn(value, 'state') || state(value.state));
}
/** Validates only the selected approved payload; paths and extra fields are never forwarded. */
export function isInstancePayload<C extends InstanceChannel>(value: unknown, channel: C): value is InstancePayloads[C] {
  switch (channel) {
    case 'instances:list': return query(value, true);
    case 'instances:create': return exactObject(value, ['rootId', 'mcVersionId', 'displayName', 'isolation'])
      && uuid(value.rootId) && version(value.mcVersionId) && name(value.displayName) && isolation(value.isolation);
    case 'tasks:list': return query(value, false);
    case 'tasks:get': return exactObject(value, ['taskId']) && uuid(value.taskId);
    case 'tasks:control': return exactObject(value, ['taskId', 'action']) && uuid(value.taskId)
      && typeof value.action === 'string' && ['pause', 'resume', 'cancel'].includes(value.action);
    case 'tasks:subscribe': return optionalKeys(value, ['taskId'], ['afterSeq']) && uuid(value.taskId)
      && (!Object.hasOwn(value, 'afterSeq') || integer(value.afterSeq));
    case 'events:unsubscribe': return exactObject(value, ['subscriptionId']) && uuid(value.subscriptionId);
    default: return false;
  }
}
/** Validates exact v1 envelope and correlation identity before service access. */
export function isInstanceRequest<C extends InstanceChannel>(value: unknown, channel: C): value is InstanceRequest<C> {
  return exactObject(value, ['contractVersion', 'requestId', 'payload']) && value.contractVersion === 1 && uuid(value.requestId) && isInstancePayload(value.payload, channel);
}
/** Creates a deterministic domain error with a controlled existing message key. */
export function instanceFailure<C extends InstanceChannel = InstanceChannel>(requestId: string, code: InstanceCode, traceId: string): InstanceResult<C> {
  const spec = ERRORS[code];
  return { contractVersion: 1, requestId, ok: false, error: { category: spec.category, code, messageKey: spec.key, retryable: spec.retryable, traceId } };
}
/** Requires the exact code/category/message/retry mapping, without arbitrary details or stacks. */
export function isInstanceError(value: unknown): value is InstanceError {
  if (!exactObject(value, ['category', 'code', 'messageKey', 'retryable', 'traceId']) || typeof value.code !== 'string' || !Object.hasOwn(ERRORS, value.code) || !uuid(value.traceId)) return false;
  const expected = ERRORS[value.code as InstanceCode];
  return value.category === expected.category && value.messageKey === expected.key && value.retryable === expected.retryable;
}
/** Public summary deliberately excludes rootId, taskId, directory identity and local paths. */
export function isInstanceSummary(value: unknown): value is InstanceSummary {
  return exactObject(value, ['instanceId', 'displayName', 'mcVersionId', 'isolation', 'state', 'revision']) && uuid(value.instanceId)
    && name(value.displayName) && version(value.mcVersionId) && isolation(value.isolation) && typeof value.state === 'string'
    && ['installing', 'ready', 'failed', 'cancelled', 'needsRecovery'].includes(value.state) && integer(value.revision) && value.revision > 0;
}
/** Validates bounded public progress rather than forwarding a stored task row. */
export function isTaskSnapshot(value: unknown): value is TaskSnapshot {
  if (!optionalKeys(value, ['taskId', 'kind', 'state', 'stage', 'revision', 'bytesDone'], ['bytesTotal', 'error'])
    || !uuid(value.taskId) || !['install', 'launch', 'stop'].includes(value.kind as string) || !state(value.state) || typeof value.stage !== 'string' || !STAGES.includes(value.stage as InstallStage)
    || !integer(value.revision) || value.revision < 1 || !integer(value.bytesDone)
    || value.kind !== 'install' && ['metadata', 'downloading', 'materializing'].includes(value.stage)
    || value.kind === 'install' && value.stage === 'preparing'
    || Object.hasOwn(value, 'bytesTotal') && (!integer(value.bytesTotal) || value.bytesTotal < value.bytesDone)
    || Object.hasOwn(value, 'error') && !isInstanceError(value.error)) return false;
  return true;
}
function page<T>(value: unknown, item: (value: unknown) => value is T, identity: (value: T) => string): boolean {
  return optionalKeys(value, ['items'], ['nextCursor']) && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(item)
    && new Set(value.items.map(identity)).size === value.items.length && (!Object.hasOwn(value, 'nextCursor') || cursor(value.nextCursor));
}
/** Checks success data against its channel, rejecting leaked fields even from trusted adapters. */
export function isInstanceData<C extends InstanceChannel>(value: unknown, channel: C): value is InstanceData[C] {
  switch (channel) {
    case 'instances:list': return page(value, isInstanceSummary, item => item.instanceId.toLowerCase());
    case 'instances:create': return exactObject(value, ['taskId']) && uuid(value.taskId);
    case 'tasks:list': return page(value, isTaskSnapshot, item => item.taskId.toLowerCase());
    case 'tasks:get': return optionalKeys(value, ['snapshot'], ['result']) && isTaskSnapshot(value.snapshot)
      && (!Object.hasOwn(value, 'result') || value.snapshot.state === 'completed' && (value.snapshot.kind === 'install'
        ? exactObject(value.result, ['instanceId']) && uuid(value.result.instanceId)
        : value.snapshot.kind === 'launch' ? exactObject(value.result, ['sessionId']) && uuid(value.result.sessionId)
          : optionalKeys(value.result, ['sessionId', 'stopped'], ['exitCode']) && uuid(value.result.sessionId) && value.result.stopped === true && (!Object.hasOwn(value.result, 'exitCode') || Number.isSafeInteger(value.result.exitCode))));
    case 'tasks:control': return exactObject(value, ['taskId', 'accepted', 'state']) && uuid(value.taskId) && value.accepted === true && state(value.state);
    case 'tasks:subscribe': return exactObject(value, ['subscriptionId', 'snapshot', 'seq']) && uuid(value.subscriptionId) && isTaskSnapshot(value.snapshot) && integer(value.seq);
    case 'events:unsubscribe': return exactObject(value, ['removed']) && typeof value.removed === 'boolean';
    default: return false;
  }
}
/** Validates request correlation and exact success/error schemas before exposing a response. */
export function isInstanceResult<C extends InstanceChannel>(value: unknown, requestId: string, channel: C): value is InstanceResult<C> {
  return exactObject(value, ['contractVersion', 'requestId', 'ok', value && typeof value === 'object' && 'ok' in value && value.ok === true ? 'data' : 'error'])
    && value.contractVersion === 1 && uuid(value.requestId) && value.requestId === requestId
    && (value.ok === true ? isInstanceData(value.data, channel) : value.ok === false && isInstanceError(value.error));
}
/** Validates an exact task event including duplicated task/revision consistency; sequence tracking belongs to preload. */
export function isTaskChangedEvent(value: unknown): value is TaskChangedEvent {
  return exactObject(value, ['contractVersion', 'subscriptionId', 'seq', 'taskId', 'revision', 'kind', 'payload']) && value.contractVersion === 1
    && uuid(value.subscriptionId) && integer(value.seq) && value.seq >= 1 && uuid(value.taskId) && integer(value.revision) && value.revision >= 1
    && value.kind === 'task:changed' && isTaskSnapshot(value.payload) && value.taskId === value.payload.taskId && value.revision === value.payload.revision;
}
