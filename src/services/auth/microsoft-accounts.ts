
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { guardDirectory, readRegular } from '../storage/files.js';
import { MicrosoftError, officialTexture } from './microsoft-api.js';
import type { JavaEntitlement, MinecraftLicense, MinecraftProfile } from './microsoft-api.js';
import type { MicrosoftOAuth, OAuthAccount } from './microsoft-oauth.js';
import type { SecretAdapter } from './secret-adapter.js';

type LicenseStatus = JavaEntitlement | 'reauth';
export interface MicrosoftAccountView {
  accountId: string;
  gameName: string;
  uuid?: string;
  entitlement: LicenseStatus;
  ready: boolean;
}
interface SavedAccount {
  accountId: string;
  epoch: string;
  identityDigest: string;
  profile: MinecraftProfile | null;
  entitlement: LicenseStatus;
  sealed: string;
}
interface LiveLicense {
  epoch: string;
  when: number;
  license: MinecraftLicense;
}

const MAX_ACCOUNTS = 24;
const MAX_CREDENTIAL_BYTES = 120 * 1024;
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;

function parseProfile(value: unknown): MinecraftProfile | null {
  if (value === null) return null;
  if (typeof value !== 'object' || value === null || !exactObject(value, ['uuid', 'gameName', ...['skin', 'cape'].filter(key => Object.hasOwn(value, key))])
    || typeof value.uuid !== 'string' || !UUID_PATTERN.test(value.uuid) || typeof value.gameName !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(value.gameName)) {
    throw new MicrosoftError('STORAGE');
  }
  const skin = value.skin;
  const cape = value.cape;
  if (skin !== undefined && (!exactObject(skin, ['url', 'model']) || !officialTexture(skin.url) || !['classic', 'slim'].includes(String(skin.model)))
    || cape !== undefined && !officialTexture(cape)) throw new MicrosoftError('STORAGE');
  return value as unknown as MinecraftProfile;
}

function parseSaved(value: unknown): SavedAccount {
  if (!exactObject(value, ['accountId', 'epoch', 'identityDigest', 'profile', 'entitlement', 'sealed'])
    || typeof value.accountId !== 'string' || !UUID_PATTERN.test(value.accountId)
    || typeof value.epoch !== 'string' || !UUID_PATTERN.test(value.epoch)
    || typeof value.identityDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.identityDigest)
    || !['owned', 'playable', 'none', 'reauth'].includes(String(value.entitlement))
    || typeof value.sealed !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.sealed)
    || Buffer.from(value.sealed, 'base64').length > MAX_CREDENTIAL_BYTES) throw new MicrosoftError('STORAGE');
  return { ...value, profile: parseProfile(value.profile) } as SavedAccount;
}
function view(item: SavedAccount): MicrosoftAccountView {
  return {
    accountId: item.accountId, gameName: item.profile?.gameName ?? '', entitlement: item.entitlement,
    ready: item.profile !== null && (item.entitlement === 'owned' || item.entitlement === 'playable'),
    ...(item.profile ? { uuid: item.profile.uuid } : {}),
  };
}

function identityDigest(homeAccountId: string): string {
  return createHash('sha256').update('oucl-microsoft-v1\0').update(homeAccountId).digest('hex');
}

/** Owns the Microsoft registry and binds every refresh to the same account and login epoch. */
export class MicrosoftAccounts {
  private registry: Promise<Map<string, SavedAccount>> | undefined;
  private tail: Promise<void> = Promise.resolve();
  private readonly life = new AbortController();
  private signInSession: AbortController | undefined;
  private readonly licenses = new Map<string, LiveLicense>();
  private readonly refreshes = new Map<string, Promise<MinecraftLicense>>();
  private readonly file: string;

  constructor(private readonly directory: string, private readonly secrets: SecretAdapter,
    private readonly oauth: Pick<MicrosoftOAuth, 'clientId' | 'configured' | 'signIn' | 'refresh'>,
    private readonly api: { exchange(token: string, requestId: string, signal: AbortSignal): Promise<MinecraftLicense> }) {
    this.file = path.join(directory, 'microsoft-v1.json');
  }

  get configured(): boolean { return this.oauth.configured; }

  private read(): Promise<Map<string, SavedAccount>> {
    return this.registry ??= (async () => {
      try {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await guardDirectory(this.directory);
        const bytes = await readRegular(this.file, MAX_REGISTRY_BYTES);
        if (!bytes) return new Map();
        const value: unknown = JSON.parse(bytes.toString('utf8'));
        if (!exactObject(value, ['schemaVersion', 'items']) || value.schemaVersion !== 1
          || !Array.isArray(value.items) || value.items.length > MAX_ACCOUNTS) throw new MicrosoftError('STORAGE');
        const list = value.items.map(parseSaved);
        if (new Set(list.map(item => item.accountId)).size !== list.length
          || new Set(list.map(item => item.identityDigest)).size !== list.length) throw new MicrosoftError('STORAGE');
        return new Map(list.map(item => [item.accountId, item]));
      } catch {
        this.registry = undefined;
        throw new MicrosoftError('STORAGE');
      }
    })();
  }

  private update<T>(change: (items: Map<string, SavedAccount>) => T, signal?: AbortSignal): Promise<T> {
    const operation = this.tail.then(async () => {
      if (this.life.signal.aborted || signal?.aborted) throw new MicrosoftError('CANCELLED');
      const previous = await this.read();
      const items = new Map(previous);
      const value = change(items);
      const directory = await guardDirectory(this.directory);
      const data = JSON.stringify({ schemaVersion: 1, items: Array.from(items.values()) });
      if (items.size > MAX_ACCOUNTS || Buffer.byteLength(data) > MAX_REGISTRY_BYTES) throw new MicrosoftError('STORAGE');
      const temporary = path.join(directory, 'microsoft-' + randomUUID() + '.tmp');
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(data, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        if (signal?.aborted || this.life.signal.aborted) throw new MicrosoftError('CANCELLED');
        if (await guardDirectory(this.directory) !== directory) throw new MicrosoftError('STORAGE');
        await rename(temporary, path.join(directory, 'microsoft-v1.json'));
        this.registry = Promise.resolve(items);
        return value;
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error instanceof MicrosoftError ? error : new MicrosoftError('STORAGE');
      }
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }

  private async seal(result: OAuthAccount): Promise<string> {
    const serialized = JSON.stringify({ homeAccountId: result.homeAccountId, cache: result.cache });
    if (Buffer.byteLength(serialized) > MAX_CREDENTIAL_BYTES - 2048) throw new MicrosoftError('STORAGE');
    try {
      const protectedBytes = await this.secrets.encrypt(serialized);
      if (protectedBytes.length > MAX_CREDENTIAL_BYTES) throw new MicrosoftError('STORAGE');
      return protectedBytes.toString('base64');
    } catch { throw new MicrosoftError('STORAGE'); }
  }

  private async unseal(item: SavedAccount): Promise<Omit<OAuthAccount, 'accessToken'>> {
    try {
      const value: unknown = JSON.parse(await this.secrets.decrypt(Buffer.from(item.sealed, 'base64')));
      if (!exactObject(value, ['homeAccountId', 'cache']) || typeof value.cache !== 'string' || typeof value.homeAccountId !== 'string'
        || identityDigest(value.homeAccountId) !== item.identityDigest) throw new MicrosoftError('STORAGE');
      return { homeAccountId: value.homeAccountId, cache: value.cache };
    } catch { throw new MicrosoftError('STORAGE'); }
  }

  async list(): Promise<MicrosoftAccountView[]> {
    return Array.from((await this.read()).values(), account => ({ ...view(account), ready: this.configured && view(account).ready }));
  }

  async epoch(accountId: string): Promise<string | undefined> {
    const account = (await this.read()).get(accountId);
    return account?.profile && view(account).ready ? account.epoch + ':' + account.profile.gameName : undefined;
  }

  async profile(accountId: string): Promise<MinecraftProfile | undefined> {
    return (await this.read()).get(accountId)?.profile ?? undefined;
  }

  async signIn(): Promise<void> {
    if (!this.oauth.configured) throw new MicrosoftError('UNCONFIGURED');
    if (this.signInSession) throw new MicrosoftError('BUSY');
    const control = new AbortController();
    this.signInSession = control;
    const signal = AbortSignal.any([control.signal, this.life.signal, AbortSignal.timeout(180_000)]);
    try {
      const result = await this.oauth.signIn(signal);
      const license = await this.api.exchange(result.accessToken, randomUUID(), signal);
      const sealed = await this.seal(result);
      const digest = identityDigest(result.homeAccountId);
      const account = await this.update(items => {
        const previous = Array.from(items.values()).find(item => item.identityDigest === digest);
        if (previous?.profile && license.profile && previous.profile.uuid !== license.profile.uuid) throw new MicrosoftError('ACCESS_DENIED');
        const next: SavedAccount = {
          accountId: previous?.accountId ?? randomUUID(), epoch: randomUUID(), identityDigest: digest,
          profile: license.profile ?? null, entitlement: license.entitlement, sealed,
        };
        items.set(next.accountId, next);
        return next;
      }, signal);
      this.licenses.set(account.accountId, { epoch: account.epoch, when: Date.now(), license });
    } finally {
      if (this.signInSession === control) this.signInSession = undefined;
    }
  }

  cancelSignIn(): void { this.signInSession?.abort(); }

  async signOut(accountId: string): Promise<void> {
    await this.update(items => {
      if (!items.delete(accountId)) throw new MicrosoftError('NOT_FOUND');
    });
    this.licenses.delete(accountId);
  }

  private refresh(item: SavedAccount): Promise<MinecraftLicense> {
    const existing = this.refreshes.get(item.epoch);
    if (existing) return existing;
    const signal = AbortSignal.any([this.life.signal, AbortSignal.timeout(90_000)]);
    const promise = (async () => {
      try {
        const credentials = await this.unseal(item);
        const result = await this.oauth.refresh(credentials, signal);
        // Persist a rotated OAuth cache even when the downstream Minecraft service is temporarily unavailable.
        const rotatedCache = result.cache === credentials.cache ? undefined : await this.seal(result);
        if (rotatedCache) await this.update(items => {
          const current = items.get(item.accountId);
          if (!current || current.epoch !== item.epoch) throw new MicrosoftError('REAUTH');
          items.set(item.accountId, { ...current, sealed: rotatedCache });
        }, signal);
        const license = await this.api.exchange(result.accessToken, randomUUID(), signal);
        if (item.profile && license.profile && item.profile.uuid !== license.profile.uuid) throw new MicrosoftError('ACCESS_DENIED');
        const account = await this.update(items => {
          const current = items.get(item.accountId);
          if (!current || current.epoch !== item.epoch) throw new MicrosoftError('REAUTH');
          const next = { ...current, profile: license.profile ?? null, entitlement: license.entitlement };
          items.set(item.accountId, next);
          return next;
        }, signal);
        this.licenses.set(account.accountId, { epoch: account.epoch, when: Date.now(), license });
        return license;
      } catch (error) {
        if (error instanceof MicrosoftError && (error.code === 'REAUTH' || error.code === 'ACCESS_DENIED')) {
          await this.update(items => {
            const current = items.get(item.accountId);
            if (current?.epoch === item.epoch) items.set(item.accountId, { ...current, entitlement: 'reauth' });
          });
          this.licenses.delete(item.accountId);
        }
        throw error;
      }
    })();
    this.refreshes.set(item.epoch, promise);
    void promise.finally(() => { this.refreshes.delete(item.epoch); }).catch(() => {});
    return promise;
  }

  async updateAccount(accountId: string): Promise<void> {
    const item = (await this.read()).get(accountId);
    if (!item) throw new MicrosoftError('NOT_FOUND');
    await this.refresh(item);
  }

  async resolveLaunch(accountId: string, signal: AbortSignal): Promise<(MinecraftProfile & { accessToken: string; clientId: string; epoch: string; xuid?: string }) | undefined> {
    const item = (await this.read()).get(accountId);
    if (!item) return;
    if (!this.configured || !this.oauth.clientId) throw new MicrosoftError('UNCONFIGURED');
    signal.throwIfAborted();
    const cached = this.licenses.get(accountId);
    const license = cached?.epoch === item.epoch && Date.now() - cached.when < 15 * 60_000 && cached.license.expiresAt > Date.now() + 120_000
      ? cached.license : await this.refresh(item);
    signal.throwIfAborted();
    if ((await this.read()).get(accountId)?.epoch !== item.epoch) throw new MicrosoftError('REAUTH');
    if (license.entitlement === 'none') throw new MicrosoftError('NO_LICENSE');
    if (!license.profile) throw new MicrosoftError('NO_PROFILE');
    return { ...license.profile, accessToken: license.accessToken, clientId: this.oauth.clientId,
      epoch: item.epoch + ':' + license.profile.gameName, ...(license.xuid ? { xuid: license.xuid } : {}) };
  }

  close(): void {
    this.life.abort();
    this.licenses.clear();
  }
}
