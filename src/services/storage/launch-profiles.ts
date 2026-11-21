import { createHash } from 'node:crypto';
import path from 'node:path';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { normalizeDataDirectory } from '../../core/path/layout.js';
import { StorageError } from './files.js';

export interface RegisteredJava { javaId: string; executable: string; major: 8 | 17 | 21; version: string; vendor: string }
export interface OfflineAccount { accountId: string; displayName: string; gameName: string; uuid: string }
export interface ProfileRequest { requestId: string; digest: string; accountId: string }
export interface LaunchProfiles { javas: RegisteredJava[]; selectedJavaId?: string; accounts: OfflineAccount[]; requests: ProfileRequest[] }
function invalid(): never { throw new StorageError('INVALID_RECORD'); }
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID_PATTERN.test(value); }
/** D-20 approved name rule, independent of the display nickname. */
export function validGameName(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(value); }
/** Conventional OfflinePlayer UUID v3; MD5 is a compatibility identifier, never a security digest. */
export function offlineUuid(gameName: string): string {
  if (!validGameName(gameName)) invalid();
  const bytes = createHash('md5').update(`OfflinePlayer:${gameName}`, 'utf8').digest();
  bytes[6] = (bytes[6]! & 15) | 48; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Parses only one fixed private JSON domain. No secrets or arbitrary settings are accepted. */
export function parseLaunchProfiles(value: unknown): LaunchProfiles {
  if (!exactObject(value, ['javas', 'accounts', 'requests', ...(value && typeof value === 'object' && 'selectedJavaId' in value ? ['selectedJavaId'] : [])])
    || !Array.isArray(value.javas) || value.javas.length > 32 || !Array.isArray(value.accounts) || value.accounts.length > 1000
    || !Array.isArray(value.requests) || value.requests.length > 2048 || Object.hasOwn(value, 'selectedJavaId') && value.selectedJavaId === undefined) invalid();
  const javas = value.javas.map((entry: unknown): RegisteredJava => {
    if (!exactObject(entry, ['javaId', 'executable', 'major', 'version', 'vendor']) || !uuid(entry.javaId) || typeof entry.executable !== 'string'
      || ![8, 17, 21].includes(entry.major as number) || typeof entry.version !== 'string' || !/^[A-Za-z0-9_.+-]{1,80}$/.test(entry.version)
      || typeof entry.vendor !== 'string' || entry.vendor.length < 1 || entry.vendor.length > 160 || /[\p{C}]/u.test(entry.vendor)) invalid();
    let executable: string;
    try { executable = normalizeDataDirectory(entry.executable); } catch { invalid(); }
    if (path.win32.basename(executable).toLowerCase() !== 'java.exe') invalid();
    return { javaId: entry.javaId, executable, major: entry.major as RegisteredJava['major'], version: entry.version, vendor: entry.vendor };
  });
  const accounts = value.accounts.map((entry: unknown): OfflineAccount => {
    if (!exactObject(entry, ['accountId', 'displayName', 'gameName', 'uuid']) || !uuid(entry.accountId) || typeof entry.displayName !== 'string'
      || entry.displayName.trim() !== entry.displayName || entry.displayName.length < 1 || entry.displayName.length > 80 || /[\p{C}]/u.test(entry.displayName)
      || !validGameName(entry.gameName) || entry.uuid !== offlineUuid(entry.gameName)) invalid();
    return { accountId: entry.accountId, displayName: entry.displayName, gameName: entry.gameName, uuid: entry.uuid as string };
  });
  const requests = value.requests.map((entry: unknown): ProfileRequest => {
    if (!exactObject(entry, ['requestId', 'digest', 'accountId']) || !uuid(entry.requestId) || !uuid(entry.accountId)
      || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest) || !accounts.some(account => account.accountId === entry.accountId)) invalid();
    return { requestId: entry.requestId, digest: entry.digest, accountId: entry.accountId };
  });
  if (new Set(javas.map(java => java.javaId)).size !== javas.length || new Set(javas.map(java => java.executable.toLowerCase())).size !== javas.length
    || new Set(accounts.map(account => account.accountId)).size !== accounts.length || new Set(accounts.map(account => account.gameName)).size !== accounts.length
    || new Set(requests.map(request => request.requestId)).size !== requests.length || value.selectedJavaId !== undefined && !javas.some(java => java.javaId === value.selectedJavaId)) invalid();
  return { javas, accounts, requests, ...(value.selectedJavaId === undefined ? {} : { selectedJavaId: value.selectedJavaId as string }) };
}
