import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';

export const INSTANCE_FOLDER_CHANNEL = 'instances:open-folder' as const;
export const INSTANCE_FOLDERS_CAPABILITY = 'instance-folders.v1' as const;
export const INSTANCE_FOLDER_KINDS = ['game', 'mods', 'saves', 'resourcepacks', 'shaderpacks', 'screenshots', 'logs'] as const;
export type InstanceFolderKind = typeof INSTANCE_FOLDER_KINDS[number];
export type InstanceFolderCode = AppError['code'] | 'ROOT_UNAVAILABLE' | 'INSTANCE_NOT_FOUND' | 'NEEDS_RECOVERY' | 'PERMISSION_DENIED';
export type InstanceFolderResult = { contractVersion: 1; requestId: string; ok: true; data: { opened: true } }
  | { contractVersion: 1; requestId: string; ok: false; error: Omit<AppError, 'code'> & { code: InstanceFolderCode } };
export interface InstanceFoldersBridge { openInstanceFolder(instanceId: string, folder: InstanceFolderKind): Promise<InstanceFolderResult> }
const ERRORS: Record<InstanceFolderCode, { category: AppError['category']; key: MessageKey; retryable: boolean }> = {
  INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument', retryable: false }, UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract', retryable: false },
  INVALID_SENDER: { category: 'permission', key: 'invalidSender', retryable: false }, TIMEOUT: { category: 'system', key: 'timeout', retryable: true },
  UNAVAILABLE: { category: 'system', key: 'unavailable', retryable: true }, ROOT_UNAVAILABLE: { category: 'disk', key: 'rootUnavailable', retryable: true },
  INSTANCE_NOT_FOUND: { category: 'biz', key: 'unavailable', retryable: false }, NEEDS_RECOVERY: { category: 'disk', key: 'stageRecovery', retryable: false },
  PERMISSION_DENIED: { category: 'permission', key: 'permissionDenied', retryable: true },
};
export function isInstanceFolderRequest(value: unknown): value is { contractVersion: 1; requestId: string; payload: { instanceId: string; folder: InstanceFolderKind } } {
  return exactObject(value, ['contractVersion', 'requestId', 'payload']) && value.contractVersion === 1 && typeof value.requestId === 'string' && UUID_PATTERN.test(value.requestId)
    && exactObject(value.payload, ['instanceId', 'folder']) && typeof value.payload.instanceId === 'string' && UUID_PATTERN.test(value.payload.instanceId)
    && typeof value.payload.folder === 'string' && (INSTANCE_FOLDER_KINDS as readonly string[]).includes(value.payload.folder);
}
export function instanceFolderFailure(requestId: string, code: InstanceFolderCode, traceId: string): InstanceFolderResult {
  const item = ERRORS[code]; return { contractVersion: 1, requestId, ok: false, error: { code, category: item.category, messageKey: item.key, retryable: item.retryable, traceId } };
}
export function isInstanceFolderResult(value: unknown, requestId: string): value is InstanceFolderResult {
  if (!exactObject(value, ['contractVersion', 'requestId', 'ok', typeof value === 'object' && value !== null && 'ok' in value && value.ok === true ? 'data' : 'error'])
    || value.contractVersion !== 1 || value.requestId !== requestId) return false;
  if (value.ok === true) return exactObject(value.data, ['opened']) && value.data.opened === true;
  if (value.ok !== false || !exactObject(value.error, ['code', 'category', 'messageKey', 'retryable', 'traceId']) || typeof value.error.code !== 'string'
    || !Object.hasOwn(ERRORS, value.error.code) || typeof value.error.traceId !== 'string' || !UUID_PATTERN.test(value.error.traceId)) return false;
  const item = ERRORS[value.error.code as InstanceFolderCode]; return value.error.category === item.category && value.error.messageKey === item.key && value.error.retryable === item.retryable;
}
