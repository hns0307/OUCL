import { ipcRenderer } from 'electron';
import { UUID_PATTERN } from '../shared/contracts/handshake.js';
import { gameFailure, isGamePayload, isGameResult } from '../shared/contracts/game.js';
import type { GameBridge, GameChannel, GamePayloads, GameResult } from '../shared/contracts/game.js';
async function request<C extends GameChannel>(channel: C, payload: GamePayloads[C], id: string): Promise<GameResult<C>> {
  if (!UUID_PATTERN.test(id) || !isGamePayload(payload, channel)) return gameFailure(globalThis.crypto.randomUUID(), 'INVALID_ARGUMENT', globalThis.crypto.randomUUID());
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result: unknown = await Promise.race([ipcRenderer.invoke(channel, { contractVersion: 1, requestId: id, payload }), new Promise(resolve => {
      timer = setTimeout(() => { resolve(gameFailure(id, 'TIMEOUT', id)); }, 3000);
    })]); return isGameResult(result, id, channel) ? result : gameFailure(id, 'UNAVAILABLE', id);
  } catch { return gameFailure(id, 'UNAVAILABLE', id); } finally { clearTimeout(timer); }
}
/** Fixed references only, never an arbitrary executable/argument transport. */
export function createGameBridge(): GameBridge { return { launchGame: (id, input) => request('game:launch', input, id), stopGame: (id, input) => request('game:stop', input, id),
  listSessions: query => request('sessions:list', query, globalThis.crypto.randomUUID()), getSession: sessionId => request('sessions:get', { sessionId }, globalThis.crypto.randomUUID()) }; }
