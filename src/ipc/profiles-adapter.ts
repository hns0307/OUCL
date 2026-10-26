import { DEFAULT_SETTINGS } from '../services/storage/settings.js';
import { updateSettings, configureDownloads } from '../services/launch/settings.js';
import { DEFAULT_DOWNLOAD_PREFERENCES } from '../shared/contracts/download-preferences.js';
import type { DownloadPreferences } from '../shared/contracts/download-preferences.js';
import { ProfileService, ProfileError } from '../services/launch/profiles.js';
import type { StorageClient } from '../services/workers/storage-client.js';
import { ProfileContractError } from '../shared/contracts/profiles.js';
import type { AccountSummary, ProfileChannel, ProfileData, ProfileDispatcher, ProfilePayloads } from '../shared/contracts/profiles.js';
import type { OfflineAccount } from '../services/storage/launch-profiles.js';

const summary = (account: OfflineAccount): AccountSummary => ({ accountId: account.accountId, kind: 'offline', displayName: account.displayName, gameName: account.gameName, ready: true });
/** Produces only approved public DTOs from private profiles. The caller supplies a trusted native selector. */
export function profileDispatcher(service: ProfileService, storage: Pick<StorageClient, 'readLaunchProfiles' | 'readInstallation' | 'readSettings' | 'writeSettings'>, choose: (requestId: string) => Promise<string | undefined>, downloadsChanged?: (preferences: DownloadPreferences) => void): ProfileDispatcher {
  return async <C extends ProfileChannel>(channel: C, payload: ProfilePayloads[C], requestId: string): Promise<ProfileData[C]> => {
    try {
      let result: ProfileData[ProfileChannel];
      if (channel === 'settings:downloadsGet' || channel === 'settings:downloadsUpdate') {
        if (channel === 'settings:downloadsUpdate') { const input = payload as ProfilePayloads['settings:downloadsUpdate']; await configureDownloads(storage, input.expectedRevision, input.preferences); }
        const settings = await storage.readSettings(); const preferences = settings?.data.downloads ?? DEFAULT_DOWNLOAD_PREFERENCES;
        downloadsChanged?.(preferences); result = { revision: settings?.revision ?? 0, ...preferences };
      } else if (channel === 'accounts:list') result = { items: (await service.list()).accounts.map(summary) };
      else if (channel === 'accounts:createOffline') result = { account: summary(await service.createOffline(requestId, payload as ProfilePayloads['accounts:createOffline'])) };
      else if (channel === 'java:choose') {
        const executable = await choose(requestId);
        if (!executable) result = { selection: 'cancelled' };
        else {
          const java = await service.registerJava(executable);
          result = { selection: 'chosen', java: { javaId: java.javaId, major: java.major, arch: 'x64', source: 'system', available: true } };
        }
      } else {
        if (channel === 'settings:update') { const input = payload as ProfilePayloads['settings:update']; await updateSettings(storage, input.expectedRevision, input.patch); }
        const [profiles, installation, settings] = await Promise.all([storage.readLaunchProfiles(), storage.readInstallation(), storage.readSettings()]);
        const data = settings?.data ?? DEFAULT_SETTINGS;
        result = { revision: settings?.revision ?? 0, memoryMiB: data.memoryMiB, isolationDefault: data.isolationDefault, theme: 'system',
          ...(installation ? { rootId: installation.data.rootId } : {}), ...(profiles?.data.selectedJavaId ? { javaId: profiles.data.selectedJavaId } : {}) };
      }
      return result as ProfileData[C];
    } catch (error) {
      if (error instanceof ProfileContractError) throw error;
      throw new ProfileContractError(error instanceof ProfileError ? error.code : 'STORAGE_UNAVAILABLE');
    }
  };
}
