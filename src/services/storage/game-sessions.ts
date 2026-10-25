import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { StorageError } from './files.js';
import type { GameSession } from '../launch/process.js';

export const LAUNCH_ERRORS = ['LAUNCH_FAILED', 'JAVA_INCOMPATIBLE', 'AUTH_REQUIRED', 'DEPENDENCY_MISSING', 'MEMORY_OUT_OF_RANGE', 'INSTANCE_BUSY', 'REVISION_CONFLICT', 'NEEDS_RECOVERY', 'CANCELLED', 'STOP_UNSUPPORTED', 'CONFIRMATION_REQUIRED'] as const;
export type LaunchFailure = typeof LAUNCH_ERRORS[number];
export interface SavedSession { rootId: string; taskId: string; snapshot: GameSession; spawned: boolean; stopTaskIds: string[]; errors?: { taskId: string; code: LaunchFailure }[] }
export interface GameSessions { items: SavedSession[] }
const uuid = (x: unknown): x is string => typeof x === 'string' && UUID_PATTERN.test(x);
function invalid(): never { throw new StorageError('INVALID_RECORD'); }
/** Fixed session journal metadata only; process IDs, executable paths and credentials are never accepted. */
export function parseGameSessions(value: unknown): GameSessions {
  if (!exactObject(value, ['items']) || !Array.isArray(value.items) || value.items.length > 1000) invalid();
  const items = value.items.map((entry: unknown): SavedSession => {
    if (!exactObject(entry, ['rootId', 'taskId', 'snapshot', 'spawned', 'stopTaskIds', ...(entry && typeof entry === 'object' && 'errors' in entry ? ['errors'] : [])])
      || !uuid(entry.rootId) || !uuid(entry.taskId) || !Array.isArray(entry.stopTaskIds) || entry.stopTaskIds.length > 16 || !entry.stopTaskIds.every(uuid)
      || typeof entry.spawned !== 'boolean') invalid();
    const taskIds: string[] = [entry.taskId, ...entry.stopTaskIds];
    const errors = Object.hasOwn(entry, 'errors') ? (() => {
      if (!Array.isArray(entry.errors) || entry.errors.length > 17) invalid();
      const parsed = entry.errors.map((item: unknown) => {
        if (!exactObject(item, ['taskId', 'code']) || !uuid(item.taskId) || !taskIds.includes(item.taskId) || !LAUNCH_ERRORS.includes(item.code as LaunchFailure)) invalid();
        return { taskId: item.taskId, code: item.code as LaunchFailure };
      });
      if (new Set(parsed.map(item => item.taskId)).size !== parsed.length) invalid(); return parsed;
    })() : undefined;
    const snapshot = entry.snapshot;
    if (!exactObject(snapshot, ['sessionId', 'instanceId', 'state', 'revision', 'startedAt', ...(snapshot && typeof snapshot === 'object' && 'exitCode' in snapshot ? ['exitCode'] : [])])
      || snapshot.sessionId !== entry.taskId || !uuid(snapshot.instanceId) || !['running', 'stopping', 'exited', 'unknown'].includes(snapshot.state as string)
      || typeof snapshot.revision !== 'number' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
      || typeof snapshot.startedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(snapshot.startedAt) || !Number.isFinite(Date.parse(snapshot.startedAt))
      || Object.hasOwn(snapshot, 'exitCode') && (typeof snapshot.exitCode !== 'number' || !Number.isSafeInteger(snapshot.exitCode) || snapshot.state !== 'exited')) invalid();
    if (!entry.spawned && snapshot.state !== 'unknown') invalid();
    return { rootId: entry.rootId, taskId: entry.taskId, snapshot: snapshot as unknown as GameSession, spawned: entry.spawned, stopTaskIds: entry.stopTaskIds,
      ...(errors === undefined ? {} : { errors }) };
  });
  const ids = items.flatMap(item => [item.taskId, ...item.stopTaskIds]); if (new Set(ids).size !== ids.length) invalid();
  return { items };
}
