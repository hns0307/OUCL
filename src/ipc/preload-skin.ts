import { ipcRenderer } from 'electron';
import { isSkinPayload, isSkinResult, skinFailure } from '../shared/contracts/skin.js';
import type { SkinBridge, SkinChannel, SkinPayload, SkinResult } from '../shared/contracts/skin.js';

async function invoke<C extends SkinChannel>(channel: C, payload: SkinPayload[C]): Promise<SkinResult<C>> {
  const requestId = globalThis.crypto.randomUUID();
  if (!isSkinPayload(payload, channel)) return skinFailure(requestId, 'INVALID_ARGUMENT', requestId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result: unknown = await Promise.race([
      ipcRenderer.invoke(channel, { contractVersion: 1, requestId, payload }),
      new Promise(resolve => { timer = setTimeout(() => resolve(skinFailure(requestId, 'TIMEOUT', requestId)), 70_000); }),
    ]);
    return isSkinResult(result, requestId, channel) ? result : skinFailure(requestId, 'UNAVAILABLE', requestId);
  } catch { return skinFailure(requestId, 'UNAVAILABLE', requestId); }
  finally { clearTimeout(timer); }
}

/** Exposes only the skin operations that own validated provider or role IDs. */
export function createSkinBridge(): SkinBridge {
  return {
    skinList: () => invoke('skin:list', {}),
    skinDiscover: url => invoke('skin:discover', { url }),
    skinAddProvider: discoveryId => invoke('skin:addProvider', { discoveryId }),
    skinRemoveProvider: providerId => invoke('skin:removeProvider', { providerId }),
    skinLogin: input => invoke('skin:login', input),
    skinSelectRole: (loginId, roleUuid) => invoke('skin:selectRole', { loginId, roleUuid }),
    skinCancelLogin: loginId => invoke('skin:cancelLogin', { loginId }),
    skinLogout: accountId => invoke('skin:logout', { accountId }),
    skinPreview: accountId => invoke('skin:preview', { accountId }),
    skinUpload: input => invoke('skin:upload', input),
    skinOpenSite: providerId => invoke('skin:openSite', { providerId }),
  };
}
