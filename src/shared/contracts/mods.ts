import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import { isModReport } from './mods-report.js';
import type { ModReport } from './mods-report.js';
import type { MessageKey } from '../locales/messages.js';

export const MODS_CAPABILITY = 'mods.v1' as const;
export const MOD_CHANNELS = ['mods:list', 'mods:check', 'mods:report'] as const;
export type ModChannel = typeof MOD_CHANNELS[number];
export const MOD_CODES = ['INVALID_ARGUMENT', 'UNSUPPORTED_CONTRACT', 'INVALID_SENDER', 'TIMEOUT', 'UNAVAILABLE', 'ROOT_UNAVAILABLE',
  'REVISION_CONFLICT', 'FILES_CHANGED', 'MOD_LIMIT', 'MODS_UNSAFE', 'SCAN_BUSY', 'CANCELLED', 'SCAN_FAILED', 'TASK_NOT_FOUND',
  'NEEDS_RECOVERY', 'CANCEL_TOO_LATE', 'NETWORK_FAILED', 'UNTRUSTED_METADATA', 'NOT_FOUND', 'RETRY_LATER', 'PLATFORM_LIMIT'] as const;
export type ModCode = typeof MOD_CODES[number];
export interface ModError extends Omit<AppError, 'code'> { code: ModCode }
export interface ModPayloads {
  'mods:list': { instanceId: string; expectedRevision: number };
  'mods:check': { instanceId: string; expectedRevision: number };
  'mods:report': { taskId: string };
}
export interface ModData {
  'mods:list': { taskId: string };
  'mods:check': { taskId: string };
  'mods:report': { report: ModReport | null; errorCode: ModCode | null };
}
export type ModResult<C extends ModChannel = ModChannel> = { contractVersion: 1; requestId: string; ok: true; data: ModData[C] }
  | { contractVersion: 1; requestId: string; ok: false; error: ModError };
export interface ModDispatcher { <C extends ModChannel>(channel: C, input: ModPayloads[C], requestId: string): Promise<ModData[C]> }
export interface ModsBridge {
  listMods(requestId: string, input: ModPayloads['mods:list']): Promise<ModResult<'mods:list'>>;
  checkMods(requestId: string, input: ModPayloads['mods:check']): Promise<ModResult<'mods:check'>>;
  modReport(taskId: string): Promise<ModResult<'mods:report'>>;
}
export class ModContractError extends Error { constructor(readonly code: ModCode) { super(code); this.name = 'ModContractError'; } }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
export const isModCode = (value: unknown): value is ModCode => typeof value === 'string' && MOD_CODES.includes(value as ModCode);
const ERRORS: Record<ModCode, { category: AppError['category']; key: MessageKey; retryable: boolean }> = {
  INVALID_ARGUMENT: { category: 'validation', key: 'invalidArgument', retryable: false },
  UNSUPPORTED_CONTRACT: { category: 'validation', key: 'unsupportedContract', retryable: false },
  INVALID_SENDER: { category: 'permission', key: 'invalidSender', retryable: false },
  TIMEOUT: { category: 'system', key: 'timeout', retryable: true }, UNAVAILABLE: { category: 'system', key: 'unavailable', retryable: true },
  ROOT_UNAVAILABLE: { category: 'disk', key: 'rootUnavailable', retryable: true },
  REVISION_CONFLICT: { category: 'biz', key: 'instanceChanged', retryable: true }, FILES_CHANGED: { category: 'biz', key: 'modsChanged', retryable: true },
  MOD_LIMIT: { category: 'biz', key: 'modsLimit', retryable: false }, MODS_UNSAFE: { category: 'validation', key: 'modsUnsafe', retryable: false },
  SCAN_BUSY: { category: 'biz', key: 'modsBusy', retryable: true }, CANCELLED: { category: 'cancelled', key: 'modsCancelled', retryable: true },
  SCAN_FAILED: { category: 'disk', key: 'modsScanFailed', retryable: true }, TASK_NOT_FOUND: { category: 'biz', key: 'modsTaskMissing', retryable: false },
  NEEDS_RECOVERY: { category: 'disk', key: 'unavailable', retryable: false }, CANCEL_TOO_LATE: { category: 'biz', key: 'unavailable', retryable: false },
  NETWORK_FAILED: { category: 'network', key: 'resourceNetworkFailed', retryable: true }, UNTRUSTED_METADATA: { category: 'validation', key: 'untrustedManifest', retryable: false },
  NOT_FOUND: { category: 'network', key: 'resourceNetworkFailed', retryable: true }, RETRY_LATER: { category: 'network', key: 'resourceRateLimited', retryable: true },
  PLATFORM_LIMIT: { category: 'biz', key: 'modsLimit', retryable: false }
};
export function isModPayload<C extends ModChannel>(value: unknown, channel: C): value is ModPayloads[C] {
  if (channel === 'mods:report') return exactObject(value, ['taskId']) && uuid(value.taskId);
  return (channel === 'mods:list' || channel === 'mods:check') && exactObject(value, ['instanceId', 'expectedRevision']) && uuid(value.instanceId)
    && typeof value.expectedRevision === 'number' && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 1;
}
export function isModData<C extends ModChannel>(value: unknown, channel: C): value is ModData[C] {
  if (channel === 'mods:report') return exactObject(value, ['report', 'errorCode']) && (value.report === null || isModReport(value.report))
    && (value.errorCode === null || isModCode(value.errorCode)) && !(value.report !== null && value.errorCode !== null);
  return (channel === 'mods:list' || channel === 'mods:check') && exactObject(value, ['taskId']) && uuid(value.taskId);
}
export function modFailure<C extends ModChannel>(requestId: string, code: ModCode, traceId: string): ModResult<C> {
  const expected = ERRORS[code]; return { contractVersion: 1, requestId, ok: false, error: { code, category: expected.category,
    messageKey: expected.key, retryable: expected.retryable, traceId } };
}
export function isModResult<C extends ModChannel>(value: unknown, requestId: string, channel: C): value is ModResult<C> {
  if (!exactObject(value, ['contractVersion', 'requestId', 'ok', value && typeof value === 'object' && 'ok' in value && value.ok === true ? 'data' : 'error'])
    || value.contractVersion !== 1 || value.requestId !== requestId) return false;
  if (value.ok === true) return isModData(value.data, channel);
  if (value.ok !== false || !exactObject(value.error, ['code', 'category', 'messageKey', 'retryable', 'traceId']) || !isModCode(value.error.code) || !uuid(value.error.traceId)) return false;
  const expected = ERRORS[value.error.code];
  return value.error.category === expected.category && value.error.messageKey === expected.key && value.error.retryable === expected.retryable;
}
