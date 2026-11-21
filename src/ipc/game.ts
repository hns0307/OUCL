import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { InstanceContractError } from '../shared/contracts/instances.js';
import { gameFailure, isGamePayload, isGameData } from '../shared/contracts/game.js';
import type { GameChannel, GameDispatcher, GameResult } from '../shared/contracts/game.js';
/** Sender, input and output validation precede every launch/stop effect. */
export async function handleGame<C extends GameChannel>(channel: C, input: unknown, trusted: boolean, traceId: string, dispatch: GameDispatcher): Promise<GameResult<C>> {
  const shape = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const id = shape && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return gameFailure(id, 'INVALID_SENDER', traceId);
  if (shape && typeof input.contractVersion === 'number' && input.contractVersion > 1) return gameFailure(id, 'UNSUPPORTED_CONTRACT', traceId);
  if (!shape || input.contractVersion !== 1 || typeof input.requestId !== 'string' || !UUID_PATTERN.test(input.requestId) || !isGamePayload(input.payload, channel)) return gameFailure(id, 'INVALID_ARGUMENT', traceId);
  try { const data = await dispatch(channel, input.payload, id); return isGameData(data, channel) ? { contractVersion: 1, requestId: id, ok: true, data } : gameFailure(id, 'UNAVAILABLE', traceId); }
  catch (error) { return gameFailure(id, error instanceof InstanceContractError ? error.code : 'UNAVAILABLE', traceId); }
}
