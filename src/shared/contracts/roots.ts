import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';
import { MESSAGES } from '../locales/messages.js';

export const ROOTS_CAPABILITY = 'roots.v1' as const;
export const ROOTS_LIST_CHANNEL = 'roots:list' as const;
export const ROOTS_CHOOSE_CHANNEL = 'roots:choose' as const;
export type RootCode = AppError['code'] | 'ROOT_UNAVAILABLE' | 'ROOT_OUT_OF_SCOPE' | 'PERMISSION_DENIED';
export interface RootError extends Omit<AppError, 'code'> { code: RootCode }
export interface RootSummary { rootId: string; label: string; available: boolean }
export interface RootsRequest { contractVersion: 1; requestId: string; payload: Record<string, never> }
export type RootSelection = { selection: 'cancelled' } | { selection: 'chosen'; rootId: string; label: string };
export type RootsData = { items: RootSummary[] } | RootSelection;
export type RootsResult<T extends RootsData> = { contractVersion: 1; requestId: string; ok: true; data: T }
  | { contractVersion: 1; requestId: string; ok: false; error: RootError };
export interface RootsBridge {
  listRoots(): Promise<RootsResult<{ items: RootSummary[] }>>;
  chooseRoot(requestId: string): Promise<RootsResult<RootSelection>>;
}
const ERROR_MAP: Record<RootCode, { category: AppError['category']; key: MessageKey }> = {
  INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument' }, UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract' },
  INVALID_SENDER: { category: 'permission', key: 'invalidSender' }, TIMEOUT: { category: 'system', key: 'timeout' }, UNAVAILABLE: { category: 'system', key: 'unavailable' },
  ROOT_UNAVAILABLE: { category: 'disk', key: 'rootUnavailable' }, ROOT_OUT_OF_SCOPE: { category: 'permission', key: 'rootOutOfScope' },
  PERMISSION_DENIED: { category: 'permission', key: 'permissionDenied' },
};
/** Accepts no renderer-supplied paths, filters or unknown fields. */
export function isRootsRequest(value: unknown): value is RootsRequest {
  return exactObject(value, ['contractVersion', 'requestId', 'payload']) && value.contractVersion === 1
    && typeof value.requestId === 'string' && UUID_PATTERN.test(value.requestId) && exactObject(value.payload, []);
}
/** Creates a consistent fixed error; no source exception text is copied. */
export function rootsFailure<T extends RootsData>(requestId: string, code: RootCode, traceId: string): RootsResult<T> {
  const spec = ERROR_MAP[code];
  return { contractVersion: 1, requestId, ok: false, error: { category: spec.category, code, messageKey: spec.key,
    retryable: ['TIMEOUT', 'UNAVAILABLE', 'ROOT_UNAVAILABLE', 'PERMISSION_DENIED'].includes(code), traceId } };
}
function label(value: unknown): value is string {
  const prefix = `${MESSAGES.rootLabel} `;
  return typeof value === 'string' && value.startsWith(prefix) && /^[1-9][0-9]{0,2}$/.test(value.slice(prefix.length));
}
function root(value: unknown): value is RootSummary {
  return exactObject(value, ['rootId', 'label', 'available']) && typeof value.rootId === 'string' && UUID_PATTERN.test(value.rootId)
    && label(value.label) && typeof value.available === 'boolean';
}
/** Validates exact request correlation, redacted labels and the selected channel's result schema. */
export function isRootsResult(value: unknown, requestId: string, channel: 'list' | 'choose'): value is RootsResult<RootsData> {
  if (!exactObject(value, ['contractVersion', 'requestId', 'ok', value && typeof value === 'object' && 'ok' in value && value.ok === true ? 'data' : 'error'])
    || value.contractVersion !== 1 || value.requestId !== requestId) return false;
  if (value.ok === false) {
    const error = value.error;
    if (!exactObject(error, ['category', 'code', 'messageKey', 'retryable', 'traceId']) || typeof error.code !== 'string' || !Object.hasOwn(ERROR_MAP, error.code)) return false;
    const expected = rootsFailure(requestId, error.code as RootCode, requestId);
    return !expected.ok && error.category === expected.error.category && error.messageKey === expected.error.messageKey
      && error.retryable === expected.error.retryable && typeof error.traceId === 'string' && UUID_PATTERN.test(error.traceId);
  }
  if (value.ok !== true) return false;
  const data = value.data;
  if (channel === 'list') return exactObject(data, ['items']) && Array.isArray(data.items) && data.items.length <= 100
    && data.items.every(root) && new Set(data.items.map(item => (item as RootSummary).rootId)).size === data.items.length;
  return exactObject(data, ['selection']) && data.selection === 'cancelled'
    || exactObject(data, ['selection', 'rootId', 'label']) && data.selection === 'chosen' && typeof data.rootId === 'string' && UUID_PATTERN.test(data.rootId) && label(data.label);
}
