import { ipcRenderer } from 'electron';
import { isMultiplayerInput, isMultiplayerResult, MULTIPLAYER_CHANNEL } from '../shared/contracts/multiplayer.js';
import type { MultiplayerBridge, MultiplayerResult, RoomCode } from '../shared/contracts/multiplayer.js';

function failure(requestId: string, code: RoomCode): MultiplayerResult {
  return { contractVersion: 1, requestId, ok: false, error: { code, traceId: requestId } };
}
/** Exposes the launcher-only, versioned room controller. */
export function createMultiplayerBridge(): MultiplayerBridge {
  return { async multiplayer(payload) {
    const requestId = crypto.randomUUID();
    if (!isMultiplayerInput(payload)) return failure(requestId, 'INVALID_ARGUMENT');
    const request = { contractVersion: 1 as const, requestId, payload };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<MultiplayerResult>(resolve => {
        timer = setTimeout(() => resolve(failure(requestId, 'TIMEOUT')), payload.action === 'importEngine' ? 60_000 : 8_000);
      });
      const reply: unknown = await Promise.race([ipcRenderer.invoke(MULTIPLAYER_CHANNEL, request), timeout]);
      return isMultiplayerResult(reply, request) ? reply : failure(requestId, 'UNAVAILABLE');
    } catch {
      return failure(requestId, 'UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  } };
}
