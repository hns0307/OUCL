import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';

export const RESOURCE_CHANNELS = ['resources:search', 'resources:versions', 'resources:download', 'resources:library', 'resources:open'] as const;
export type ResourceChannel = typeof RESOURCE_CHANNELS[number];
export type ResourceKind = 'mod' | 'resourcepack' | 'shader';
export interface ResourceQuery { kind: ResourceKind; query: string; gameVersion: string; loader: string; offset: number }
export interface ResourceProject { projectId: string; title: string; author: string; description: string; downloads: number; kind: ResourceKind }
export interface ResourceFile { fileId: string; filename: string; size: number; primary: boolean }
export interface ResourceVersion { versionId: string; name: string; gameVersions: string[]; loaders: string[]; files: ResourceFile[] }
export interface LibraryItem { fileId: string; taskId: string; projectId: string; versionId: string; kind: ResourceKind; title: string; versionName: string; filename: string; size: number; downloaded: boolean; errorCode?: ResourceCode }
export interface ResourcePayloads {
  'resources:search': ResourceQuery;
  'resources:versions': { projectId: string; gameVersion: string; loader: string };
  'resources:download': { projectId: string; versionId: string; fileId: string };
  'resources:library': Record<string, never>;
  'resources:open': Record<string, never>;
}
export interface ResourceData {
  'resources:search': { items: ResourceProject[]; total: number; offset: number };
  'resources:versions': { items: ResourceVersion[] };
  'resources:download': { taskId: string };
  'resources:library': { items: LibraryItem[] };
  'resources:open': { opened: true };
}
export type ResourceCode = AppError['code'] | 'NETWORK_FAILED' | 'RETRY_LATER' | 'HASH_MISMATCH' | 'ROOT_UNAVAILABLE' | 'NEEDS_RECOVERY';
export interface ResourceError extends Omit<AppError, 'code'> { code: ResourceCode }
export type ResourceResult<C extends ResourceChannel> = { contractVersion: 1; requestId: string; ok: true; data: ResourceData[C] }
  | { contractVersion: 1; requestId: string; ok: false; error: ResourceError };
export interface ResourcesBridge {
  searchResources(input: ResourceQuery): Promise<ResourceResult<'resources:search'>>;
  resourceVersions(input: ResourcePayloads['resources:versions']): Promise<ResourceResult<'resources:versions'>>;
  downloadResource(requestId: string, input: ResourcePayloads['resources:download']): Promise<ResourceResult<'resources:download'>>;
  resourceLibrary(): Promise<ResourceResult<'resources:library'>>;
  openResourceLibrary(): Promise<ResourceResult<'resources:open'>>;
}
export interface ResourceDispatcher { <C extends ResourceChannel>(channel: C, payload: ResourcePayloads[C], requestId: string): Promise<ResourceData[C]> }
export class ResourceContractError extends Error { constructor(readonly code: ResourceCode) { super(code); this.name = 'ResourceContractError'; } }
export const resourceId = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9]{8}$/.test(x);
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max && !/[\p{C}]/u.test(x);
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
export const resourceKind = (x: unknown): x is ResourceKind => x === 'mod' || x === 'resourcepack' || x === 'shader';
export const resourceFilename = (x: unknown): x is string => text(x, 180) && x.length > 0 && !/[<>:"/\\|?*]/.test(x) && !/[. ]$/.test(x)
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x) && /\.(jar|zip)$/i.test(x);
const filter = (x: unknown): x is string => text(x, 64) && /^[a-zA-Z0-9_.+ -]*$/.test(x);
export const resourceLoader = (x: unknown): x is string => typeof x === 'string' && ['', 'fabric', 'quilt', 'forge', 'neoforge', 'minecraft', 'iris', 'optifine', 'vanilla', 'canvas'].includes(x);
const stringList = (x: unknown): x is string[] => Array.isArray(x) && x.length <= 500 && x.every(s => text(s, 80));
/** Accepts identifiers and filters only; URLs, paths and arbitrary categories never cross preload. */
export function isResourcePayload<C extends ResourceChannel>(x: unknown, channel: C): x is ResourcePayloads[C] {
  if (channel === 'resources:search') return exactObject(x, ['kind', 'query', 'gameVersion', 'loader', 'offset']) && resourceKind(x.kind)
    && text(x.query, 120) && filter(x.gameVersion) && resourceLoader(x.loader) && integer(x.offset) && x.offset <= 10000;
  if (channel === 'resources:versions') return exactObject(x, ['projectId', 'gameVersion', 'loader']) && resourceId(x.projectId) && filter(x.gameVersion) && resourceLoader(x.loader);
  if (channel === 'resources:download') return exactObject(x, ['projectId', 'versionId', 'fileId']) && resourceId(x.projectId) && resourceId(x.versionId) && typeof x.fileId === 'string' && /^[a-f0-9]{40}$/.test(x.fileId);
  return (channel === 'resources:library' || channel === 'resources:open') && exactObject(x, []);
}
export function isLibraryItem(x: unknown): x is LibraryItem {
  return exactObject(x, ['fileId', 'taskId', 'projectId', 'versionId', 'kind', 'title', 'versionName', 'filename', 'size', 'downloaded', ...(typeof x === 'object' && x !== null && Object.hasOwn(x, 'errorCode') ? ['errorCode'] : [])])
    && typeof x.fileId === 'string' && /^[a-f0-9]{40}$/.test(x.fileId) && typeof x.taskId === 'string' && UUID_PATTERN.test(x.taskId) && resourceId(x.projectId) && resourceId(x.versionId) && resourceKind(x.kind)
    && text(x.title, 200) && text(x.versionName, 200) && resourceFilename(x.filename) && integer(x.size) && x.size <= 2 * 1024 ** 3 && typeof x.downloaded === 'boolean'
    && (!Object.hasOwn(x, 'errorCode') || typeof x.errorCode === 'string' && Object.hasOwn(ERRORS, x.errorCode));
}
export function isResourceVersion(x: unknown): x is ResourceVersion {
  return exactObject(x, ['versionId', 'name', 'gameVersions', 'loaders', 'files']) && resourceId(x.versionId) && text(x.name, 200)
    && stringList(x.gameVersions) && stringList(x.loaders) && Array.isArray(x.files) && x.files.length <= 50 && x.files.every(f =>
      exactObject(f, ['fileId', 'filename', 'size', 'primary']) && typeof f.fileId === 'string' && /^[a-f0-9]{40}$/.test(f.fileId)
      && resourceFilename(f.filename) && integer(f.size) && f.size <= 2 * 1024 ** 3 && typeof f.primary === 'boolean');
}
/** Rejects unexpected upstream fields and private filesystem facts in public replies. */
export function isResourceData<C extends ResourceChannel>(x: unknown, channel: C): x is ResourceData[C] {
  if (channel === 'resources:search') return exactObject(x, ['items', 'total', 'offset']) && integer(x.total) && integer(x.offset) && Array.isArray(x.items) && x.items.length <= 20 && x.items.every(p =>
    exactObject(p, ['projectId', 'title', 'author', 'description', 'downloads', 'kind']) && resourceId(p.projectId) && text(p.title, 200) && text(p.author, 200) && text(p.description, 1000) && integer(p.downloads) && resourceKind(p.kind));
  if (channel === 'resources:versions') return exactObject(x, ['items']) && Array.isArray(x.items) && x.items.length <= 100 && x.items.every(isResourceVersion);
  if (channel === 'resources:download') return exactObject(x, ['taskId']) && typeof x.taskId === 'string' && UUID_PATTERN.test(x.taskId);
  if (channel === 'resources:library') return exactObject(x, ['items']) && Array.isArray(x.items) && x.items.length <= 512 && x.items.every(isLibraryItem);
  return channel === 'resources:open' && exactObject(x, ['opened']) && x.opened === true;
}
const ERRORS: Record<ResourceCode, { category: AppError['category']; key: MessageKey }> = {
  INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument' }, UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract' },
  INVALID_SENDER: { category: 'permission', key: 'invalidSender' }, TIMEOUT: { category: 'system', key: 'timeout' }, UNAVAILABLE: { category: 'system', key: 'unavailable' },
  NETWORK_FAILED: { category: 'network', key: 'resourceNetworkFailed' }, RETRY_LATER: { category: 'network', key: 'resourceRateLimited' },
  HASH_MISMATCH: { category: 'network', key: 'resourceHashMismatch' }, ROOT_UNAVAILABLE: { category: 'disk', key: 'chooseRootFirst' }, NEEDS_RECOVERY: { category: 'disk', key: 'stageRecovery' },
};
export function resourceFailure<C extends ResourceChannel>(requestId: string, code: ResourceCode, traceId: string): ResourceResult<C> {
  const e = ERRORS[code]; return { contractVersion: 1, requestId, ok: false, error: { category: e.category, code, messageKey: e.key, traceId, retryable: !['INVALID_ARGUMENT', 'INVALID_SENDER', 'UNSUPPORTED_CONTRACT', 'NEEDS_RECOVERY'].includes(code) } };
}
export function isResourceResult<C extends ResourceChannel>(x: unknown, requestId: string, channel: C): x is ResourceResult<C> {
  if (!exactObject(x, ['contractVersion', 'requestId', 'ok', typeof x === 'object' && x !== null && 'ok' in x && x.ok === true ? 'data' : 'error']) || x.contractVersion !== 1 || x.requestId !== requestId) return false;
  if (x.ok === true) return isResourceData(x.data, channel);
  if (x.ok !== false || !exactObject(x.error, ['category', 'code', 'messageKey', 'traceId', 'retryable']) || typeof x.error.code !== 'string' || !Object.hasOwn(ERRORS, x.error.code) || typeof x.error.traceId !== 'string' || !UUID_PATTERN.test(x.error.traceId)) return false;
  return x.error.category === ERRORS[x.error.code as ResourceCode].category && x.error.messageKey === ERRORS[x.error.code as ResourceCode].key
    && x.error.retryable === (!['INVALID_ARGUMENT', 'INVALID_SENDER', 'UNSUPPORTED_CONTRACT', 'NEEDS_RECOVERY'].includes(x.error.code));
}
