import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import { isModReport } from './mods-report.js';
import type { ModReport } from './mods-report.js';
import type { MessageKey } from '../locales/messages.js';
import { isResourcePayload, resourceFilename, resourceId } from './resources.js';
import type { ResourcePayloads } from './resources.js';

export const MODS_CAPABILITY = 'mods.v1' as const;
export const MOD_CHANNELS = ['mods:list', 'mods:check', 'mods:report', 'mods:plan', 'mods:planState', 'mods:cancelPlan'] as const;
export type ModChannel = typeof MOD_CHANNELS[number];
export const MOD_CODES = ['INVALID_ARGUMENT', 'UNSUPPORTED_CONTRACT', 'INVALID_SENDER', 'TIMEOUT', 'UNAVAILABLE', 'ROOT_UNAVAILABLE',
  'REVISION_CONFLICT', 'FILES_CHANGED', 'MOD_LIMIT', 'MODS_UNSAFE', 'SCAN_BUSY', 'CANCELLED', 'SCAN_FAILED', 'TASK_NOT_FOUND',
  'NEEDS_RECOVERY', 'CANCEL_TOO_LATE', 'NETWORK_FAILED', 'UNTRUSTED_METADATA', 'NOT_FOUND', 'RETRY_LATER', 'PLATFORM_LIMIT',
  'CONFIRMATION_REQUIRED', 'INSTANCE_BUSY', 'MODS_INCOMPATIBLE', 'MODS_UNDETERMINED'] as const;
export type ModCode = typeof MOD_CODES[number];
export interface ModError extends Omit<AppError, 'code'> { code: ModCode }
export interface ModPayloads {
  'mods:list': { instanceId: string; expectedRevision: number };
  'mods:check': { instanceId: string; expectedRevision: number };
  'mods:report': { taskId: string };
  'mods:plan': { instanceId: string; expectedRevision: number; root: ResourcePayloads['resources:download']; selections: Record<string, string> };
  'mods:planState': { planRequestId: string };
  'mods:cancelPlan': { planRequestId: string; planId: string };
}
export interface ModPlanIssue {
  severity: 'conflict' | 'unknown'; code: 'MISSING_CANDIDATE' | 'PIN_CONFLICT' | 'PROJECT_CONFLICT' | 'INSTALLED_CONFLICT'
    | 'INCOMPATIBLE' | 'UNRESOLVED_IDENTITY' | 'CYCLE' | 'DEPTH_LIMIT' | 'PROJECT_LIMIT' | 'UNKNOWN_INSTALLED'
    | 'TARGET_CONFLICT' | 'FILE_SELECTION' | 'SEARCH_LIMIT' | 'NO_SOLUTION';
  projectId: string | null; versionId: string | null; requiredBy: string[];
}
export interface ModPlanItem {
  projectId: string; versionId: string; filename: string; fileId: string; sha512: string; size: number;
  disposition: 'reuse' | 'library' | 'download'; requiredBy: string[];
}
export interface ModInstallPlan {
  formatVersion: 1; planId: string; instanceId: string; instanceRevision: number; fingerprint: string;
  minecraft: string; loader: 'fabric' | 'quilt' | 'forge' | 'neoforge'; rootVersionId: string;
  state: 'ready' | 'conflict' | 'unknown'; attempts: number; totalDownloadBytes: number; items: ModPlanItem[]; issues: ModPlanIssue[];
}
export interface ModData {
  'mods:list': { taskId: string };
  'mods:check': { taskId: string };
  'mods:report': { report: ModReport | null; errorCode: ModCode | null };
  'mods:plan': { plan: ModInstallPlan };
  'mods:planState': SavedModPlan;
  'mods:cancelPlan': SavedModPlan;
}
export interface SavedModPlan { plan: ModInstallPlan; status: 'preview' | 'cancelled' }
export type ModResult<C extends ModChannel = ModChannel> = { contractVersion: 1; requestId: string; ok: true; data: ModData[C] }
  | { contractVersion: 1; requestId: string; ok: false; error: ModError };
export interface ModDispatcher { <C extends ModChannel>(channel: C, input: ModPayloads[C], requestId: string): Promise<ModData[C]> }
export interface ModsBridge {
  listMods(requestId: string, input: ModPayloads['mods:list']): Promise<ModResult<'mods:list'>>;
  checkMods(requestId: string, input: ModPayloads['mods:check']): Promise<ModResult<'mods:check'>>;
  modReport(taskId: string): Promise<ModResult<'mods:report'>>;
  planMod(requestId: string, input: ModPayloads['mods:plan']): Promise<ModResult<'mods:plan'>>;
  getModPlan(planRequestId: string): Promise<ModResult<'mods:planState'>>;
  cancelModPlan(requestId: string, input: ModPayloads['mods:cancelPlan']): Promise<ModResult<'mods:cancelPlan'>>;
}
export class ModContractError extends Error { constructor(readonly code: ModCode) { super(code); this.name = 'ModContractError'; } }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const ids = (value: unknown, maximum: number): value is string[] => Array.isArray(value) && value.length <= maximum && value.every(resourceId);
function selections(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length > 256) return false;
  return Object.entries(value).every(([projectId, versionId]) => resourceId(projectId) && resourceId(versionId));
}
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
  PLATFORM_LIMIT: { category: 'biz', key: 'modsLimit', retryable: false },
  CONFIRMATION_REQUIRED: { category: 'permission', key: 'modsConfirmRequired', retryable: false },
  INSTANCE_BUSY: { category: 'biz', key: 'instanceBusy', retryable: true },
  MODS_INCOMPATIBLE: { category: 'validation', key: 'modsIncompatible', retryable: false },
  MODS_UNDETERMINED: { category: 'validation', key: 'modsUndetermined', retryable: false }
};
export function isModPayload<C extends ModChannel>(value: unknown, channel: C): value is ModPayloads[C] {
  if (channel === 'mods:report') return exactObject(value, ['taskId']) && uuid(value.taskId);
  if (channel === 'mods:planState') return exactObject(value, ['planRequestId']) && uuid(value.planRequestId);
  if (channel === 'mods:cancelPlan') return exactObject(value, ['planRequestId', 'planId']) && uuid(value.planRequestId)
    && typeof value.planId === 'string' && /^[a-f0-9]{64}$/.test(value.planId);
  if (channel === 'mods:plan') return exactObject(value, ['instanceId', 'expectedRevision', 'root', 'selections']) && uuid(value.instanceId)
    && integer(value.expectedRevision) && value.expectedRevision >= 1 && isResourcePayload(value.root, 'resources:download') && selections(value.selections);
  return (channel === 'mods:list' || channel === 'mods:check') && exactObject(value, ['instanceId', 'expectedRevision']) && uuid(value.instanceId)
    && typeof value.expectedRevision === 'number' && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 1;
}
const issueCodes: readonly string[] = ['MISSING_CANDIDATE', 'PIN_CONFLICT', 'PROJECT_CONFLICT', 'INSTALLED_CONFLICT', 'INCOMPATIBLE',
  'UNRESOLVED_IDENTITY', 'CYCLE', 'DEPTH_LIMIT', 'PROJECT_LIMIT', 'UNKNOWN_INSTALLED', 'TARGET_CONFLICT', 'FILE_SELECTION', 'SEARCH_LIMIT', 'NO_SOLUTION'];
export function isModInstallPlan(value: unknown): value is ModInstallPlan {
  if (!exactObject(value, ['formatVersion', 'planId', 'instanceId', 'instanceRevision', 'fingerprint', 'minecraft', 'loader', 'rootVersionId',
    'state', 'attempts', 'totalDownloadBytes', 'items', 'issues']) || value.formatVersion !== 1 || typeof value.planId !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.planId) || !uuid(value.instanceId) || !integer(value.instanceRevision) || value.instanceRevision < 1
    || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint) || typeof value.minecraft !== 'string'
    || value.minecraft.length < 1 || value.minecraft.length > 64 || !['fabric', 'quilt', 'forge', 'neoforge'].includes(value.loader as string)
    || !resourceId(value.rootVersionId) || !['ready', 'conflict', 'unknown'].includes(value.state as string) || !integer(value.attempts)
    || value.attempts > 4096 || !integer(value.totalDownloadBytes) || !Array.isArray(value.items) || value.items.length > 256
    || !Array.isArray(value.issues) || value.issues.length > 512) return false;
  if (!value.items.every(item => exactObject(item, ['projectId', 'versionId', 'filename', 'fileId', 'sha512', 'size', 'disposition', 'requiredBy'])
    && resourceId(item.projectId) && resourceId(item.versionId) && resourceFilename(item.filename) && typeof item.fileId === 'string'
    && /^[a-f0-9]{40}$/.test(item.fileId) && typeof item.sha512 === 'string' && /^[a-f0-9]{128}$/.test(item.sha512)
    && integer(item.size) && item.size >= 1 && item.size <= 1024 ** 3 && ['reuse', 'library', 'download'].includes(item.disposition as string)
    && ids(item.requiredBy, 256))) return false;
  return value.issues.every(issue => exactObject(issue, ['severity', 'code', 'projectId', 'versionId', 'requiredBy'])
    && (issue.severity === 'conflict' || issue.severity === 'unknown') && typeof issue.code === 'string' && issueCodes.includes(issue.code)
    && (issue.projectId === null || resourceId(issue.projectId)) && (issue.versionId === null || resourceId(issue.versionId)) && ids(issue.requiredBy, 256));
}
export function isModData<C extends ModChannel>(value: unknown, channel: C): value is ModData[C] {
  if (channel === 'mods:report') return exactObject(value, ['report', 'errorCode']) && (value.report === null || isModReport(value.report))
    && (value.errorCode === null || isModCode(value.errorCode)) && !(value.report !== null && value.errorCode !== null);
  if (channel === 'mods:plan') return exactObject(value, ['plan']) && isModInstallPlan(value.plan);
  if (channel === 'mods:planState' || channel === 'mods:cancelPlan') return exactObject(value, ['plan', 'status'])
    && isModInstallPlan(value.plan) && (value.status === 'cancelled' || channel === 'mods:planState' && value.status === 'preview');
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
