import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';

export const DESKTOP_CHANNELS = ['desktop:get', 'desktop:appearance', 'desktop:saveDraft', 'desktop:deleteDraft', 'desktop:chooseIcon', 'desktop:resourceIcon'] as const;
export type DesktopChannel = typeof DESKTOP_CHANNELS[number];
export type HomeCard = 'banner' | 'game' | 'community';
export interface Appearance { accent: string; background: string; surface: string; ink: string; icon: string; sidebarCollapsed: boolean; density: 'comfortable' | 'compact'; layout: 'balanced' | 'profile-left'; homeOrder: HomeCard[]; homeHidden: HomeCard[] }
export interface ForumDraft { id: string; title: string; category: 'general' | 'game' | 'mods' | 'builds'; body: string; updatedAt: string }
export interface DesktopState { appearance: Appearance; drafts: ForumDraft[] }
export interface DesktopSnapshot extends DesktopState { revision: number }
export const DEFAULT_APPEARANCE: Appearance = { accent: '#50765a', background: '#f6f8f4', surface: '#ffffff', ink: '#293c30', icon: '', sidebarCollapsed: false, density: 'comfortable', layout: 'balanced', homeOrder: ['banner', 'game', 'community'], homeHidden: [] };
export const validIcon = (x: unknown): x is string => typeof x === 'string' && (x === '' || x.length <= 180000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(x));
const color = (x: unknown): x is string => typeof x === 'string' && /^#[a-fA-F0-9]{6}$/.test(x);
const uuid = (x: unknown): x is string => typeof x === 'string' && UUID_PATTERN.test(x);
const revision = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
/** Exact theme values only, with a complete home order and a permanently available game card. */
export function isAppearance(x: unknown): x is Appearance {
  return exactObject(x, ['accent', 'background', 'surface', 'ink', 'icon', 'sidebarCollapsed', 'density', 'layout', 'homeOrder', 'homeHidden'])
    && color(x.accent) && color(x.background) && color(x.surface) && color(x.ink) && validIcon(x.icon) && typeof x.sidebarCollapsed === 'boolean'
    && ['comfortable', 'compact'].includes(x.density as string) && ['balanced', 'profile-left'].includes(x.layout as string)
    && Array.isArray(x.homeOrder) && x.homeOrder.length === 3 && new Set(x.homeOrder).size === 3 && x.homeOrder.every(v => ['banner', 'game', 'community'].includes(v as string))
    && Array.isArray(x.homeHidden) && x.homeHidden.length <= 2 && new Set(x.homeHidden).size === x.homeHidden.length && x.homeHidden.every(v => v === 'banner' || v === 'community');
}
/** Drafts are plain local text, never rendered as HTML or reported as published posts. */
export function isForumDraft(x: unknown): x is ForumDraft {
  return exactObject(x, ['id', 'title', 'category', 'body', 'updatedAt']) && uuid(x.id) && typeof x.title === 'string' && x.title.trim().length > 0 && x.title.length <= 120 && !/[\p{C}]/u.test(x.title)
    && ['general', 'game', 'mods', 'builds'].includes(x.category as string) && typeof x.body === 'string' && x.body.trim().length > 0 && x.body.length <= 20000
    && !Array.from(x.body).some(char => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char))
    && typeof x.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x.updatedAt) && Number.isFinite(Date.parse(x.updatedAt));
}
/** Fixed, bounded versioned desktop record. */
export function isDesktopState(x: unknown): x is DesktopState { return exactObject(x, ['appearance', 'drafts']) && isAppearance(x.appearance) && Array.isArray(x.drafts) && x.drafts.length <= 50 && x.drafts.every(isForumDraft) && new Set(x.drafts.map(v => v.id)).size === x.drafts.length; }
export interface DesktopPayloads {
  'desktop:get': Record<string, never>; 'desktop:chooseIcon': Record<string, never>;
  'desktop:appearance': { expectedRevision: number; appearance: Appearance };
  'desktop:saveDraft': { expectedRevision: number; draft: ForumDraft };
  'desktop:deleteDraft': { expectedRevision: number; id: string };
  'desktop:resourceIcon': { projectId: string };
}
export type DesktopData<C extends DesktopChannel> = C extends 'desktop:chooseIcon' | 'desktop:resourceIcon' ? { icon: string } : DesktopSnapshot;
export type DesktopCode = AppError['code'] | 'REVISION_CONFLICT';
export type DesktopResult<C extends DesktopChannel> = { contractVersion: 1; requestId: string; ok: true; data: DesktopData<C> } | { contractVersion: 1; requestId: string; ok: false; error: Omit<AppError, 'code'> & { code: DesktopCode } };
export interface DesktopBridge {
  getDesktop(): Promise<DesktopResult<'desktop:get'>>;
  updateAppearance(requestId: string, input: DesktopPayloads['desktop:appearance']): Promise<DesktopResult<'desktop:appearance'>>;
  saveForumDraft(requestId: string, input: DesktopPayloads['desktop:saveDraft']): Promise<DesktopResult<'desktop:saveDraft'>>;
  deleteForumDraft(requestId: string, input: DesktopPayloads['desktop:deleteDraft']): Promise<DesktopResult<'desktop:deleteDraft'>>;
  chooseDesktopIcon(requestId: string): Promise<DesktopResult<'desktop:chooseIcon'>>;
  resourceIcon(projectId: string): Promise<DesktopResult<'desktop:resourceIcon'>>;
}
/** Rejects paths, CSS strings, arbitrary URLs and unbounded text before the main process dispatches. */
export function isDesktopPayload<C extends DesktopChannel>(x: unknown, c: C): x is DesktopPayloads[C] {
  if (c === 'desktop:get' || c === 'desktop:chooseIcon') return exactObject(x, []);
  if (c === 'desktop:resourceIcon') return exactObject(x, ['projectId']) && typeof x.projectId === 'string' && /^[a-zA-Z0-9]{8}$/.test(x.projectId);
  if (c === 'desktop:appearance') return exactObject(x, ['expectedRevision', 'appearance']) && revision(x.expectedRevision) && isAppearance(x.appearance);
  if (c === 'desktop:saveDraft') return exactObject(x, ['expectedRevision', 'draft']) && revision(x.expectedRevision) && isForumDraft(x.draft);
  return c === 'desktop:deleteDraft' && exactObject(x, ['expectedRevision', 'id']) && revision(x.expectedRevision) && uuid(x.id);
}
/** Validates public snapshots and re-encoded local PNG thumbnails. */
export function isDesktopData<C extends DesktopChannel>(x: unknown, c: C): x is DesktopData<C> {
  if (c === 'desktop:chooseIcon' || c === 'desktop:resourceIcon') return exactObject(x, ['icon']) && validIcon(x.icon);
  if (!exactObject(x, ['revision', 'appearance', 'drafts']) || !revision(x.revision)) return false;
  return isDesktopState({ appearance: x.appearance, drafts: x.drafts });
}
/** Fixed redacted failure shared by main and preload; no filesystem details leave the service. */
export function desktopFailure<C extends DesktopChannel>(requestId: string, code: DesktopCode, traceId: string): DesktopResult<C> {
  const keys = { INVALID_ARGUMENT: 'invalidArgument', UNSUPPORTED_CONTRACT: 'unsupportedContract', INVALID_SENDER: 'invalidSender', TIMEOUT: 'timeout', UNAVAILABLE: 'unavailable', REVISION_CONFLICT: 'settingsConflict' } as const;
  return { contractVersion: 1, requestId, ok: false, error: { code, category: code === 'REVISION_CONFLICT' ? 'biz' : code === 'INVALID_SENDER' ? 'permission' : code === 'INVALID_ARGUMENT' || code === 'UNSUPPORTED_CONTRACT' ? 'validation' : 'system',
    messageKey: keys[code], retryable: ['TIMEOUT', 'UNAVAILABLE', 'REVISION_CONFLICT'].includes(code), traceId } };
}
/** Exact response and correlation validation before renderer consumption. */
export function isDesktopResult<C extends DesktopChannel>(x: unknown, id: string, c: C): x is DesktopResult<C> {
  if (!exactObject(x, ['contractVersion', 'requestId', 'ok', typeof x === 'object' && x !== null && 'ok' in x && x.ok === true ? 'data' : 'error']) || x.contractVersion !== 1 || x.requestId !== id) return false;
  if (x.ok === true) return isDesktopData(x.data, c);
  if (x.ok !== false || !exactObject(x.error, ['code', 'category', 'messageKey', 'retryable', 'traceId']) || !uuid(x.error.traceId) || !['INVALID_ARGUMENT', 'UNSUPPORTED_CONTRACT', 'INVALID_SENDER', 'TIMEOUT', 'UNAVAILABLE', 'REVISION_CONFLICT'].includes(x.error.code as string)) return false;
  const expected = desktopFailure(id, x.error.code as DesktopCode, x.error.traceId);
  const error = x.error; return !expected.ok && Object.entries(expected.error).every(([key, value]) => error[key] === value);
}
