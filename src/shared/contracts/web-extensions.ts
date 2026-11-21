import { exactObject, UUID_PATTERN } from './handshake.js';

export const WEB_EXTENSIONS_CAPABILITY = 'web-extensions.v1' as const;
export const WEB_EXTENSIONS_CHANNEL = 'web:request' as const;
export const MAX_WEB_TABS = 12;
export const MAX_WEB_DOWNLOADS = 24;
export const MAX_WEB_DOWNLOAD_BYTES = 256 * 1024 ** 2;
export const MAX_WEB_BOOKMARKS = 64;

export type WebBounds = { x: number; y: number; width: number; height: number };
export type WebFileKind = 'unknown' | 'mod' | 'modpack' | 'resourcepack' | 'shader' | 'skin';
export type WebDownloadState = 'confirmation' | 'downloading' | 'checking' | 'ready' | 'failed' | 'cancelled';
export type WebAction = { kind: 'state' | 'deactivate' | 'newTab' | 'clearSession' }
  | { kind: 'layout'; bounds: WebBounds | null }
  | { kind: 'open'; url: string }
  | { kind: 'navigate'; tabId: string; url: string }
  | { kind: 'select' | 'closeTab' | 'back' | 'forward' | 'reload' | 'external' | 'bookmark'; tabId: string }
  | { kind: 'zoom'; tabId: string; factor: number }
  | { kind: 'openBookmark' | 'removeBookmark'; bookmarkId: string }
  | { kind: 'acceptPopup' | 'dismissPopup'; popupId: string }
  | { kind: 'download' | 'cancelDownload' | 'exportDownload' | 'removeDownload' | 'prepareMod' | 'skinDraft'; downloadId: string }
  | { kind: 'installPack'; downloadId: string; name: string }
  | { kind: 'importAddon'; downloadId: string; instanceId: string; revision: number };

export interface WebTab {
  id: string; url: string; title: string; status: 'blank' | 'loading' | 'ready' | 'failed';
  canBack: boolean; canForward: boolean; zoom: number; icon: string | null; adapter: 'modrinth' | null;
}
export interface WebBookmark { id: string; url: string; title: string }
export interface WebPackPreview {
  name: string; minecraft: string; loader: string; required: number; optional: number; overrides: number;
}
export interface WebDownload {
  id: string; filename: string; origin: string; fileKind: WebFileKind; status: WebDownloadState;
  receivedBytes: number; totalBytes: number | null; note: 'imported' | 'resourceQueued' | 'packQueued' | 'archiveRejected' | null;
  packPreview: WebPackPreview | null; packTaskId: string | null;
}
export interface WebSnapshot {
  revision: number; tabs: WebTab[]; activeId: string | null; bookmarks: WebBookmark[]; downloads: WebDownload[];
  popup: { id: string; origin: string } | null; packImport: boolean;
  skinDraft?: Uint8Array;
}
export const WEB_ERRORS = [
  'INVALID_ARGUMENT', 'INVALID_SENDER', 'UNSUPPORTED_CONTRACT', 'URL_BLOCKED', 'LIMIT', 'NOT_FOUND', 'REQUEST_CONFLICT',
  'TIMEOUT', 'UNAVAILABLE', 'INSTANCE_BUSY', 'INSTANCE_CHANGED', 'FILE_EXISTS', 'UNSUPPORTED_IMPORT',
] as const;
export type WebErrorCode = typeof WEB_ERRORS[number];
export interface WebRequest { contractVersion: 1; requestId: string; action: WebAction }
export type WebResult = { contractVersion: 1; requestId: string; ok: true; data: WebSnapshot }
  | { contractVersion: 1; requestId: string; ok: false; error: WebErrorCode };
export interface WebExtensionsBridge { webExtensions(action: WebAction): Promise<WebResult> }

export function webId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !/[\p{C}]/u.test(value);
}

function integer(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function zoom(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= .5 && value <= 2;
}

function bounds(value: unknown): value is WebBounds {
  return exactObject(value, ['x', 'y', 'width', 'height'])
    && ['x', 'y', 'width', 'height'].every(key => integer(value[key], 30000));
}

/** Checks every action variant before the trusted launcher bridge dispatches it. */
export function isWebAction(input: unknown): input is WebAction {
  if (typeof input !== 'object' || !input || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  switch (value.kind) {
    case 'state': case 'deactivate': case 'newTab': case 'clearSession':
      return exactObject(value, ['kind']);
    case 'layout':
      return exactObject(value, ['kind', 'bounds']) && (value.bounds === null || bounds(value.bounds));
    case 'open':
      return exactObject(value, ['kind', 'url']) && text(value.url, 4096) && !!value.url;
    case 'navigate':
      return exactObject(value, ['kind', 'tabId', 'url']) && webId(value.tabId) && text(value.url, 4096) && !!value.url;
    case 'select': case 'closeTab': case 'back': case 'forward': case 'reload': case 'external': case 'bookmark':
      return exactObject(value, ['kind', 'tabId']) && webId(value.tabId);
    case 'zoom':
      return exactObject(value, ['kind', 'tabId', 'factor']) && webId(value.tabId) && zoom(value.factor);
    case 'openBookmark': case 'removeBookmark':
      return exactObject(value, ['kind', 'bookmarkId']) && webId(value.bookmarkId);
    case 'acceptPopup': case 'dismissPopup':
      return exactObject(value, ['kind', 'popupId']) && webId(value.popupId);
    case 'download': case 'cancelDownload': case 'exportDownload': case 'removeDownload': case 'prepareMod': case 'skinDraft':
      return exactObject(value, ['kind', 'downloadId']) && webId(value.downloadId);
    case 'installPack':
      return exactObject(value, ['kind', 'downloadId', 'name']) && webId(value.downloadId)
        && text(value.name, 80) && value.name.trim() === value.name && value.name.length > 0;
    case 'importAddon':
      return exactObject(value, ['kind', 'downloadId', 'instanceId', 'revision'])
        && webId(value.downloadId) && webId(value.instanceId) && integer(value.revision, Number.MAX_SAFE_INTEGER) && value.revision > 0;
  }
  return false;
}

export function isWebBookmark(value: unknown): value is WebBookmark {
  return exactObject(value, ['id', 'url', 'title']) && webId(value.id) && text(value.url, 4096) && value.url.startsWith('https://')
    && text(value.title, 160);
}

function tab(value: unknown): value is WebTab {
  return exactObject(value, ['id', 'url', 'title', 'status', 'canBack', 'canForward', 'zoom', 'icon', 'adapter'])
    && webId(value.id) && text(value.url, 4096) && (!value.url || value.url.startsWith('https://')) && text(value.title, 160)
    && (value.status === 'blank' || value.status === 'loading' || value.status === 'ready' || value.status === 'failed')
    && typeof value.canBack === 'boolean' && typeof value.canForward === 'boolean' && zoom(value.zoom)
    && (value.icon === null || typeof value.icon === 'string' && value.icon.length <= 22000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.icon))
    && (value.adapter === null || value.adapter === 'modrinth');
}

export function isWebPackPreview(value: unknown): value is WebPackPreview {
  return exactObject(value, ['name', 'minecraft', 'loader', 'required', 'optional', 'overrides'])
    && text(value.name, 80) && !!value.name && text(value.minecraft, 160) && !!value.minecraft
    && text(value.loader, 160) && !!value.loader && integer(value.required, 512) && integer(value.optional, 512) && integer(value.overrides, 4096);
}

function download(value: unknown): value is WebDownload {
  return exactObject(value, ['id', 'filename', 'origin', 'fileKind', 'status', 'receivedBytes', 'totalBytes', 'note', 'packPreview', 'packTaskId'])
    && webId(value.id) && text(value.filename, 180) && text(value.origin, 256) && value.origin.startsWith('https://')
    && typeof value.fileKind === 'string' && ['unknown', 'mod', 'modpack', 'resourcepack', 'shader', 'skin'].includes(value.fileKind)
    && typeof value.status === 'string' && ['confirmation', 'downloading', 'checking', 'ready', 'failed', 'cancelled'].includes(value.status)
    && integer(value.receivedBytes, MAX_WEB_DOWNLOAD_BYTES)
    && (value.totalBytes === null || integer(value.totalBytes, MAX_WEB_DOWNLOAD_BYTES))
    && (value.note === null || value.note === 'imported' || value.note === 'resourceQueued' || value.note === 'packQueued' || value.note === 'archiveRejected')
    && (value.packPreview === null || isWebPackPreview(value.packPreview)) && (value.packTaskId === null || webId(value.packTaskId));
}

/** Keeps private paths, raw download URLs and Chromium state out of the renderer. */
export function isWebResult(input: unknown, requestId: string): input is WebResult {
  if (typeof input !== 'object' || !input || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (value.ok === false) return exactObject(value, ['contractVersion', 'requestId', 'ok', 'error'])
    && value.contractVersion === 1 && value.requestId === requestId && WEB_ERRORS.includes(value.error as WebErrorCode);
  if (value.ok !== true || !exactObject(value, ['contractVersion', 'requestId', 'ok', 'data'])
    || value.contractVersion !== 1 || value.requestId !== requestId) return false;
  const data = value.data;
  const baseKeys = ['revision', 'tabs', 'activeId', 'bookmarks', 'downloads', 'popup', 'packImport'];
  const hasSkin = typeof data === 'object' && data !== null && Object.hasOwn(data, 'skinDraft');
  return exactObject(data, hasSkin ? [...baseKeys, 'skinDraft'] : baseKeys)
    && (!hasSkin || data.skinDraft instanceof Uint8Array && data.skinDraft.byteLength > 0 && data.skinDraft.byteLength <= 1024 ** 2)
    && integer(data.revision, Number.MAX_SAFE_INTEGER) && typeof data.packImport === 'boolean'
    && Array.isArray(data.tabs) && data.tabs.length <= MAX_WEB_TABS && data.tabs.every(tab)
    && (data.activeId === null || webId(data.activeId) && data.tabs.some(item => item.id === data.activeId))
    && Array.isArray(data.bookmarks) && data.bookmarks.length <= MAX_WEB_BOOKMARKS && data.bookmarks.every(isWebBookmark)
    && Array.isArray(data.downloads) && data.downloads.length <= MAX_WEB_DOWNLOADS && data.downloads.every(download)
    && (data.popup === null || exactObject(data.popup, ['id', 'origin']) && webId(data.popup.id) && text(data.popup.origin, 256)
      && data.popup.origin.startsWith('https://'));
}

export function webFailure(requestId: string, error: WebErrorCode): WebResult {
  return { contractVersion: 1, requestId, ok: false, error };
}
