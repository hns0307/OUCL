import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import { resourceId } from './resources.js';
import { validateComponent } from '../../core/path/layout.js';
import { isModCode, modFailure } from './mods.js';
import type { ModCode } from './mods.js';

export const MAINTENANCE_PREVIEW_CAPABILITY = 'mods-maintenance-preview.v1' as const;
export const MAINTENANCE_PREVIEW_CHANNELS = ['mods:maintenancePreview', 'mods:maintenancePreviewStatus', 'mods:maintenancePreviewCancel'] as const;
export type PreviewChannel = typeof MAINTENANCE_PREVIEW_CHANNELS[number];
export type PreviewCode = ModCode | 'PREVIEW_EXPIRED';
export type PreviewStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
export interface PreviewInput { rootId: string; instanceId: string; expectedRevision: number; expectedFingerprint: string; fileId: string; action: 'enable' | 'disable' }
export interface DisplayIssue { moment: 'before' | 'after'; scope: 'local' | 'platform'; severity: 'error' | 'unknown' | 'warning';
  code: string; fileId: string; modId: string | null; dependencyModId: string | null; dependencyProjectId: string | null;
  dependencyVersionId: string | null; requirement: string | null; actual: string[]; embeddedDepth: number }
export interface DisplayRelation { scope: 'local' | 'platform'; dependentFileId: string; providerFileId: string; optional: boolean;
  dependencyModId: string | null; dependencyProjectId: string | null; dependencyVersionId: string | null; embeddedDepth: number }
export interface DisplayProvider { id: string; ownerId: string; version: string | null; embeddedDepth: number }
export interface MaintenanceDisplay { rootId: string; instanceId: string; instanceRevision: number; fingerprint: string; fileId: string;
  filename: string; sha256: string | null; action: 'enable' | 'disable'; state: 'ready' | 'blocked' | 'unknown';
  providers: DisplayProvider[]; directRequiredBy: string[]; transitiveRequiredBy: string[]; issues: DisplayIssue[];
  relations: DisplayRelation[]; platformFailures: string[]; incomplete: boolean }
export interface PreviewSnapshot { previewId: string; status: PreviewStatus; result: MaintenanceDisplay | null; errorCode: PreviewCode | null }
export interface PreviewPayloads { 'mods:maintenancePreview': PreviewInput; 'mods:maintenancePreviewStatus': { previewId: string }; 'mods:maintenancePreviewCancel': { previewId: string } }
export interface PreviewData { 'mods:maintenancePreview': { previewId: string }; 'mods:maintenancePreviewStatus': PreviewSnapshot;
  'mods:maintenancePreviewCancel': { previewId: string; status: PreviewStatus } }
export type PreviewResult<C extends PreviewChannel> = { contractVersion: 1; requestId: string; ok: true; data: PreviewData[C] }
  | { contractVersion: 1; requestId: string; ok: false; error: Omit<AppError, 'code'> & { code: PreviewCode } };
export interface MaintenancePreviewBridge { maintenancePreview(requestId: string, input: PreviewInput): Promise<PreviewResult<'mods:maintenancePreview'>>;
  maintenancePreviewStatus(previewId: string): Promise<PreviewResult<'mods:maintenancePreviewStatus'>>;
  maintenancePreviewCancel(previewId: string): Promise<PreviewResult<'mods:maintenancePreviewCancel'>> }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const modId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_-]{1,63}$/.test(value);
const code = (value: unknown): value is string => typeof value === 'string' && /^[A-Z_]{1,64}$/.test(value);
const safe = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9 .+_*,<>=!|()[\]{}":-]+$/.test(value);
const nullable = (value: unknown, check: (v: unknown) => boolean): boolean => value === null || check(value);
const depth = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
const status = (value: unknown): value is PreviewStatus => typeof value === 'string' && ['queued', 'running', 'completed', 'cancelled', 'failed'].includes(value);
const previewCode = (value: unknown): value is PreviewCode => value === 'PREVIEW_EXPIRED' || isModCode(value);

export function isPreviewPayload<C extends PreviewChannel>(value: unknown, channel: C): value is PreviewPayloads[C] {
  if (channel !== 'mods:maintenancePreview') return exactObject(value, ['previewId']) && uuid(value.previewId);
  return exactObject(value, ['rootId', 'instanceId', 'expectedRevision', 'expectedFingerprint', 'fileId', 'action'])
    && uuid(value.rootId) && uuid(value.instanceId) && typeof value.expectedRevision === 'number' && Number.isSafeInteger(value.expectedRevision)
    && value.expectedRevision >= 1 && hash(value.expectedFingerprint) && hash(value.fileId) && (value.action === 'enable' || value.action === 'disable');
}
/** Exact, bounded and path/URL-free public result validation on both sides of the bridge. */
export function isMaintenanceDisplay(value: unknown): value is MaintenanceDisplay {
  if (!exactObject(value, ['rootId', 'instanceId', 'instanceRevision', 'fingerprint', 'fileId', 'filename', 'sha256', 'action', 'state', 'providers',
    'directRequiredBy', 'transitiveRequiredBy', 'issues', 'relations', 'platformFailures', 'incomplete']) || !uuid(value.rootId) || !uuid(value.instanceId)
    || typeof value.instanceRevision !== 'number' || !Number.isSafeInteger(value.instanceRevision) || value.instanceRevision < 1
    || !hash(value.fingerprint) || !hash(value.fileId) || typeof value.filename !== 'string' || !/\.jar(?:\.disabled)?$/i.test(value.filename)
    || !nullable(value.sha256, hash) || value.action !== 'enable' && value.action !== 'disable'
    || !['ready', 'blocked', 'unknown'].includes(value.state as string) || typeof value.incomplete !== 'boolean') return false;
  try { validateComponent(value.filename); } catch { return false; }
  if ((value.action === 'enable') !== value.filename.toLowerCase().endsWith('.disabled')) return false;
  const lists = [value.providers, value.directRequiredBy, value.transitiveRequiredBy, value.issues, value.relations, value.platformFailures];
  if (!lists.every(Array.isArray) || lists.reduce<number>((sum, list) => sum + (list as unknown[]).length, 0) > 512) return false;
  if (!(value.providers as unknown[]).every(item => exactObject(item, ['id', 'ownerId', 'version', 'embeddedDepth']) && modId(item.id) && modId(item.ownerId)
    && nullable(item.version, v => safe(v, 160)) && depth(item.embeddedDepth))) return false;
  if (!(value.directRequiredBy as unknown[]).every(hash) || !(value.transitiveRequiredBy as unknown[]).every(hash)
    || !(value.platformFailures as unknown[]).every(code)) return false;
  if (!(value.issues as unknown[]).every(item => exactObject(item, ['moment', 'scope', 'severity', 'code', 'fileId', 'modId', 'dependencyModId',
    'dependencyProjectId', 'dependencyVersionId', 'requirement', 'actual', 'embeddedDepth']) && ['before', 'after'].includes(item.moment as string)
    && ['local', 'platform'].includes(item.scope as string) && ['error', 'unknown', 'warning'].includes(item.severity as string) && code(item.code)
    && (item.fileId === '' || hash(item.fileId)) && nullable(item.modId, modId) && nullable(item.dependencyModId, modId)
    && nullable(item.dependencyProjectId, resourceId) && nullable(item.dependencyVersionId, resourceId) && nullable(item.requirement, v => safe(v, 2048))
    && Array.isArray(item.actual) && item.actual.length <= 16 && item.actual.every(v => safe(v, 160)) && depth(item.embeddedDepth)
    && (item.scope === 'local' ? item.dependencyProjectId === null && item.dependencyVersionId === null
      : item.modId === null && item.dependencyModId === null && item.requirement === null && item.actual.length === 0 && item.embeddedDepth === 0))) return false;
  if (!(value.relations as unknown[]).every(item => exactObject(item, ['scope', 'dependentFileId', 'providerFileId', 'optional', 'dependencyModId',
    'dependencyProjectId', 'dependencyVersionId', 'embeddedDepth']) && ['local', 'platform'].includes(item.scope as string)
    && hash(item.dependentFileId) && hash(item.providerFileId) && typeof item.optional === 'boolean' && nullable(item.dependencyModId, modId)
    && nullable(item.dependencyProjectId, resourceId) && nullable(item.dependencyVersionId, resourceId) && depth(item.embeddedDepth)
    && (item.scope === 'local' ? item.dependencyModId !== null && item.dependencyProjectId === null && item.dependencyVersionId === null
      : item.dependencyModId === null && (item.dependencyProjectId !== null || item.dependencyVersionId !== null) && item.embeddedDepth === 0))) return false;
  if (value.state === 'ready' && (value.incomplete || (value.platformFailures as unknown[]).length
    || (value.issues as DisplayIssue[]).some(issue => issue.severity !== 'warning'))) return false;
  return new TextEncoder().encode(JSON.stringify(value)).length <= 2 * 1024 ** 2;
}
export function isPreviewData<C extends PreviewChannel>(value: unknown, channel: C): value is PreviewData[C] {
  if (channel === 'mods:maintenancePreview') return exactObject(value, ['previewId']) && uuid(value.previewId);
  if (channel === 'mods:maintenancePreviewCancel') return exactObject(value, ['previewId', 'status']) && uuid(value.previewId) && status(value.status);
  if (!exactObject(value, ['previewId', 'status', 'result', 'errorCode']) || !uuid(value.previewId) || !status(value.status)) return false;
  return value.status === 'completed' ? isMaintenanceDisplay(value.result) && value.errorCode === null
    : value.status === 'failed' ? value.result === null && previewCode(value.errorCode) : value.result === null && value.errorCode === null;
}
export function previewFailure<C extends PreviewChannel>(requestId: string, errorCode: PreviewCode, traceId: string): PreviewResult<C> {
  if (errorCode !== 'PREVIEW_EXPIRED') {
    const failure = modFailure(requestId, errorCode, traceId);
    if (!failure.ok) return { contractVersion: 1, requestId, ok: false, error: failure.error };
    throw new Error('INVALID_PREVIEW_FAILURE');
  }
  return { contractVersion: 1, requestId, ok: false, error: { code: errorCode, category: 'biz', messageKey: 'modsTaskMissing', retryable: false, traceId } };
}
export function isPreviewResult<C extends PreviewChannel>(value: unknown, requestId: string, channel: C): value is PreviewResult<C> {
  if (!exactObject(value, ['contractVersion', 'requestId', 'ok', value && typeof value === 'object' && 'ok' in value && value.ok === true ? 'data' : 'error'])
    || value.contractVersion !== 1 || value.requestId !== requestId) return false;
  if (value.ok === true) return isPreviewData(value.data, channel);
  if (value.ok !== false || !exactObject(value.error, ['code', 'category', 'messageKey', 'retryable', 'traceId']) || !previewCode(value.error.code) || !uuid(value.error.traceId)) return false;
  const expected = previewFailure(requestId, value.error.code, value.error.traceId);
  return !expected.ok && value.error.category === expected.error.category && value.error.messageKey === expected.error.messageKey
    && value.error.retryable === expected.error.retryable;
}
