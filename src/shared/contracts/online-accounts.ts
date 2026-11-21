
import { exactObject, UUID_PATTERN } from './handshake.js';

export const ONLINE_ACCOUNTS_CAPABILITY = 'accounts.online.v1' as const;
export const ONLINE_ACCOUNTS_CHANNEL = 'accounts-online:request';
export const ONLINE_ACCOUNT_ERRORS = ['INVALID_ARGUMENT', 'INVALID_SENDER', 'UNSUPPORTED_CONTRACT', 'UNCONFIGURED', 'CANCELLED',
  'BUSY', 'SIGN_IN', 'REAUTH', 'NO_LICENSE', 'NO_PROFILE', 'ACCESS_DENIED', 'NETWORK', 'STORAGE', 'NOT_FOUND', 'TIMEOUT', 'UNAVAILABLE'] as const;
export type OnlineAccountError = typeof ONLINE_ACCOUNT_ERRORS[number];

export type AccountKind = 'offline' | 'microsoft' | 'yggdrasil';
export type OnlineEntitlement = 'owned' | 'playable' | 'none' | 'reauth';
export interface OnlineAccountSummary {
  accountId: string;
  kind: 'microsoft' | 'yggdrasil';
  displayName: string;
  gameName: string;
  uuid?: string;
  ready: boolean;
  entitlement?: OnlineEntitlement;
}
export type OnlineAccountsAction = { kind: 'list' | 'beginMicrosoft' | 'cancelMicrosoft' }
  | { kind: 'refreshMicrosoft' | 'removeMicrosoft' | 'textures'; accountId: string };
export interface OnlineAccountsSnapshot { kind: 'accounts'; microsoftConfigured: boolean; items: OnlineAccountSummary[] }
export interface OnlineAccountTextures { kind: 'textures'; skin?: string; cape?: string; model?: 'classic' | 'slim' }
export type OnlineAccountsData = OnlineAccountsSnapshot | OnlineAccountTextures;
export type OnlineAccountsResult = { contractVersion: 1; requestId: string; ok: true; data: OnlineAccountsData }
  | { contractVersion: 1; requestId: string; ok: false; error: OnlineAccountError };
export interface OnlineAccountsBridge {
  onlineAccounts(action: OnlineAccountsAction): Promise<OnlineAccountsResult>;
}

export function isOnlineAccountsAction(value: unknown): value is OnlineAccountsAction {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  if (input.kind === 'list' || input.kind === 'beginMicrosoft' || input.kind === 'cancelMicrosoft') return exactObject(input, ['kind']);
  return (input.kind === 'refreshMicrosoft' || input.kind === 'removeMicrosoft' || input.kind === 'textures')
    && exactObject(input, ['kind', 'accountId']) && typeof input.accountId === 'string' && UUID_PATTERN.test(input.accountId);
}

function summary(input: unknown): input is OnlineAccountSummary {
  if (!input || typeof input !== 'object' || !exactObject(input, ['accountId', 'kind', 'displayName', 'gameName', 'ready',
    ...['uuid', 'entitlement'].filter(key => Object.hasOwn(input, key))])) return false;
  return typeof input.accountId === 'string' && UUID_PATTERN.test(input.accountId) && ['microsoft', 'yggdrasil'].includes(String(input.kind))
    && typeof input.displayName === 'string' && input.displayName.length >= 1 && input.displayName.length <= 200 && !/[\p{C}]/u.test(input.displayName)
    && typeof input.gameName === 'string' && input.gameName.length <= 80 && !/[\p{C}]/u.test(input.gameName)
    && typeof input.ready === 'boolean'
    && (!Object.hasOwn(input, 'uuid') || typeof input.uuid === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(input.uuid))
    && (input.kind === 'microsoft' ? ['owned', 'playable', 'none', 'reauth'].includes(String(input.entitlement)) : !Object.hasOwn(input, 'entitlement'));
}

function image(input: unknown): boolean {
  return typeof input === 'string' && input.length <= 450_000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input);
}

export function isOnlineAccountsData(value: unknown): value is OnlineAccountsData {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  if (input.kind === 'accounts') return exactObject(input, ['kind', 'microsoftConfigured', 'items']) && typeof input.microsoftConfigured === 'boolean'
    && Array.isArray(input.items) && input.items.length <= 256 && input.items.every(summary)
    && new Set(input.items.map(item => item.accountId)).size === input.items.length;
  return input.kind === 'textures' && exactObject(input, ['kind', ...['skin', 'cape', 'model'].filter(key => Object.hasOwn(input, key))])
    && (!Object.hasOwn(input, 'skin') || image(input.skin)) && (!Object.hasOwn(input, 'cape') || image(input.cape))
    && (!Object.hasOwn(input, 'model') || input.model === 'classic' || input.model === 'slim');
}

export function onlineFailure(requestId: string, error: OnlineAccountError): OnlineAccountsResult {
  return { contractVersion: 1, requestId, ok: false, error };
}

export function isOnlineAccountsResult(value: unknown, requestId: string): value is OnlineAccountsResult {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  if (!exactObject(input, ['contractVersion', 'requestId', 'ok', input.ok === true ? 'data' : 'error'])
    || input.contractVersion !== 1 || input.requestId !== requestId) return false;
  return input.ok === true ? isOnlineAccountsData(input.data) : input.ok === false && ONLINE_ACCOUNT_ERRORS.includes(input.error as OnlineAccountError);
}
