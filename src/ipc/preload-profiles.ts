import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isProfilePayload, isProfileResult, profileFailure } from '../shared/contracts/profiles.js';
import type { ProfileChannel, ProfilePayloads, ProfileResult, ProfilesBridge } from '../shared/contracts/profiles.js';

async function request<C extends ProfileChannel>(channel: C, payload: ProfilePayloads[C], requestId: string, timeoutMs = 3000): Promise<ProfileResult<C>> {
  if (!UUID_PATTERN.test(requestId) || !isProfilePayload(payload, channel)) return profileFailure(globalThis.crypto.randomUUID(), 'INVALID_ARGUMENT', globalThis.crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply: unknown = await Promise.race([ipcRenderer.invoke(channel, { contractVersion: 1, requestId, payload }), new Promise(resolve => {
      timer = setTimeout(() => { resolve(profileFailure(requestId, 'TIMEOUT', requestId)); }, timeoutMs);
    })]);
    return isProfileResult(reply, requestId, channel) ? reply : profileFailure(requestId, 'UNAVAILABLE', requestId);
  } catch { return profileFailure(requestId, 'UNAVAILABLE', requestId); } finally { clearTimeout(timer); }
}
/** Fixed profile methods only; no arbitrary channel/path/argument capability is exposed. */
export function createProfilesBridge(): ProfilesBridge {
  return { getDownloadSettings: () => request('settings:downloadsGet', {}, globalThis.crypto.randomUUID()),
    updateDownloadSettings: (id, input) => request('settings:downloadsUpdate', input, id, 5000),
    updateSettings: (id, input) => request('settings:update', input, id, 5000), chooseJava: id => request('java:choose', {}, id, 130000), listAccounts: () => request('accounts:list', {}, globalThis.crypto.randomUUID()),
    createOfflineAccount: (id, input) => request('accounts:createOffline', input, id), getSettings: () => request('settings:get', {}, globalThis.crypto.randomUUID()) };
}
