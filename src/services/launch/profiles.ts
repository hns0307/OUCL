import { createHash, randomUUID } from 'node:crypto';
import { JavaProbe } from '../java/probe.js';
import type { JavaRuntime } from '../java/probe.js';
import { offlineUuid, parseLaunchProfiles, validGameName } from '../storage/launch-profiles.js';
import type { LaunchProfiles, OfflineAccount, RegisteredJava } from '../storage/launch-profiles.js';
import type { StorageClient } from '../workers/storage-client.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { normalizeDataDirectory } from '../../core/path/layout.js';

export class ProfileError extends Error {
  readonly category = 'validation';
  constructor(readonly code: 'ACCOUNT_NAME_INVALID' | 'ACCOUNT_CONFLICT' | 'INVALID_ARGUMENT' | 'STORAGE_UNAVAILABLE' | 'JAVA_INVALID') { super(code); this.name = 'ProfileError'; }
}
/** Serializes the single fixed profile record; display names never select paths or change game identity. */
export class ProfileService {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly storage: Pick<StorageClient, 'readLaunchProfiles' | 'writeLaunchProfiles'>, private readonly probe: Pick<JavaProbe, 'probe'> = new JavaProbe()) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action); this.tail = result.then(() => {}, () => {}); return result;
  }
  private async read(): Promise<{ revision: number; data: LaunchProfiles }> {
    return await this.storage.readLaunchProfiles() ?? { revision: 0, data: { javas: [], accounts: [], requests: [] } };
  }
  /** Reads trusted internal profiles, including the private executable/UUID; adapters must project a public DTO. */
  async list(): Promise<LaunchProfiles> { return (await this.read()).data; }
  /** Persists the measured explicitly chosen JVM; reselecting the same path preserves its opaque reference. */
  async registerJava(executable: string): Promise<RegisteredJava> {
    let runtime: JavaRuntime;
    try { runtime = await this.probe.probe(executable); } catch { throw new ProfileError('JAVA_INVALID'); }
    return this.serial(async () => {
      const current = await this.read();
      const executable = normalizeDataDirectory(runtime.executable);
      const existing = current.data.javas.find(java => java.executable.toLowerCase() === executable.toLowerCase());
      if (!existing && current.data.javas.length >= 32) throw new ProfileError('STORAGE_UNAVAILABLE');
      const java: RegisteredJava = { javaId: existing?.javaId ?? randomUUID(), executable, major: runtime.major, version: runtime.version, vendor: runtime.vendor };
      const data = parseLaunchProfiles({ ...current.data, javas: [...current.data.javas.filter(item => item.javaId !== java.javaId), java], selectedJavaId: java.javaId });
      await this.storage.writeLaunchProfiles(current.revision, data); return java;
    });
  }
  /** Atomically stores the approved stable offline UUID and request result before acknowledging creation. */
  createOffline(requestId: string, input: { displayName: string; gameName: string }): Promise<OfflineAccount> {
    if (!UUID_PATTERN.test(requestId) || !validGameName(input.gameName) || typeof input.displayName !== 'string' || !input.displayName.trim()
      || input.displayName.length > 80 || /[\p{C}]/u.test(input.displayName)) return Promise.reject(new ProfileError('ACCOUNT_NAME_INVALID'));
    const canonical = { displayName: input.displayName.trim(), gameName: input.gameName };
    const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    return this.serial(async () => {
      const current = await this.read(); const request = current.data.requests.find(item => item.requestId === requestId.toLowerCase());
      if (request) {
        if (request.digest !== digest) throw new ProfileError('INVALID_ARGUMENT');
        const existing = current.data.accounts.find(item => item.accountId === request.accountId);
        if (!existing) throw new ProfileError('STORAGE_UNAVAILABLE'); return existing;
      }
      if (current.data.accounts.some(account => account.gameName === canonical.gameName)) throw new ProfileError('ACCOUNT_CONFLICT');
      if (current.data.accounts.length >= 1000 || current.data.requests.length >= 2048) throw new ProfileError('STORAGE_UNAVAILABLE');
      const account: OfflineAccount = { accountId: randomUUID(), ...canonical, uuid: offlineUuid(canonical.gameName) };
      const data = parseLaunchProfiles({ ...current.data, accounts: [...current.data.accounts, account],
        requests: [...current.data.requests, { requestId: requestId.toLowerCase(), digest, accountId: account.accountId }] });
      await this.storage.writeLaunchProfiles(current.revision, data); return account;
    });
  }
}
