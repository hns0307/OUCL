import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isSkinProvider, SkinContractError, skinUuid } from '../../shared/contracts/skin.js';
import type { SkinRole } from '../../shared/contracts/skin.js';
import { guardDirectory, MAX_RECORD_BYTES, readRegular } from '../storage/files.js';
import { skinHttpsUrl } from './http.js';
import { validSkinMetadata } from './provider.js';
import type { StoredSkinProvider } from './provider.js';

export interface StoredSkinAccount extends SkinRole {
  accountId: string; providerId: string; revision: number; encrypted: string | null;
}
interface SkinRecord {
  formatVersion: 1; providers: StoredSkinProvider[]; accounts: StoredSkinAccount[];
}

/** Commits a record or verified binary by replacing it with a flushed sibling file. */
export async function saveSkinFile(directory: string, name: string, bytes: Buffer): Promise<string> {
  const parent = await guardDirectory(directory);
  const destination = path.join(parent, name);
  const temporary = path.join(parent, '.skin-' + randomUUID() + '.tmp');
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (await guardDirectory(directory) !== parent) throw new SkinContractError('UNAVAILABLE');
    await rename(temporary, destination);
    return destination;
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function isStoredProvider(input: unknown): input is StoredSkinProvider {
  if (!exactObject(input, ['providerId', 'name', 'apiRoot', 'homepage', 'adapter', 'loginByName', 'metadata'])
    || typeof input.metadata !== 'string' || !validSkinMetadata(input.metadata)) return false;
  const { providerId, name, apiRoot, homepage, adapter, loginByName } = input;
  const summary = { providerId, name, apiRoot, homepage, adapter, loginByName };
  if (!isSkinProvider(summary)) return false;
  try {
    const api = skinHttpsUrl(summary.apiRoot);
    return api.href === summary.apiRoot && api.pathname.endsWith('/') && !api.search
      && skinHttpsUrl(summary.homepage).href === summary.homepage;
  } catch { return false; }
}
function isStoredAccount(input: unknown): input is StoredSkinAccount {
  return exactObject(input, ['accountId', 'providerId', 'gameName', 'uuid', 'revision', 'encrypted'])
    && typeof input.accountId === 'string' && UUID_PATTERN.test(input.accountId)
    && typeof input.providerId === 'string' && UUID_PATTERN.test(input.providerId)
    && typeof input.gameName === 'string' && input.gameName.length > 0 && input.gameName.length <= 80 && !/[\p{C}]/u.test(input.gameName)
    && skinUuid(input.uuid) && typeof input.revision === 'number' && Number.isSafeInteger(input.revision) && input.revision > 0
    && (input.encrypted === null || typeof input.encrypted === 'string' && input.encrypted.length > 0
      && input.encrypted.length <= 32768 && /^[A-Za-z0-9+/]+={0,2}$/.test(input.encrypted));
}
const RECORD = 'skin-center.v1.json';

export class SkinRecords {
  constructor(readonly directory: string) {}
  /** Reads only public metadata and opaque ciphertext. Old profiles require no migration. */
  async read(): Promise<SkinRecord> {
    await mkdir(this.directory, { recursive: true });
    const parent = await guardDirectory(this.directory);
    const content = await readRegular(path.join(parent, RECORD));
    if (!content) return { formatVersion: 1, providers: [], accounts: [] };
    const state: unknown = JSON.parse(content.toString('utf8'));
    if (!exactObject(state, ['formatVersion', 'providers', 'accounts']) || state.formatVersion !== 1
      || !Array.isArray(state.providers) || state.providers.length > 32 || !state.providers.every(isStoredProvider)
      || !Array.isArray(state.accounts) || state.accounts.length > 256 || !state.accounts.every(isStoredAccount))
      throw new SkinContractError('UNAVAILABLE');
    const providers = new Set(state.providers.map(provider => provider.providerId));
    if (providers.size !== state.providers.length || new Set(state.providers.map(provider => provider.apiRoot)).size !== providers.size
      || new Set(state.accounts.map(account => account.accountId)).size !== state.accounts.length
      || new Set(state.accounts.map(account => account.providerId + ':' + account.uuid)).size !== state.accounts.length
      || !state.accounts.every(account => providers.has(account.providerId))) throw new SkinContractError('UNAVAILABLE');
    return { formatVersion: 1, providers: state.providers, accounts: state.accounts };
  }
  /** Persists roles and their ciphertext together so rotation and removal have a single commit point. */
  async write(state: SkinRecord): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(state));
    if (bytes.length > MAX_RECORD_BYTES) throw new SkinContractError('UNAVAILABLE');
    await saveSkinFile(this.directory, RECORD, bytes);
  }
}
export type { SkinRecord };
