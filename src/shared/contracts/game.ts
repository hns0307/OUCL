import { exactObject, UUID_PATTERN } from './handshake.js';
import { isInstanceError, instanceFailure } from './instances.js';
import type { InstanceCode, InstanceError, Page } from './instances.js';

export const GAME_CHANNELS = ['game:launch', 'game:stop', 'sessions:list', 'sessions:get'] as const;
export const GAME_CAPABILITIES = ['game.v1', 'sessions.v1'] as const;
export type GameChannel = typeof GAME_CHANNELS[number];
export interface SessionSnapshot { sessionId: string; instanceId: string; state: 'running' | 'stopping' | 'exited' | 'unknown'; revision: number; startedAt: string; exitCode?: number }
export interface GamePayloads {
  'game:launch': { instanceId: string; accountId: string; expectedRevision: number };
  'game:stop': { sessionId: string; mode: 'graceful' | 'force'; confirmed: boolean };
  'sessions:get': { sessionId: string }; 'sessions:list': { limit: number; cursor?: string };
}
export interface GameData { 'game:launch': { taskId: string }; 'game:stop': { taskId: string }; 'sessions:get': SessionSnapshot; 'sessions:list': Page<SessionSnapshot> }
export type GameResult<C extends GameChannel> = { contractVersion: 1; requestId: string; ok: true; data: GameData[C] } | { contractVersion: 1; requestId: string; ok: false; error: InstanceError };
export interface GameDispatcher { <C extends GameChannel>(channel: C, payload: GamePayloads[C], requestId: string): Promise<GameData[C]> }
export interface GameBridge {
  launchGame(requestId: string, input: GamePayloads['game:launch']): Promise<GameResult<'game:launch'>>;
  stopGame(requestId: string, input: GamePayloads['game:stop']): Promise<GameResult<'game:stop'>>;
  listSessions(query: GamePayloads['sessions:list']): Promise<GameResult<'sessions:list'>>;
  getSession(sessionId: string): Promise<GameResult<'sessions:get'>>;
}
const uuid = (x: unknown): x is string => typeof x === 'string' && UUID_PATTERN.test(x);
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const cursor = (x: unknown): x is string => typeof x === 'string' && x.length >= 1 && x.length <= 512 && !/[\p{C}]/u.test(x);
/** Exact instance/account/session references only; renderer cannot provide executables, paths or JVM arguments. */
export function isGamePayload<C extends GameChannel>(x: unknown, channel: C): x is GamePayloads[C] {
  switch (channel) {
    case 'game:launch': return exactObject(x, ['instanceId', 'accountId', 'expectedRevision']) && uuid(x.instanceId) && uuid(x.accountId) && integer(x.expectedRevision) && x.expectedRevision > 0;
    case 'game:stop': return exactObject(x, ['sessionId', 'mode', 'confirmed']) && uuid(x.sessionId) && ['graceful', 'force'].includes(x.mode as string) && typeof x.confirmed === 'boolean';
    case 'sessions:get': return exactObject(x, ['sessionId']) && uuid(x.sessionId);
    case 'sessions:list': return exactObject(x, ['limit', ...(x && typeof x === 'object' && 'cursor' in x ? ['cursor'] : [])]) && integer(x.limit) && x.limit >= 1 && x.limit <= 100 && (!Object.hasOwn(x, 'cursor') || cursor(x.cursor));
    default: return false;
  }
}
/** Public session facts contain no process ID, paths or raw launch arguments. */
export function isSessionSnapshot(x: unknown): x is SessionSnapshot {
  return exactObject(x, ['sessionId', 'instanceId', 'state', 'revision', 'startedAt', ...(x && typeof x === 'object' && 'exitCode' in x ? ['exitCode'] : [])])
    && uuid(x.sessionId) && uuid(x.instanceId) && ['running', 'stopping', 'exited', 'unknown'].includes(x.state as string) && integer(x.revision) && x.revision > 0
    && typeof x.startedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x.startedAt) && Number.isFinite(Date.parse(x.startedAt))
    && (!Object.hasOwn(x, 'exitCode') || x.state === 'exited' && typeof x.exitCode === 'number' && Number.isSafeInteger(x.exitCode));
}
/** Strict correlated result including bounded session pagination and fixed errors. */
export function isGameData<C extends GameChannel>(x: unknown, channel: C): x is GameData[C] {
  if (channel === 'game:launch' || channel === 'game:stop') return exactObject(x, ['taskId']) && uuid(x.taskId);
  if (channel === 'sessions:get') return isSessionSnapshot(x);
  return channel === 'sessions:list' && exactObject(x, ['items', ...(x && typeof x === 'object' && 'nextCursor' in x ? ['nextCursor'] : [])]) && Array.isArray(x.items)
    && x.items.length <= 100 && x.items.every(isSessionSnapshot) && new Set(x.items.map(item => item.sessionId)).size === x.items.length && (!Object.hasOwn(x, 'nextCursor') || cursor(x.nextCursor));
}
export function gameFailure<C extends GameChannel>(requestId: string, code: InstanceCode, traceId: string): GameResult<C> {
  const result = instanceFailure(requestId, code, traceId); if (result.ok) throw new Error('INVALID_ERROR_RESULT'); return result;
}
export function isGameResult<C extends GameChannel>(x: unknown, requestId: string, channel: C): x is GameResult<C> {
  return exactObject(x, ['contractVersion', 'requestId', 'ok', x && typeof x === 'object' && 'ok' in x && x.ok === true ? 'data' : 'error']) && x.contractVersion === 1 && x.requestId === requestId
    && (x.ok === true ? isGameData(x.data, channel) : x.ok === false && isInstanceError(x.error));
}
