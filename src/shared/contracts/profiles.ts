import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';

export const PROFILE_CHANNELS = ['java:choose', 'accounts:list', 'accounts:createOffline', 'settings:get'] as const;
export const PROFILE_CAPABILITIES = ['java.v1', 'accounts.v1', 'settings.v1'] as const;
export type ProfileChannel = typeof PROFILE_CHANNELS[number];
export interface JavaRef { javaId: string; major: 8 | 17 | 21; arch: 'x64'; source: 'system'; available: boolean }
export interface AccountSummary { accountId: string; kind: 'offline'; displayName: string; gameName: string; ready: boolean }
export interface SettingsSummary { revision: number; rootId?: string; javaId?: string; memoryMiB: number; isolationDefault: boolean; theme: 'system' }
export interface ProfilePayloads {
  'java:choose': Record<string, never>; 'accounts:list': Record<string, never>; 'settings:get': Record<string, never>;
  'accounts:createOffline': { displayName: string; gameName: string };
}
export interface ProfileData {
  'java:choose': { selection: 'cancelled' } | { selection: 'chosen'; java: JavaRef };
  'accounts:list': { items: AccountSummary[] }; 'accounts:createOffline': { account: AccountSummary }; 'settings:get': SettingsSummary;
}
export type ProfileCode = AppError['code'] | 'ACCOUNT_NAME_INVALID' | 'ACCOUNT_CONFLICT' | 'STORAGE_UNAVAILABLE' | 'JAVA_INVALID' | 'JAVA_ARCH_UNSUPPORTED' | 'CONFIG_CORRUPT';
export interface ProfileError extends Omit<AppError, 'code'> { code: ProfileCode }
export type ProfileResult<C extends ProfileChannel> = { contractVersion: 1; requestId: string; ok: true; data: ProfileData[C] }
  | { contractVersion: 1; requestId: string; ok: false; error: ProfileError };
export interface ProfileDispatcher { <C extends ProfileChannel>(channel: C, payload: ProfilePayloads[C], requestId: string): Promise<ProfileData[C]> }
export interface ProfilesBridge {
  chooseJava(requestId: string): Promise<ProfileResult<'java:choose'>>;
  listAccounts(): Promise<ProfileResult<'accounts:list'>>;
  createOfflineAccount(requestId: string, input: ProfilePayloads['accounts:createOffline']): Promise<ProfileResult<'accounts:createOffline'>>;
  getSettings(): Promise<ProfileResult<'settings:get'>>;
}
export class ProfileContractError extends Error { constructor(readonly code: ProfileCode) { super(code); this.name = 'ProfileContractError'; } }
const ERRORS: Record<ProfileCode, { category: AppError['category']; key: MessageKey; retry: boolean }> = {
  INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument', retry: false }, UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract', retry: false },
  INVALID_SENDER: { category: 'permission', key: 'invalidSender', retry: false }, TIMEOUT: { category: 'system', key: 'timeout', retry: true }, UNAVAILABLE: { category: 'system', key: 'unavailable', retry: true },
  ACCOUNT_NAME_INVALID: { category: 'validation', key: 'accountNameInvalid', retry: false }, ACCOUNT_CONFLICT: { category: 'biz', key: 'accountConflict', retry: false },
  STORAGE_UNAVAILABLE: { category: 'disk', key: 'unavailable', retry: true }, JAVA_INVALID: { category: 'validation', key: 'javaInvalid', retry: true },
  JAVA_ARCH_UNSUPPORTED: { category: 'validation', key: 'javaInvalid', retry: true }, CONFIG_CORRUPT: { category: 'disk', key: 'unavailable', retry: false },
};
const uuid = (x: unknown): x is string => typeof x === 'string' && UUID_PATTERN.test(x);
const name = (x: unknown): x is string => typeof x === 'string' && x.trim() === x && x.length >= 1 && x.length <= 80 && !/[\p{C}]/u.test(x);
/** Exact approved payloads; renderer paths and executable options are never accepted. */
export function isProfilePayload<C extends ProfileChannel>(x: unknown, channel: C): x is ProfilePayloads[C] {
  if (!PROFILE_CHANNELS.includes(channel)) return false;
  return channel === 'accounts:createOffline' ? exactObject(x, ['displayName', 'gameName']) && name(x.displayName) && typeof x.gameName === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(x.gameName) : exactObject(x, []);
}
function account(x: unknown): x is AccountSummary {
  return exactObject(x, ['accountId', 'kind', 'displayName', 'gameName', 'ready']) && uuid(x.accountId) && x.kind === 'offline' && name(x.displayName)
    && typeof x.gameName === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(x.gameName) && x.ready === true;
}
/** Checks output projection, rejecting private UUIDs, executable paths and unexpected fields. */
export function isProfileData<C extends ProfileChannel>(x: unknown, channel: C): x is ProfileData[C] {
  if (channel === 'accounts:list') return exactObject(x, ['items']) && Array.isArray(x.items) && x.items.length <= 1000 && x.items.every(account) && new Set(x.items.map(item => item.accountId)).size === x.items.length;
  if (channel === 'accounts:createOffline') return exactObject(x, ['account']) && account(x.account);
  if (channel === 'java:choose') return exactObject(x, ['selection']) && x.selection === 'cancelled'
    || exactObject(x, ['selection', 'java']) && x.selection === 'chosen' && exactObject(x.java, ['javaId', 'major', 'arch', 'source', 'available'])
    && uuid(x.java.javaId) && [8, 17, 21].includes(x.java.major as number) && x.java.arch === 'x64' && x.java.source === 'system' && x.java.available === true;
  if (channel !== 'settings:get' || typeof x !== 'object' || x === null) return false;
  return exactObject(x, ['revision', 'memoryMiB', 'isolationDefault', 'theme', ...['rootId', 'javaId'].filter(key => Object.hasOwn(x, key))])
    && typeof x.revision === 'number' && Number.isSafeInteger(x.revision) && x.revision >= 0
    && (!Object.hasOwn(x, 'rootId') || uuid(x.rootId)) && (!Object.hasOwn(x, 'javaId') || uuid(x.javaId))
    && typeof x.memoryMiB === 'number' && Number.isSafeInteger(x.memoryMiB) && x.memoryMiB >= 512 && x.memoryMiB <= 65536 && typeof x.isolationDefault === 'boolean' && x.theme === 'system';
}
/** Fixed domain error without arbitrary stack/detail strings. */
export function profileFailure<C extends ProfileChannel>(requestId: string, code: ProfileCode, traceId: string): ProfileResult<C> {
  const item = ERRORS[code]; return { contractVersion: 1, requestId, ok: false, error: { category: item.category, code, messageKey: item.key, retryable: item.retry, traceId } };
}
/** Validates correlation and exact domain response before renderer consumption. */
export function isProfileResult<C extends ProfileChannel>(x: unknown, requestId: string, channel: C): x is ProfileResult<C> {
  if (!exactObject(x, ['contractVersion', 'requestId', 'ok', x && typeof x === 'object' && 'ok' in x && x.ok === true ? 'data' : 'error']) || x.contractVersion !== 1 || x.requestId !== requestId) return false;
  if (x.ok === true) return isProfileData(x.data, channel);
  if (x.ok !== false || !exactObject(x.error, ['category', 'code', 'messageKey', 'retryable', 'traceId']) || typeof x.error.code !== 'string' || !Object.hasOwn(ERRORS, x.error.code)) return false;
  const item = ERRORS[x.error.code as ProfileCode]; return x.error.category === item.category && x.error.messageKey === item.key && x.error.retryable === item.retry && uuid(x.error.traceId);
}
