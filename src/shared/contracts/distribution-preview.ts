import { exactObject, UUID_PATTERN } from './handshake.js';
import type { ErrorCategory } from './handshake.js';
import type { MessageKey } from '../locales/messages.js';

export const DISTRIBUTION_CAPABILITY = 'distribution.preview.v1' as const;
export const DISTRIBUTION_CHANNELS = ['distribution:sources', 'distribution:preview', 'distribution:cancel'] as const;
export type DistributionChannel = typeof DISTRIBUTION_CHANNELS[number];
export interface DistributionQuery { rootId: string; instanceId: string; sourceId: string; packageId: string; packageVersion: string }
export const DISTRIBUTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export type ContentArea = 'mods' | 'resourcepacks' | 'config';
export type ContentOwnership = 'package-managed' | 'user-added' | 'local-discovered' | 'user-overridden' | 'ownership-conflict';
export interface DistributionSummary {
  sourceId: string; packageId: string; packageVersion: string; instanceId: string; revision: number; readOnly: true;
  receiptStatus: 'missing' | 'valid'; totalFiles: number; truncated: boolean;
  ownership: Array<{ area: ContentArea; path: string; ownership: ContentOwnership }>;
  changes: Array<{ area: ContentArea; path: string; kind: 'add' | 'replace' | 'remove' }>;
  conflicts: Array<{ area: ContentArea; path: string; code: 'EXISTS' | 'UNMANAGED' | 'CHANGED' }>;
}
export type DistributionPublicData = { sources: Array<{ sourceId: string }> } | { preview: DistributionSummary } | { cancelled: boolean };
export type DistributionPublicCode = 'INVALID_ARGUMENT' | 'INVALID_SENDER' | 'UNSUPPORTED_CONTRACT' | 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED' | 'REQUEST_CONFLICT'
  | 'SOURCE_UNAVAILABLE' | 'UNTRUSTED_DISTRIBUTION' | 'TARGET_MISMATCH' | 'FILES_CHANGED' | 'UNSAFE_FILES' | 'PREVIEW_LIMIT' | 'PREVIEW_BUSY';
export type DistributionResult = { contractVersion: 1; requestId: string; ok: true; data: DistributionPublicData }
  | { contractVersion: 1; requestId: string; ok: false; error: { category: ErrorCategory; code: DistributionPublicCode; messageKey: MessageKey; retryable: boolean; traceId: string } };
export interface DistributionBridge {
  distributionSources(): Promise<DistributionResult>;
  previewDistribution(requestId: string, query: DistributionQuery): Promise<DistributionResult>;
  cancelDistributionPreview(previewRequestId: string): Promise<DistributionResult>;
}
const KEYS: Record<DistributionPublicCode, MessageKey> = {
  INVALID_ARGUMENT: 'invalidArgument', INVALID_SENDER: 'invalidSender', UNSUPPORTED_CONTRACT: 'unsupportedContract', UNAVAILABLE: 'unavailable', TIMEOUT: 'timeout',
  CANCELLED: 'packCheckCancelled', REQUEST_CONFLICT: 'invalidArgument', SOURCE_UNAVAILABLE: 'distributionUnconfigured', UNTRUSTED_DISTRIBUTION: 'distributionUntrusted',
  TARGET_MISMATCH: 'distributionTargetMismatch', FILES_CHANGED: 'instanceChanged', UNSAFE_FILES: 'distributionUnsafe', PREVIEW_LIMIT: 'distributionLimit', PREVIEW_BUSY: 'distributionBusy',
};
/** Stable, redacted errors shared by main and preload. */
export function distributionFailure(id: string, code: DistributionPublicCode, traceId: string): DistributionResult {
  return { contractVersion: 1, requestId: id, ok: false, error: { category: code === 'CANCELLED' ? 'cancelled' : code === 'INVALID_SENDER' ? 'permission' : 'validation',
    code, messageKey: KEYS[code], retryable: ['UNAVAILABLE', 'TIMEOUT', 'CANCELLED', 'PREVIEW_BUSY', 'FILES_CHANGED'].includes(code), traceId } };
}
/** Identity-only query. Disk paths and public keys are never renderer-controlled. */
export function isDistributionQuery(value: unknown): value is DistributionQuery {
  return exactObject(value, ['rootId', 'instanceId', 'sourceId', 'packageId', 'packageVersion'])
    && [value.rootId, value.instanceId].every(id => typeof id === 'string' && UUID_PATTERN.test(id))
    && [value.sourceId, value.packageId, value.packageVersion].every(id => typeof id === 'string' && DISTRIBUTION_ID.test(id));
}
function location(value: Record<string, unknown>): boolean {
  return typeof value.area === 'string' && ['mods', 'resourcepacks', 'config'].includes(value.area) && typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 1024
    && !/[\\:]/.test(value.path) && !Array.from(value.path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && value.path.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}
/** Bounded public projection excludes raw manifests, signatures, URLs and absolute directories. */
export function isDistributionSummary(value: unknown): value is DistributionSummary {
  if (!exactObject(value, ['sourceId', 'packageId', 'packageVersion', 'instanceId', 'revision', 'readOnly', 'receiptStatus', 'totalFiles', 'truncated', 'ownership', 'changes', 'conflicts'])
    || ![value.sourceId, value.packageId, value.packageVersion].every(id => typeof id === 'string' && DISTRIBUTION_ID.test(id))
    || typeof value.instanceId !== 'string' || !UUID_PATTERN.test(value.instanceId) || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1
    || value.readOnly !== true || typeof value.receiptStatus !== 'string' || !['missing', 'valid'].includes(value.receiptStatus) || typeof value.totalFiles !== 'number' || !Number.isSafeInteger(value.totalFiles) || value.totalFiles < 0 || value.totalFiles > 4096
    || typeof value.truncated !== 'boolean' || !Array.isArray(value.ownership) || value.ownership.length > 200 || value.ownership.length !== Math.min(200, value.totalFiles)
    || value.truncated !== (value.totalFiles > 200) || !Array.isArray(value.changes) || value.changes.length > 256 || !Array.isArray(value.conflicts) || value.conflicts.length > 256) return false;
  return value.ownership.every(row => exactObject(row, ['area', 'path', 'ownership']) && location(row) && typeof row.ownership === 'string' && ['package-managed', 'user-added', 'local-discovered', 'user-overridden', 'ownership-conflict'].includes(row.ownership))
    && value.changes.every(row => exactObject(row, ['area', 'path', 'kind']) && location(row) && typeof row.kind === 'string' && ['add', 'replace', 'remove'].includes(row.kind))
    && value.conflicts.every(row => exactObject(row, ['area', 'path', 'code']) && location(row) && typeof row.code === 'string' && ['EXISTS', 'UNMANAGED', 'CHANGED'].includes(row.code))
    && (value.conflicts.length === 0 || value.changes.length === 0);
}
/** Strict per-operation response validation; a cancellation reply cannot impersonate a preview. */
export function isDistributionResult(value: unknown, id: string, channel: DistributionChannel): value is DistributionResult {
  if (!UUID_PATTERN.test(id) || !exactObject(value, value && typeof value === 'object' && 'ok' in value && value.ok === true
    ? ['contractVersion', 'requestId', 'ok', 'data'] : ['contractVersion', 'requestId', 'ok', 'error']) || value.contractVersion !== 1 || value.requestId !== id) return false;
  if (value.ok === true) {
    if (channel === 'distribution:preview') return exactObject(value.data, ['preview']) && isDistributionSummary(value.data.preview);
    if (channel === 'distribution:cancel') return exactObject(value.data, ['cancelled']) && typeof value.data.cancelled === 'boolean';
    return exactObject(value.data, ['sources']) && Array.isArray(value.data.sources) && value.data.sources.length <= 16
      && value.data.sources.every(source => exactObject(source, ['sourceId']) && typeof source.sourceId === 'string' && DISTRIBUTION_ID.test(source.sourceId))
      && new Set(value.data.sources.map(source => (source as { sourceId: string }).sourceId)).size === value.data.sources.length;
  }
  if (value.ok !== false || !exactObject(value.error, ['category', 'code', 'messageKey', 'retryable', 'traceId']) || typeof value.error.code !== 'string'
    || !Object.hasOwn(KEYS, value.error.code) || typeof value.error.traceId !== 'string' || !UUID_PATTERN.test(value.error.traceId)) return false;
  const expected = distributionFailure(id, value.error.code as DistributionPublicCode, value.error.traceId);
  return !expected.ok && value.error.category === expected.error.category && value.error.messageKey === expected.error.messageKey && value.error.retryable === expected.error.retryable;
}
