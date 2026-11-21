import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { PACK_CHANNEL, isPackResult, packFailure } from '../shared/contracts/packs.js';
import type { PacksBridge } from '../shared/contracts/packs.js';

/** Do not abandon an open native chooser on a renderer timeout. */
export function createPacksBridge(): PacksBridge {
  return { async inspectFixedPack(requestId) {
    if (!UUID_PATTERN.test(requestId)) return packFailure(globalThis.crypto.randomUUID(), 'INVALID_ARGUMENT', globalThis.crypto.randomUUID());
    try {
      const reply: unknown = await ipcRenderer.invoke(PACK_CHANNEL, { contractVersion: 1, requestId, payload: {} });
      return isPackResult(reply, requestId) ? reply : packFailure(requestId, 'UNAVAILABLE', requestId);
    } catch { return packFailure(requestId, 'UNAVAILABLE', requestId); }
  } };
}
