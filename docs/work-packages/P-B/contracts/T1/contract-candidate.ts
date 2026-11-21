// Review-only contract candidate. Not imported or registered by product code.
import { exactObject, UUID_PATTERN } from '../../../../../src/shared/contracts/handshake.js';
import { isInstanceError, isTaskSnapshot } from '../../../../../src/shared/contracts/instances.js';
import type { InstanceError, TaskSnapshot } from '../../../../../src/shared/contracts/instances.js';
export const TARGET_CAPABILITY = 'task-targets.v1';
export const TARGET_CHANNEL = 'task-targets:listForInstance';
export const TARGET_CODES = ['INVALID_ARGUMENT', 'UNSUPPORTED_CONTRACT', 'INVALID_SENDER', 'OUT_OF_SCOPE', 'ROOT_UNAVAILABLE',
  'TASK_STORE_UNAVAILABLE', 'NEEDS_RECOVERY', 'CURSOR_EXPIRED', 'TIMEOUT', 'UNAVAILABLE'] as const;
export type TargetKind = 'mod-check' | 'mod-install';
export type TargetCode = typeof TARGET_CODES[number];
export interface TargetError extends Omit<InstanceError, 'code'> { code: TargetCode }
export interface TargetQuery { instanceId: string; kinds: TargetKind[]; limit: number; cursor?: string }
export interface TargetRequest { contractVersion: 1; requestId: string; payload: TargetQuery }
export interface TargetRow { instanceId: string; instanceRevision: number; task: TaskSnapshot }
export type TargetResult = { contractVersion: 1; requestId: string; ok: true; data: { items: TargetRow[]; nextCursor?: string } }
  | { contractVersion: 1; requestId: string; ok: false; error: TargetError };
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const optional = (value: unknown, required: string[], extra: string): value is Record<string, unknown> => record(value)
  && exactObject(value, [...required, ...(Object.hasOwn(value, extra) ? [extra] : [])]);
export function isTargetQuery(value: unknown): value is TargetQuery {
  return optional(value, ['instanceId', 'kinds', 'limit'], 'cursor') && uuid(value.instanceId)
    && Array.isArray(value.kinds) && value.kinds.length >= 1 && value.kinds.length <= 2
    && value.kinds.every(kind => kind === 'mod-check' || kind === 'mod-install') && new Set(value.kinds).size === value.kinds.length
    && typeof value.limit === 'number' && Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= 100
    && (!Object.hasOwn(value, 'cursor') || uuid(value.cursor));
}
export function isTargetRequest(value: unknown): value is TargetRequest {
  return exactObject(value, ['contractVersion', 'requestId', 'payload']) && value.contractVersion === 1 && uuid(value.requestId) && isTargetQuery(value.payload);
}
export function isTargetResult(value: unknown, request: TargetRequest): value is TargetResult {
  if (!isTargetRequest(request)) return false;
  if (!record(value) || !exactObject(value, ['contractVersion', 'requestId', 'ok', value.ok === true ? 'data' : 'error'])
    || value.contractVersion !== 1 || value.requestId !== request.requestId) return false;
  if (value.ok === false) { const error = value.error; return isInstanceError(error) && TARGET_CODES.some(code => code === error.code); }
  if (value.ok !== true || !optional(value.data, ['items'], 'nextCursor') || !Array.isArray(value.data.items)
    || value.data.items.length > request.payload.limit || value.data.items.length > 100) return false;
  const ids = new Set<string>();
  for (const item of value.data.items) {
    if (!exactObject(item, ['instanceId', 'instanceRevision', 'task']) || !uuid(item.instanceId)
      || item.instanceId !== request.payload.instanceId.toLowerCase()
      || typeof item.instanceRevision !== 'number' || !Number.isSafeInteger(item.instanceRevision) || item.instanceRevision < 1
      || !isTaskSnapshot(item.task) || item.task.taskId !== item.task.taskId.toLowerCase()) return false;
    const task = item.task;
    if (!request.payload.kinds.some(kind => kind === task.kind) || ids.has(task.taskId)) return false;
    ids.add(item.task.taskId);
  }
  return (!Object.hasOwn(value.data, 'nextCursor') || value.data.items.length > 0 && uuid(value.data.nextCursor))
    && new TextEncoder().encode(JSON.stringify(value.data)).length <= 1024 * 1024;
}
/** Cursor filter identity ignores array order, but never changes its actual set. */
export function targetFilter(query: TargetQuery): string {
  return JSON.stringify({ instanceId: query.instanceId.toLowerCase(), kinds: [...query.kinds].sort() });
}
