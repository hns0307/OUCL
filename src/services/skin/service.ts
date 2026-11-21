import { randomUUID } from 'node:crypto';
import { SkinContractError } from '../../shared/contracts/skin.js';
import type { SkinLoginResult, SkinPayload, SkinPreview, SkinProvider, SkinRole, SkinRoleAccount, SkinSnapshot, SkinUploadReceipt } from '../../shared/contracts/skin.js';
import { resolveSkinAgent, verifySkinAgent } from './agent.js';
import { skinTransport } from './http.js';
import type { SkinTransport } from './http.js';
import { authenticateSkin, credentials, discoverSkinProvider, refreshSkin, revokeSkin, skinProfile, skinProfileCanUpload, uploadSkin, validateSkin } from './provider.js';
import type { SkinAuthentication, SkinCredentials, StoredSkinProvider } from './provider.js';
import { SkinRecords } from './records.js';
import type { SkinRecord, StoredSkinAccount } from './records.js';

const TEMPORARY_MS = 5 * 60_000;
const TEMPORARY_LIMIT = 8;
export interface SkinSecretStorage {
  encrypt(plaintext: string): Promise<Buffer>;
  decrypt(ciphertext: Buffer): Promise<string>;
}
interface SkinOptions {
  directory: string; secrets: SkinSecretStorage; openExternal(url: string): Promise<void>; transport?: SkinTransport;
}
export interface SkinLaunchIdentity extends SkinRole {
  revision: number; accessToken: string; agentPath: string; apiRoot: string; prefetchedMetadata: string;
}
interface Discovery { provider: StoredSkinProvider; expires: number }
interface PendingLogin { providerId: string; auth: SkinAuthentication; expires: number }

function publicProvider(provider: StoredSkinProvider): SkinProvider {
  const { providerId, name, apiRoot, homepage, adapter, loginByName } = provider;
  return { providerId, name, apiRoot, homepage, adapter, loginByName };
}
function publicAccount(account: StoredSkinAccount, provider: StoredSkinProvider): SkinRoleAccount {
  return { accountId: account.accountId, providerId: account.providerId, providerName: provider.name, uuid: account.uuid,
    gameName: account.gameName, ready: account.encrypted !== null };
}

/** Owns provider discovery, role-bound credentials, signed previews and the trusted launch agent. */
export class SkinService {
  private readonly records: SkinRecords;
  private readonly send: SkinTransport;
  private readonly lifetime = new AbortController();
  private readonly discoveries = new Map<string, Discovery>();
  private readonly logins = new Map<string, PendingLogin>();
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(private readonly options: SkinOptions) {
    this.records = new SkinRecords(options.directory);
    this.send = options.transport ?? skinTransport;
  }

  private run<T>(action: (signal: AbortSignal) => Promise<T>, caller?: AbortSignal): Promise<T> {
    if (this.lifetime.signal.aborted) return Promise.reject(new SkinContractError('CANCELLED'));
    if (this.pending >= 16) return Promise.reject(new SkinContractError('UNAVAILABLE'));
    this.pending++;
    const deadline = AbortSignal.timeout(60_000);
    const signal = AbortSignal.any(caller ? [caller, this.lifetime.signal, deadline] : [this.lifetime.signal, deadline]);
    const promise = this.tail.then(async () => {
      try {
        if (signal.aborted) throw new SkinContractError('CANCELLED');
        return await action(signal);
      } catch (error) {
        if (deadline.aborted && !caller?.aborted && !this.lifetime.signal.aborted) throw new SkinContractError('TIMEOUT');
        throw error;
      }
    });
    this.tail = promise.catch(() => {}).finally(() => { this.pending--; });
    return promise;
  }

  private provider(state: SkinRecord, id: string): StoredSkinProvider {
    const site = state.providers.find(provider => provider.providerId === id);
    if (!site) throw new SkinContractError('NOT_FOUND');
    return site;
  }

  private role(state: SkinRecord, id: string): StoredSkinAccount {
    const account = state.accounts.find(item => item.accountId === id);
    if (!account) throw new SkinContractError('NOT_FOUND');
    return account;
  }

  private temporary<T extends { expires: number }>(entries: Map<string, T>): void {
    for (const [id, item] of entries) if (item.expires <= Date.now()) entries.delete(id);
    if (entries.size >= TEMPORARY_LIMIT) throw new SkinContractError('UNAVAILABLE');
  }

  private async plaintext(account: StoredSkinAccount, provider: StoredSkinProvider): Promise<SkinCredentials> {
    if (account.encrypted === null) throw new SkinContractError('AUTH_EXPIRED');
    try {
      const document: unknown = JSON.parse(await this.options.secrets.decrypt(Buffer.from(account.encrypted, 'base64')));
      if (typeof document !== 'object' || document === null || !('accountId' in document) || document.accountId !== account.accountId
        || !('providerId' in document) || document.providerId !== provider.providerId || !('apiRoot' in document) || document.apiRoot !== provider.apiRoot
        || !('profileUuid' in document) || document.profileUuid !== account.uuid || !('token' in document)) throw new Error('Mismatched credential');
      return credentials(document.token);
    } catch { throw new SkinContractError('SECRET_UNAVAILABLE'); }
  }

  private async persistLogin(state: SkinRecord, provider: StoredSkinProvider, role: SkinRole,
    auth: SkinCredentials, existing?: StoredSkinAccount, bump = true): Promise<StoredSkinAccount> {
    const accountId = existing?.accountId ?? randomUUID();
    const revision = existing ? existing.revision + Number(bump || role.gameName !== existing.gameName) : 1;
    let encrypted: string;
    try {
      const blob = await this.options.secrets.encrypt(JSON.stringify({ accountId, providerId: provider.providerId, apiRoot: provider.apiRoot,
        profileUuid: role.uuid, token: credentials(auth) }));
      if (!blob.length || blob.length > 24 * 1024) throw new Error('Ciphertext size');
      encrypted = blob.toString('base64');
    } catch { throw new SkinContractError('SECRET_UNAVAILABLE'); }
    const account = { accountId, providerId: provider.providerId, gameName: role.gameName, uuid: role.uuid, revision, encrypted };
    state.accounts = [...state.accounts.filter(item => item.accountId !== accountId), account];
    await this.records.write(state);
    return account;
  }

  private async active(state: SkinRecord, provider: StoredSkinProvider, account: StoredSkinAccount, signal: AbortSignal): Promise<SkinCredentials> {
    const previous = await this.plaintext(account, provider);
    if (await validateSkin(this.send, provider, previous, signal)) return previous;
    try {
      const next = await refreshSkin(this.send, provider, previous, signal);
      if (next.selected?.uuid !== account.uuid) throw new SkinContractError('AUTH_EXPIRED');
      await this.persistLogin(state, provider, next.selected, next, account, false);
      return next;
    } catch (error) {
      if (error instanceof SkinContractError && error.code === 'AUTH_EXPIRED') {
        account.encrypted = null;
        account.revision++;
        await this.records.write(state);
      }
      throw error;
    }
  }

  private async finishLogin(state: SkinRecord, provider: StoredSkinProvider, auth: SkinAuthentication, chosen: SkinRole, signal: AbortSignal): Promise<SkinRoleAccount> {
    const existing = state.accounts.find(item => item.providerId === provider.providerId && item.uuid === chosen.uuid);
    if (!existing && state.accounts.length >= 256) throw new SkinContractError('UNAVAILABLE');
    const bound = auth.selected ? auth : await refreshSkin(this.send, provider, auth, signal, chosen);
    if (bound.selected?.uuid !== chosen.uuid) throw new SkinContractError('AUTH_FAILED');
    try { return publicAccount(await this.persistLogin(state, provider, bound.selected, bound, existing), provider); }
    catch (error) { await revokeSkin(this.send, provider, bound, signal).catch(() => false); throw error; }
  }

  /** Reads saved sites and accounts without touching the secret store or the network. */
  list(): Promise<SkinSnapshot> {
    return this.run(async () => {
      const state = await this.records.read();
      return { providers: state.providers.map(publicProvider), accounts: state.accounts.map(account => publicAccount(account, this.provider(state, account.providerId))) };
    });
  }

  /** Projects saved role accounts for the common launcher account chooser. */
  async listAccounts(): Promise<SkinRoleAccount[]> { return (await this.list()).accounts; }

  /** Returns a launch identity revision that changes when the local authentication or role changes. */
  accountRevision(accountId: string): Promise<number | undefined> {
    return this.run(async () => (await this.records.read()).accounts.find(account => account.accountId === accountId)?.revision);
  }

  /** Probes anonymous provider data; only a follow-up add action persists the discovered origin. */
  discover(url: string): Promise<{ discoveryId: string; provider: SkinProvider }> {
    return this.run(async signal => {
      this.temporary(this.discoveries);
      const provider = await discoverSkinProvider(this.send, url, AbortSignal.any([signal, AbortSignal.timeout(25_000)]));
      const discoveryId = randomUUID();
      this.discoveries.set(discoveryId, { provider, expires: Date.now() + TEMPORARY_MS });
      return { discoveryId, provider: publicProvider(provider) };
    });
  }

  /** Saves the confirmed provider, deduplicated by its normalized authentication root. */
  addProvider(discoveryId: string): Promise<SkinProvider> {
    return this.run(async () => {
      const discovered = this.discoveries.get(discoveryId);
      if (!discovered || discovered.expires <= Date.now()) throw new SkinContractError('NOT_FOUND');
      const state = await this.records.read();
      const existing = state.providers.find(item => item.apiRoot === discovered.provider.apiRoot);
      if (existing) { this.discoveries.delete(discoveryId); return publicProvider(existing); }
      if (state.providers.length >= 32) throw new SkinContractError('UNAVAILABLE');
      state.providers.push(discovered.provider);
      await this.records.write(state);
      this.discoveries.delete(discoveryId);
      return publicProvider(discovered.provider);
    });
  }

  /** Removes the chosen provider and its local role credentials; the site itself is untouched. */
  removeProvider(providerId: string): Promise<void> {
    return this.run(async () => {
      const state = await this.records.read();
      this.provider(state, providerId);
      state.providers = state.providers.filter(item => item.providerId !== providerId);
      state.accounts = state.accounts.filter(item => item.providerId !== providerId);
      await this.records.write(state);
      for (const [id, login] of this.logins) if (login.providerId === providerId) this.logins.delete(id);
    });
  }

  /** Authenticates once and keeps unbound multi-role credentials in main-process memory for role selection. */
  login(input: SkinPayload['skin:login']): Promise<SkinLoginResult> {
    return this.run(async signal => {
      this.temporary(this.logins);
      const state = await this.records.read();
      const provider = this.provider(state, input.providerId);
      const auth = await authenticateSkin(this.send, provider, input.username, input.password, signal);
      const onlyRole = auth.selected ?? (auth.roles.length === 1 ? auth.roles[0] : undefined);
      if (onlyRole) return { state: 'ready', account: await this.finishLogin(state, provider, auth, onlyRole, signal) };
      if (!auth.roles.length) {
        await revokeSkin(this.send, provider, auth, signal).catch(() => false);
        throw new SkinContractError('NO_ROLES');
      }
      const loginId = randomUUID();
      this.logins.set(loginId, { providerId: provider.providerId, auth, expires: Date.now() + TEMPORARY_MS });
      return { state: 'select', loginId, roles: auth.roles };
    });
  }

  /** Binds an unbound login only to a role returned by that same provider. */
  selectRole(loginId: string, uuid: string): Promise<SkinRoleAccount> {
    return this.run(async signal => {
      const login = this.logins.get(loginId);
      if (!login || login.expires <= Date.now()) throw new SkinContractError('AUTH_EXPIRED');
      const chosen = login.auth.roles.find(role => role.uuid === uuid);
      if (!chosen) throw new SkinContractError('NOT_FOUND');
      const state = await this.records.read();
      const account = await this.finishLogin(state, this.provider(state, login.providerId), login.auth, chosen, signal);
      this.logins.delete(loginId);
      return account;
    });
  }

  /** Clears a pending login from memory and attempts to invalidate its server token. */
  cancelLogin(loginId: string): Promise<void> {
    return this.run(async signal => {
      const login = this.logins.get(loginId);
      if (!login) return;
      this.logins.delete(loginId);
      const state = await this.records.read();
      await revokeSkin(this.send, this.provider(state, login.providerId), login.auth, signal).catch(() => false);
    });
  }

  /** Removes the local ciphertext even when the remote server cannot confirm invalidation. */
  logout(accountId: string): Promise<{ revoked: boolean }> {
    return this.run(async signal => {
      const state = await this.records.read();
      const account = this.role(state, accountId);
      const provider = this.provider(state, account.providerId);
      if (account.encrypted === null) return { revoked: false };
      const token = await this.plaintext(account, provider).catch(() => undefined);
      account.encrypted = null;
      account.revision++;
      await this.records.write(state);
      return { revoked: token ? await revokeSkin(this.send, provider, token, signal).catch(() => false) : false };
    });
  }

  /** Returns role-bound public texture data even when the user must log in again. */
  preview(accountId: string): Promise<SkinPreview> {
    return this.run(async signal => {
      const state = await this.records.read();
      const account = this.role(state, accountId);
      return skinProfile(this.send, this.provider(state, account.providerId), account, signal);
    });
  }

  /** Confirms provider upload support, sends the chosen skin, and reloads the published profile. */
  upload(input: SkinPayload['skin:upload']): Promise<SkinUploadReceipt> {
    return this.run(async signal => {
      const state = await this.records.read();
      const account = this.role(state, input.accountId);
      const provider = this.provider(state, account.providerId);
      if (!await skinProfileCanUpload(this.send, provider, account, signal)) throw new SkinContractError('UPLOAD_UNSUPPORTED');
      const token = await this.active(state, provider, account, signal);
      await uploadSkin(this.send, provider, account, token, input.png, input.model, signal);
      const preview = await skinProfile(this.send, provider, account, signal).catch(() => undefined);
      return { applied: true, ...(preview ? { preview } : {}) };
    });
  }

  /** Opens the confirmed site through the host adapter for features without a supported native API. */
  openSite(providerId: string): Promise<void> {
    return this.run(async () => {
      const provider = this.provider(await this.records.read(), providerId);
      await this.options.openExternal(provider.homepage);
    });
  }

  /** Resolves secrets only for launch and revalidates the cached Agent before returning it. */
  resolveLaunch(accountId: string, caller?: AbortSignal): Promise<SkinLaunchIdentity | undefined> {
    return this.run(async signal => {
      const state = await this.records.read();
      const account = state.accounts.find(item => item.accountId === accountId);
      if (!account) return;
      const provider = this.provider(state, account.providerId);
      const token = await this.active(state, provider, account, signal);
      const agentPath = await resolveSkinAgent(this.records.directory, this.send, signal);
      const current = this.role(state, accountId);
      return { gameName: current.gameName, uuid: current.uuid, revision: current.revision, accessToken: token.accessToken, agentPath, apiRoot: provider.apiRoot,
        prefetchedMetadata: Buffer.from(provider.metadata).toString('base64') };
    }, caller);
  }

  /** Rechecks the admitted Agent immediately before the caller spawns Java. */
  verifyLaunchAgent(agentPath: string): Promise<boolean> {
    return verifySkinAgent(this.records.directory, agentPath);
  }
  /** Cancels outstanding I/O and joins serialized storage work. */
  async close(): Promise<void> {
    this.lifetime.abort();
    await this.tail;
    this.logins.clear();
    this.discoveries.clear();
  }
}
