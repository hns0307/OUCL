import { ipcRenderer } from 'electron';
import { desktopFailure, isDesktopPayload, isDesktopResult } from '../shared/contracts/desktop.js';
import type { DesktopBridge, DesktopChannel, DesktopPayloads, DesktopResult } from '../shared/contracts/desktop.js';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';

async function request<C extends DesktopChannel>(c: C, payload: DesktopPayloads[C], requestId: string = globalThis.crypto.randomUUID(), timeoutMs = 8000): Promise<DesktopResult<C>> {
  if (!UUID_PATTERN.test(requestId) || !isDesktopPayload(payload, c)) return desktopFailure(globalThis.crypto.randomUUID(), 'INVALID_ARGUMENT', globalThis.crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { const result: unknown = await Promise.race([ipcRenderer.invoke(c, { contractVersion: 1, requestId, payload }), new Promise(resolve => { timer = setTimeout(() => { resolve(desktopFailure(requestId, 'TIMEOUT', requestId)); }, timeoutMs); })]);
    return isDesktopResult(result, requestId, c) ? result : desktopFailure(requestId, 'UNAVAILABLE', requestId);
  } catch { return desktopFailure(requestId, 'UNAVAILABLE', requestId); } finally { clearTimeout(timer); }
}
/** Fixed methods only; callers cannot read paths, load remote images or invoke arbitrary channels. */
export function createDesktopBridge(): DesktopBridge { return {
  getDesktop: () => request('desktop:get', {}), updateAppearance: (id, input) => request('desktop:appearance', input, id),
  saveForumDraft: (id, input) => request('desktop:saveDraft', input, id), deleteForumDraft: (id, input) => request('desktop:deleteDraft', input, id),
  chooseDesktopIcon: id => request('desktop:chooseIcon', {}, id, 130000), resourceIcon: projectId => request('desktop:resourceIcon', { projectId }, globalThis.crypto.randomUUID(), 60000),
}; }
