import { exactObject, UUID_PATTERN } from './handshake.js';
import { loaderKind, loaderVersion } from './loaders.js';
import type { LoaderKind } from './loaders.js';
import type { AppError } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';

export const INSTANCES_V2_CAPABILITY = 'instances.v2' as const;
export const INSTANCES_V2_LIST_CHANNEL = 'instances.v2:list' as const;
export interface InstanceLoaderIdentity { kind: 'vanilla' | LoaderKind; version?: string }
export interface InstanceV2Summary {
  instanceId: string; displayName: string; minecraftVersion: string; loader: InstanceLoaderIdentity;
  isolation: 'on' | 'off'; state: 'installing' | 'ready' | 'failed' | 'cancelled' | 'needsRecovery'; revision: number;
}
export type InstancesV2Code = AppError['code'] | 'ROOT_UNAVAILABLE' | 'NEEDS_RECOVERY';
export type InstancesV2Result = { contractVersion: 2; requestId: string; ok: true; data: { items: InstanceV2Summary[] } }
  | { contractVersion: 2; requestId: string; ok: false; error: Omit<AppError, 'code'> & { code: InstancesV2Code } };
export interface InstancesV2Bridge { listInstancesV2(rootId: string): Promise<InstancesV2Result> }
const ERRORS: Record<InstancesV2Code, { category: AppError['category']; key: MessageKey; retryable: boolean }> = {
  INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument', retryable: false },
  UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract', retryable: false },
  INVALID_SENDER: { category: 'permission', key: 'invalidSender', retryable: false },
  TIMEOUT: { category: 'system', key: 'timeout', retryable: true }, UNAVAILABLE: { category: 'system', key: 'unavailable', retryable: true },
  ROOT_UNAVAILABLE: { category: 'disk', key: 'rootUnavailable', retryable: true }, NEEDS_RECOVERY: { category: 'disk', key: 'unavailable', retryable: false }
};

function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function displayName(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80 && value.trim() === value && !/[\p{C}]/u.test(value);
}
export function isInstanceLoaderIdentity(value: unknown): value is InstanceLoaderIdentity {
  if (exactObject(value, ['kind'])) return value.kind === 'vanilla';
  return exactObject(value, ['kind', 'version']) && loaderKind(value.kind) && loaderVersion(value.version);
}
/** Validates the v2 public projection; no root, task, local path or raw metadata is exposed. */
export function isInstanceV2Summary(value: unknown): value is InstanceV2Summary {
  return exactObject(value, ['instanceId', 'displayName', 'minecraftVersion', 'loader', 'isolation', 'state', 'revision'])
    && typeof value.instanceId === 'string' && UUID_PATTERN.test(value.instanceId) && displayName(value.displayName)
    && loaderVersion(value.minecraftVersion) && isInstanceLoaderIdentity(value.loader)
    && (value.isolation === 'on' || value.isolation === 'off') && typeof value.state === 'string'
    && ['installing', 'ready', 'failed', 'cancelled', 'needsRecovery'].includes(value.state)
    && integer(value.revision) && value.revision > 0;
}
export function instancesV2Failure(requestId: string, code: InstancesV2Code, traceId: string): InstancesV2Result {
  const error = ERRORS[code]; return { contractVersion: 2, requestId, ok: false,
    error: { category: error.category, code, messageKey: error.key, retryable: error.retryable, traceId } };
}
export function isInstancesV2Result(value: unknown, requestId: string): value is InstancesV2Result {
  if (!exactObject(value, ['contractVersion', 'requestId', 'ok', value && typeof value === 'object' && 'ok' in value && value.ok === true ? 'data' : 'error'])
    || value.contractVersion !== 2 || value.requestId !== requestId) return false;
  if (value.ok === true) return exactObject(value.data, ['items']) && Array.isArray(value.data.items) && value.data.items.length <= 1000
    && value.data.items.every(isInstanceV2Summary) && new Set(value.data.items.map(item => item.instanceId)).size === value.data.items.length;
  if (value.ok !== false || !exactObject(value.error, ['category', 'code', 'messageKey', 'retryable', 'traceId'])
    || typeof value.error.code !== 'string' || !Object.hasOwn(ERRORS, value.error.code) || typeof value.error.traceId !== 'string' || !UUID_PATTERN.test(value.error.traceId)) return false;
  const error = ERRORS[value.error.code as InstancesV2Code];
  return value.error.category === error.category && value.error.messageKey === error.key && value.error.retryable === error.retryable;
}
