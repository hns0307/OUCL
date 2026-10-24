import { contextBridge, ipcRenderer } from 'electron';
import { CONTRACT_VERSION, HANDSHAKE_CHANNEL, HANDSHAKE_TIMEOUT_MS, isHandshakeResult } from '../shared/contracts/handshake.js';
import type { LauncherBridge, HandshakeResult } from '../shared/contracts/handshake.js';
import { handshakeFailure } from './handshake.js';

const bridge: LauncherBridge = Object.freeze({
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
