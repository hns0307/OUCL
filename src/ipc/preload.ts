import { contextBridge, ipcRenderer } from 'electron';
import { CONTRACT_VERSION, HANDSHAKE_CHANNEL, HANDSHAKE_TIMEOUT_MS, isHandshakeResult } from '../shared/contracts/handshake.js';
import type { LauncherBridge, HandshakeResult } from '../shared/contracts/handshake.js';
import { handshakeFailure } from './handshake.js';
import { isRootsResult, ROOTS_CHOOSE_CHANNEL, ROOTS_LIST_CHANNEL, rootsFailure } from '../shared/contracts/roots.js';
import type { RootsData, RootsResult, RootSelection, RootSummary } from '../shared/contracts/roots.js';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';

async function rootRequest<T extends RootsData>(channel: string, kind: 'list' | 'choose', requestId: string, timeoutMs: number): Promise<RootsResult<T>> {
  if (!UUID_PATTERN.test(requestId)) return rootsFailure(globalThis.crypto.randomUUID(), 'INVALID_ARGUMENT', globalThis.crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<RootsResult<T>>(resolve => { timer = setTimeout(() => { resolve(rootsFailure(requestId, 'TIMEOUT', requestId)); }, timeoutMs); });
    const reply: unknown = await Promise.race([ipcRenderer.invoke(channel, { contractVersion: 1, requestId, payload: {} }), timeout]);
    return isRootsResult(reply, requestId, kind) ? reply as RootsResult<T> : rootsFailure(requestId, 'UNAVAILABLE', requestId);
  } catch { return rootsFailure(requestId, 'UNAVAILABLE', requestId); }
  finally { clearTimeout(timer); }
}

const bridge: LauncherBridge = Object.freeze({
  listRoots: () => rootRequest<{ items: RootSummary[] }>(ROOTS_LIST_CHANNEL, 'list', globalThis.crypto.randomUUID(), 3000),
  chooseRoot: (requestId: string) => rootRequest<RootSelection>(ROOTS_CHOOSE_CHANNEL, 'choose', requestId, 120000),
  async handshake(): Promise<HandshakeResult> {
    const requestId = globalThis.crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<HandshakeResult>(resolve => {
        timer = setTimeout(() => resolve(handshakeFailure(requestId, 'TIMEOUT', requestId)), HANDSHAKE_TIMEOUT_MS);
      });
      const reply: unknown = await Promise.race([
        ipcRenderer.invoke(HANDSHAKE_CHANNEL, { contractVersion: CONTRACT_VERSION, requestId, payload: { supportedVersions: [1] } }),
        timeout,
      ]);
      return isHandshakeResult(reply, requestId) ? reply : handshakeFailure(requestId, 'UNAVAILABLE', requestId);
    } catch {
      return handshakeFailure(requestId, 'UNAVAILABLE', requestId);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  },
});
contextBridge.exposeInMainWorld('oucl', bridge);
