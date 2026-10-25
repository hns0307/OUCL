import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';

export const LOADERS_CAPABILITY = 'loaders.v1' as const;
export const LOADER_CHANNELS = ['loaders:versions', 'loaders:create'] as const;
export type LoaderChannel = typeof LOADER_CHANNELS[number];
export type LoaderKind = 'fabric' | 'quilt' | 'forge' | 'neoforge';
export type IsolationMode = 'inherit' | 'on' | 'off';
export interface LoaderVersionItem { loaderVersion: string; stable: boolean; support: 'verified' | 'unverified' }
export interface LoaderPayloads {
  'loaders:versions': { minecraftVersion: string; loader: LoaderKind };
  'loaders:create': { rootId: string; minecraftVersion: string; loader: LoaderKind; loaderVersion: string; displayName: string; isolation: IsolationMode };
}
export interface LoaderData {
  'loaders:versions': { items: LoaderVersionItem[] };
  'loaders:create': { taskId: string };
}
export type LoaderCode = AppError['code'] | 'NETWORK_FAILED' | 'UNTRUSTED_METADATA' | 'VERSION_UNSUPPORTED'
  | 'ROOT_UNAVAILABLE' | 'NAME_CONFLICT' | 'INSTALL_FAILED' | 'NEEDS_RECOVERY';
export interface LoaderError extends Omit<AppError, 'code'> { code: LoaderCode }
export type LoaderResult<C extends LoaderChannel> = { contractVersion: 1; requestId: string; ok: true; data: LoaderData[C] }
  | { contractVersion: 1; requestId: string; ok: false; error: LoaderError };
export interface LoaderDispatcher { <C extends LoaderChannel>(channel: C, payload: LoaderPayloads[C], requestId: string): Promise<LoaderData[C]> }
export interface LoadersBridge {
  loaderVersions(input: LoaderPayloads['loaders:versions']): Promise<LoaderResult<'loaders:versions'>>;
  createLoaderInstance(requestId: string, input: LoaderPayloads['loaders:create']): Promise<LoaderResult<'loaders:create'>>;
}
export class LoaderContractError extends Error { constructor(readonly code: LoaderCode) { super(code); this.name = 'LoaderContractError'; } }

const ERRORS: Record<LoaderCode, { category: AppError['category']; key: MessageKey; retryable: boolean }> = {
  INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument', retryable: false },
  UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract', retryable: false },
  INVALID_SENDER: { category: 'permission', key: 'invalidSender', retryable: false },
  TIMEOUT: { category: 'system', key: 'timeout', retryable: true },
  UNAVAILABLE: { category: 'system', key: 'unavailable', retryable: true },
  NETWORK_FAILED: { category: 'network', key: 'resourceNetworkFailed', retryable: true },
  UNTRUSTED_METADATA: { category: 'network', key: 'untrustedManifest', retryable: false },
  VERSION_UNSUPPORTED: { category: 'minecraft', key: 'unavailable', retryable: false },
  ROOT_UNAVAILABLE: { category: 'disk', key: 'rootUnavailable', retryable: true },
  NAME_CONFLICT: { category: 'biz', key: 'invalidArgument', retryable: false },
  INSTALL_FAILED: { category: 'minecraft', key: 'unavailable', retryable: true },
  NEEDS_RECOVERY: { category: 'disk', key: 'unavailable', retryable: false }
};

function uuid(value: unknown): value is string { return typeof value === 'string' && UUID_PATTERN.test(value); }
export function loaderKind(value: unknown): value is LoaderKind {
  return value === 'fabric' || value === 'quilt' || value === 'forge' || value === 'neoforge';
}
export function loaderVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_.+-]{1,160}$/.test(value) && value !== '.' && value !== '..';
}
function name(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80 && value.trim() === value && !/[\p{C}]/u.test(value);
}
function isolation(value: unknown): value is IsolationMode { return value === 'inherit' || value === 'on' || value === 'off'; }

/** Accepts controlled identifiers only; paths, URLs and arbitrary installer arguments never cross IPC. */
export function isLoaderPayload<C extends LoaderChannel>(value: unknown, channel: C): value is LoaderPayloads[C] {
  if (channel === 'loaders:versions') return exactObject(value, ['minecraftVersion', 'loader'])
    && loaderVersion(value.minecraftVersion) && loaderKind(value.loader);
  return channel === 'loaders:create' && exactObject(value, ['rootId', 'minecraftVersion', 'loader', 'loaderVersion', 'displayName', 'isolation'])
    && uuid(value.rootId) && loaderVersion(value.minecraftVersion) && loaderKind(value.loader) && loaderVersion(value.loaderVersion)
    && name(value.displayName) && isolation(value.isolation);
}

export function isLoaderVersionItem(value: unknown): value is LoaderVersionItem {
  return exactObject(value, ['loaderVersion', 'stable', 'support']) && loaderVersion(value.loaderVersion)
    && typeof value.stable === 'boolean' && (value.support === 'verified' || value.support === 'unverified');
}
export function isLoaderData<C extends LoaderChannel>(value: unknown, channel: C): value is LoaderData[C] {
  if (channel === 'loaders:versions') return exactObject(value, ['items']) && Array.isArray(value.items) && value.items.length <= 2048
    && value.items.every(isLoaderVersionItem) && new Set(value.items.map(item => item.loaderVersion)).size === value.items.length;
  return channel === 'loaders:create' && exactObject(value, ['taskId']) && uuid(value.taskId);
}
export function loaderFailure<C extends LoaderChannel>(requestId: string, code: LoaderCode, traceId: string): LoaderResult<C> {
  const expected = ERRORS[code];
  return { contractVersion: 1, requestId, ok: false, error: { category: expected.category, code, messageKey: expected.key, retryable: expected.retryable, traceId } };
}
export function isLoaderResult<C extends LoaderChannel>(value: unknown, requestId: string, channel: C): value is LoaderResult<C> {
  if (!exactObject(value, ['contractVersion', 'requestId', 'ok', value && typeof value === 'object' && 'ok' in value && value.ok === true ? 'data' : 'error'])
    || value.contractVersion !== 1 || value.requestId !== requestId) return false;
  if (value.ok === true) return isLoaderData(value.data, channel);
  if (value.ok !== false || !exactObject(value.error, ['category', 'code', 'messageKey', 'retryable', 'traceId'])
    || typeof value.error.code !== 'string' || !Object.hasOwn(ERRORS, value.error.code) || !uuid(value.error.traceId)) return false;
  const expected = ERRORS[value.error.code as LoaderCode];
  return value.error.category === expected.category && value.error.messageKey === expected.key && value.error.retryable === expected.retryable;
}
