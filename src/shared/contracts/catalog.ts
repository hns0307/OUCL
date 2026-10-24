import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';

export const CATALOG_CHANNEL = 'versions:catalog' as const;
export const CATALOG_CAPABILITY = 'catalog.v1' as const;
export interface CatalogQuery { channel: 'release' | 'snapshot' | 'old'; limit: number; cursor?: string }
export interface CatalogItem { mcVersionId: string; type: 'release' | 'snapshot' | 'old_alpha' | 'old_beta'; releaseTime: string; status: 'verified' | 'candidate' | 'unsupported' }
export interface CatalogData { page: { items: CatalogItem[]; nextCursor?: string }; fetchedAt: string; cached: boolean }
export type CatalogCode = AppError['code'] | 'CATALOG_UNAVAILABLE' | 'UNTRUSTED_MANIFEST';
export interface CatalogError extends Omit<AppError, 'code'> { code: CatalogCode }
export type CatalogResult = { contractVersion: 1; requestId: string; ok: true; data: CatalogData }
  | { contractVersion: 1; requestId: string; ok: false; error: CatalogError };
export interface CatalogBridge { catalog(query: CatalogQuery): Promise<CatalogResult> }
const ERRORS: Record<CatalogCode, { category: AppError['category']; key: MessageKey }> = {
  INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument' }, INVALID_SENDER: { category: 'permission', key: 'invalidSender' },
  UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract' }, TIMEOUT: { category: 'system', key: 'timeout' }, UNAVAILABLE: { category: 'system', key: 'unavailable' },
  CATALOG_UNAVAILABLE: { category: 'network', key: 'catalogUnavailable' }, UNTRUSTED_MANIFEST: { category: 'network', key: 'untrustedManifest' },
};
/** Strict public query: no URLs, paths, raw metadata or arbitrary filters. */
export function isCatalogQuery(value: unknown): value is CatalogQuery {
  return exactObject(value, value && typeof value === 'object' && 'cursor' in value ? ['channel', 'limit', 'cursor'] : ['channel', 'limit'])
    && typeof value.channel === 'string' && ['release', 'snapshot', 'old'].includes(value.channel)
    && typeof value.limit === 'number' && Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= 100
    && (!Object.hasOwn(value, 'cursor') || typeof value.cursor === 'string' && value.cursor.length >= 1 && value.cursor.length <= 512);
}
/** Validates the existing versioned request envelope with the catalog query schema. */
export function isCatalogRequest(value: unknown): value is { contractVersion: 1; requestId: string; payload: CatalogQuery } {
  return exactObject(value, ['contractVersion', 'requestId', 'payload']) && value.contractVersion === 1 && typeof value.requestId === 'string'
    && UUID_PATTERN.test(value.requestId) && isCatalogQuery(value.payload);
}
/** Produces a bounded redacted error using the declared category/message mapping. */
export function catalogFailure(requestId: string, code: CatalogCode, traceId: string): CatalogResult {
  const expected = ERRORS[code];
  return { contractVersion: 1, requestId, ok: false, error: { code, category: expected.category, messageKey: expected.key,
    retryable: ['TIMEOUT', 'UNAVAILABLE', 'CATALOG_UNAVAILABLE'].includes(code), traceId } };
}
function iso(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)); }
/** Rejects extra fields and upstream URLs before results cross preload into the renderer. */
export function isCatalogResult(value: unknown, requestId: string): value is CatalogResult {
  if (!exactObject(value, ['contractVersion', 'requestId', 'ok', value && typeof value === 'object' && 'ok' in value && value.ok === true ? 'data' : 'error'])
    || value.contractVersion !== 1 || value.requestId !== requestId) return false;
  if (value.ok === false) {
    const error = value.error;
    if (!exactObject(error, ['category', 'code', 'messageKey', 'retryable', 'traceId']) || typeof error.code !== 'string' || !Object.hasOwn(ERRORS, error.code)) return false;
    const expected = catalogFailure(requestId, error.code as CatalogCode, requestId);
    return !expected.ok && error.category === expected.error.category && error.messageKey === expected.error.messageKey && error.retryable === expected.error.retryable
      && typeof error.traceId === 'string' && UUID_PATTERN.test(error.traceId);
  }
  const data = value.data;
  if (value.ok !== true || !exactObject(data, ['page', 'fetchedAt', 'cached']) || !iso(data.fetchedAt) || typeof data.cached !== 'boolean'
    || !exactObject(data.page, data.page && typeof data.page === 'object' && 'nextCursor' in data.page ? ['items', 'nextCursor'] : ['items'])
    || !Array.isArray(data.page.items) || data.page.items.length > 100
    || Object.hasOwn(data.page, 'nextCursor') && (typeof data.page.nextCursor !== 'string' || data.page.nextCursor.length < 1 || data.page.nextCursor.length > 512)) return false;
  const seen = new Set<string>();
  return data.page.items.every((item: unknown) => {
    if (!exactObject(item, ['mcVersionId', 'type', 'releaseTime', 'status']) || typeof item.mcVersionId !== 'string'
      || !/^[a-zA-Z0-9_.+ -]{1,160}$/.test(item.mcVersionId) || item.mcVersionId.trim() !== item.mcVersionId || ['.', '..'].includes(item.mcVersionId) || seen.has(item.mcVersionId)
      || typeof item.type !== 'string' || !['release', 'snapshot', 'old_alpha', 'old_beta'].includes(item.type)
      || typeof item.status !== 'string' || !['verified', 'candidate', 'unsupported'].includes(item.status) || !iso(item.releaseTime)) return false;
    seen.add(item.mcVersionId); return true;
  });
}
