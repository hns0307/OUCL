import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';

export const SKIN_CAPABILITY = 'skin.v1' as const;
export const SKIN_MAX_PNG_BYTES = 1024 * 1024;
export const SKIN_CHANNELS = ['skin:list', 'skin:discover', 'skin:addProvider', 'skin:removeProvider', 'skin:login',
  'skin:selectRole', 'skin:cancelLogin', 'skin:logout', 'skin:preview', 'skin:upload', 'skin:openSite'] as const;
export type SkinChannel = typeof SKIN_CHANNELS[number];
export type SkinModel = 'default' | 'slim';
export interface SkinProvider {
  providerId: string; name: string; apiRoot: string; homepage: string; adapter: 'yggdrasil' | 'blessing';
  loginByName: boolean;
}
export interface SkinRole { gameName: string; uuid: string }
export interface SkinRoleAccount extends SkinRole {
  accountId: string; providerId: string; providerName: string; ready: boolean;
}
export interface SkinSnapshot { providers: SkinProvider[]; accounts: SkinRoleAccount[] }
export interface SkinPreview {
  model: SkinModel; uploadSkin: boolean; skin?: string; cape?: string;
}
export interface SkinUploadReceipt { applied: true; preview?: SkinPreview }
export type SkinLoginResult = { state: 'ready'; account: SkinRoleAccount } | { state: 'select'; loginId: string; roles: SkinRole[] };
export interface SkinPayload {
  'skin:list': Record<string, never>;
  'skin:discover': { url: string };
  'skin:addProvider': { discoveryId: string };
  'skin:removeProvider': { providerId: string };
  'skin:login': { providerId: string; username: string; password: string };
  'skin:selectRole': { loginId: string; roleUuid: string };
  'skin:cancelLogin': { loginId: string };
  'skin:logout': { accountId: string };
  'skin:preview': { accountId: string };
  'skin:upload': { accountId: string; model: SkinModel; png: Uint8Array };
  'skin:openSite': { providerId: string };
}
export interface SkinData {
  'skin:list': SkinSnapshot;
  'skin:discover': { discoveryId: string; provider: SkinProvider };
  'skin:addProvider': SkinProvider;
  'skin:removeProvider': Record<string, never>;
  'skin:login': SkinLoginResult;
  'skin:selectRole': SkinRoleAccount;
  'skin:cancelLogin': Record<string, never>;
  'skin:logout': { revoked: boolean };
  'skin:preview': SkinPreview;
  'skin:upload': SkinUploadReceipt;
  'skin:openSite': Record<string, never>;
}
export interface SkinBridge {
  skinList(): Promise<SkinResult<'skin:list'>>;
  skinDiscover(url: string): Promise<SkinResult<'skin:discover'>>;
  skinAddProvider(discoveryId: string): Promise<SkinResult<'skin:addProvider'>>;
  skinRemoveProvider(providerId: string): Promise<SkinResult<'skin:removeProvider'>>;
  skinLogin(input: SkinPayload['skin:login']): Promise<SkinResult<'skin:login'>>;
  skinSelectRole(loginId: string, roleUuid: string): Promise<SkinResult<'skin:selectRole'>>;
  skinCancelLogin(loginId: string): Promise<SkinResult<'skin:cancelLogin'>>;
  skinLogout(accountId: string): Promise<SkinResult<'skin:logout'>>;
  skinPreview(accountId: string): Promise<SkinResult<'skin:preview'>>;
  skinUpload(input: SkinPayload['skin:upload']): Promise<SkinResult<'skin:upload'>>;
  skinOpenSite(providerId: string): Promise<SkinResult<'skin:openSite'>>;
}
const COMMON = {
  INVALID_ARGUMENT: { category: 'validation', messageKey: 'invalidArgument', retryable: false },
  INVALID_SENDER: { category: 'permission', messageKey: 'invalidSender', retryable: false },
  UNSUPPORTED_CONTRACT: { category: 'validation', messageKey: 'unsupportedContract', retryable: false },
  TIMEOUT: { category: 'network', messageKey: 'timeout', retryable: true },
  UNAVAILABLE: { category: 'system', messageKey: 'unavailable', retryable: true },
  INVALID_URL: { category: 'validation', messageKey: 'invalidArgument', retryable: false },
  INCOMPATIBLE_PROVIDER: { category: 'validation', messageKey: 'unavailable', retryable: false },
  NOT_FOUND: { category: 'biz', messageKey: 'unavailable', retryable: false },
  AUTH_FAILED: { category: 'auth', messageKey: 'unavailable', retryable: false },
  AUTH_EXPIRED: { category: 'auth', messageKey: 'unavailable', retryable: false },
  NO_ROLES: { category: 'auth', messageKey: 'unavailable', retryable: false },
  SECRET_UNAVAILABLE: { category: 'disk', messageKey: 'unavailable', retryable: true },
  NETWORK_FAILED: { category: 'network', messageKey: 'unavailable', retryable: true },
  INVALID_TEXTURE: { category: 'validation', messageKey: 'invalidArgument', retryable: false },
  UPLOAD_UNSUPPORTED: { category: 'biz', messageKey: 'unavailable', retryable: false },
  UPLOAD_REJECTED: { category: 'biz', messageKey: 'unavailable', retryable: false },
  AGENT_UNAVAILABLE: { category: 'system', messageKey: 'unavailable', retryable: true },
  CANCELLED: { category: 'cancelled', messageKey: 'unavailable', retryable: false },
} as const satisfies Record<string, Pick<AppError, 'category' | 'messageKey' | 'retryable'>>;
export type SkinErrorCode = keyof typeof COMMON;
export interface SkinResultError extends Omit<AppError, 'code'> { code: SkinErrorCode }
export type SkinResult<C extends SkinChannel> = { contractVersion: 1; requestId: string; ok: true; data: SkinData[C] }
  | { contractVersion: 1; requestId: string; ok: false; error: SkinResultError };
export class SkinContractError extends Error {
  constructor(readonly code: SkinErrorCode) { super(code); this.name = 'SkinContractError'; }
}
export const skinUuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
const boundedText = (value: unknown, maximum: number): value is string => typeof value === 'string'
  && value.length >= 1 && value.length <= maximum && !/[\p{C}]/u.test(value);
const model = (value: unknown): value is SkinModel => value === 'default' || value === 'slim';
const httpsUrl = (value: unknown): value is string => {
  if (!boundedText(value, 2048)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; }
  catch { return false; }
};
const dataPng = (value: unknown): value is string => typeof value === 'string' && value.length <= Math.ceil(SKIN_MAX_PNG_BYTES / 3) * 4 + 22
  && value.startsWith('data:image/png;base64,') && /^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(22));
const role = (value: unknown): value is SkinRole => exactObject(value, ['gameName', 'uuid']) && boundedText(value.gameName, 80) && skinUuid(value.uuid);

/** Validates the public provider projection before a site can be rendered. */
export function isSkinProvider(value: unknown): value is SkinProvider {
  return exactObject(value, ['providerId', 'name', 'apiRoot', 'homepage', 'adapter', 'loginByName']) && id(value.providerId)
    && boundedText(value.name, 100) && httpsUrl(value.apiRoot) && httpsUrl(value.homepage)
    && (value.adapter === 'yggdrasil' || value.adapter === 'blessing') && typeof value.loginByName === 'boolean';
}

/** Validates the public account projection without exposing any token. */
export function isSkinRoleAccount(value: unknown): value is SkinRoleAccount {
  return exactObject(value, ['accountId', 'providerId', 'providerName', 'gameName', 'uuid', 'ready']) && id(value.accountId)
    && id(value.providerId) && boundedText(value.providerName, 100) && boundedText(value.gameName, 80)
    && skinUuid(value.uuid) && typeof value.ready === 'boolean';
}

/** Accepts versioned sender payloads with opaque IDs, plus bounded PNG bytes from explicit upload. */
export function isSkinPayload<C extends SkinChannel>(input: unknown, channel: C): input is SkinPayload[C] {
  switch (channel) {
    case 'skin:list': return exactObject(input, []);
    case 'skin:discover': return exactObject(input, ['url']) && boundedText(input.url, 2048);
    case 'skin:addProvider': return exactObject(input, ['discoveryId']) && id(input.discoveryId);
    case 'skin:removeProvider':
    case 'skin:openSite': return exactObject(input, ['providerId']) && id(input.providerId);
    case 'skin:login': return exactObject(input, ['providerId', 'username', 'password']) && id(input.providerId)
      && boundedText(input.username, 254) && boundedText(input.password, 1024);
    case 'skin:selectRole': return exactObject(input, ['loginId', 'roleUuid']) && id(input.loginId) && skinUuid(input.roleUuid);
    case 'skin:cancelLogin': return exactObject(input, ['loginId']) && id(input.loginId);
    case 'skin:logout':
    case 'skin:preview': return exactObject(input, ['accountId']) && id(input.accountId);
    case 'skin:upload': return exactObject(input, ['accountId', 'model', 'png']) && id(input.accountId) && model(input.model)
      && ArrayBuffer.isView(input.png) && Object.prototype.toString.call(input.png) === '[object Uint8Array]' && input.png.byteLength > 0 && input.png.byteLength <= SKIN_MAX_PNG_BYTES;
  }
}

function isSkinPreview(value: unknown): value is SkinPreview {
  return typeof value === 'object' && value !== null
    && exactObject(value, ['model', 'uploadSkin', ...['skin', 'cape'].filter(key => Object.hasOwn(value, key))])
    && model(value.model) && typeof value.uploadSkin === 'boolean' && (!Object.hasOwn(value, 'skin') || dataPng(value.skin))
    && (!Object.hasOwn(value, 'cape') || dataPng(value.cape));
}
/** Verifies output fields for each dedicated capability before crossing IPC. */
export function isSkinData<C extends SkinChannel>(value: unknown, channel: C): value is SkinData[C] {
  switch (channel) {
    case 'skin:list': return exactObject(value, ['providers', 'accounts']) && Array.isArray(value.providers) && value.providers.length <= 32
      && value.providers.every(isSkinProvider) && Array.isArray(value.accounts) && value.accounts.length <= 256 && value.accounts.every(isSkinRoleAccount);
    case 'skin:discover': return exactObject(value, ['discoveryId', 'provider']) && id(value.discoveryId) && isSkinProvider(value.provider);
    case 'skin:addProvider': return isSkinProvider(value);
    case 'skin:login': return exactObject(value, ['state', 'account']) && value.state === 'ready' && isSkinRoleAccount(value.account)
      || exactObject(value, ['state', 'loginId', 'roles']) && value.state === 'select' && id(value.loginId) && Array.isArray(value.roles)
      && value.roles.length > 0 && value.roles.length <= 64 && value.roles.every(role);
    case 'skin:selectRole': return isSkinRoleAccount(value);
    case 'skin:cancelLogin':
    case 'skin:removeProvider':
    case 'skin:openSite': return exactObject(value, []);
    case 'skin:logout': return exactObject(value, ['revoked']) && typeof value.revoked === 'boolean';
    case 'skin:preview': return isSkinPreview(value);
    case 'skin:upload': return typeof value === 'object' && value !== null
      && exactObject(value, ['applied', ...['preview'].filter(key => Object.hasOwn(value, key))]) && value.applied === true
      && (!Object.hasOwn(value, 'preview') || isSkinPreview(value.preview));
  }
}

/** Builds an error with no service text, credentials or filesystem paths. */
export function skinFailure<C extends SkinChannel>(requestId: string, code: SkinErrorCode, traceId: string): SkinResult<C> {
  return { contractVersion: 1, requestId, ok: false, error: { code, traceId, ...COMMON[code] } };
}

/** Checks request ID and the domain error or response projection before renderer use. */
export function isSkinResult<C extends SkinChannel>(value: unknown, requestId: string, channel: C): value is SkinResult<C> {
  const success = typeof value === 'object' && value !== null && 'ok' in value && value.ok === true;
  if (!exactObject(value, ['contractVersion', 'requestId', 'ok', success ? 'data' : 'error'])
    || value.contractVersion !== 1 || value.requestId !== requestId) return false;
  if (value.ok === true) return isSkinData(value.data, channel);
  if (value.ok !== false || !exactObject(value.error, ['category', 'code', 'messageKey', 'retryable', 'traceId'])
    || typeof value.error.code !== 'string' || !Object.hasOwn(COMMON, value.error.code) || !id(value.error.traceId)) return false;
  const expected = COMMON[value.error.code as SkinErrorCode];
  return value.error.category === expected.category && value.error.messageKey === expected.messageKey && value.error.retryable === expected.retryable;
}
