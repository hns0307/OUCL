import { exactObject, UUID_PATTERN } from './handshake.js';
import type { AppError } from './handshake.js';
import { isTaskSnapshot } from './instances.js';
import type { TaskSnapshot } from './instances.js';
import { DISTRIBUTION_ID } from './distribution-preview.js';
import type { ContentArea, DistributionQuery } from './distribution-preview.js';

export const DISTRIBUTION_EXECUTION_CAPABILITY = 'distribution.execute.v1' as const;
export const DISTRIBUTION_EXECUTION_CHANNELS = ['distribution:prepareExecution', 'distribution:executionPreparation',
  'distribution:cancelExecutionPreparation', 'distribution:confirmExecution', 'distribution:recoverExecution'] as const;
export const DISTRIBUTION_EXECUTION_IPC_TIMEOUT_MS = 3000;
export const DISTRIBUTION_EXECUTION_PREPARE_TIMEOUT_MS = 120000;
export const DISTRIBUTION_EXECUTION_PROPOSAL_TTL_MS = 300000;
export const DISTRIBUTION_EXECUTION_MAX_ACTIVE = 16;
export const DISTRIBUTION_EXECUTION_MAX_SEEN = 1024;
export const DISTRIBUTION_EXECUTION_MAX_OPERATIONS = 256;
export const DISTRIBUTION_EXECUTION_MAX_PATH = 1024;
export const DISTRIBUTION_EXECUTION_MAX_RESPONSE_BYTES = 1024 * 1024;
export type DistributionExecutionChannel = typeof DISTRIBUTION_EXECUTION_CHANNELS[number];
export type DistributionExecutionBinding = DistributionQuery;
export interface DistributionExecutionProposal extends DistributionExecutionBinding {
  proposalId: string; sequence: number; instanceRevision: number; expiresAt: number;
  changes: Array<{ area: ContentArea; path: string; kind: 'add' | 'replace' | 'remove' }>;
  conflicts: Array<{ area: ContentArea; path: string; code: 'EXISTS' | 'UNMANAGED' | 'CHANGED' }>;
}
export const DISTRIBUTION_EXECUTION_CODES = ['INVALID_ARGUMENT', 'INVALID_SENDER', 'UNSUPPORTED_CONTRACT', 'TIMEOUT', 'UNAVAILABLE',
  'SOURCE_UNAVAILABLE', 'UNTRUSTED_DISTRIBUTION', 'RELEASE_EXPIRED', 'RELEASE_DOWNGRADE', 'RELEASE_EQUIVOCATION', 'PROPOSAL_EXPIRED',
  'REQUEST_CONFLICT', 'CAPACITY_EXCEEDED', 'FILES_CHANGED', 'INSTANCE_BUSY', 'CANCELLED', 'CANCEL_TOO_LATE', 'NEEDS_RECOVERY'] as const;
export type DistributionExecutionCode = typeof DISTRIBUTION_EXECUTION_CODES[number];
export interface DistributionExecutionError extends Omit<AppError, 'code'> { code: DistributionExecutionCode }
export type DistributionExecutionPreparation = { prepareRequestId: string } & (
  | { state: 'ready'; proposal: DistributionExecutionProposal; error: null }
  | { state: 'failed'; proposal: null; error: DistributionExecutionError }
  | { state: 'pending' | 'cancelled' | 'expired'; proposal: null; error: null });
export interface DistributionExecutionAccepted { taskId: string; proposalId: string; snapshot: TaskSnapshot }
export interface DistributionExecutionRecovery { taskId: string; recoveryRequestId: string; snapshot: TaskSnapshot }
export interface DistributionExecutionPayloads {
  'distribution:prepareExecution': DistributionExecutionBinding;
  'distribution:executionPreparation': { prepareRequestId: string };
  'distribution:cancelExecutionPreparation': { prepareRequestId: string };
  'distribution:confirmExecution': { proposalId: string; instanceRevision: number; sequence: number };
  'distribution:recoverExecution': { taskId: string };
}
export interface DistributionExecutionData {
  'distribution:prepareExecution': DistributionExecutionPreparation;
  'distribution:executionPreparation': DistributionExecutionPreparation;
  'distribution:cancelExecutionPreparation': { cancelled: boolean };
  'distribution:confirmExecution': DistributionExecutionAccepted;
  'distribution:recoverExecution': DistributionExecutionRecovery;
}
export interface DistributionExecutionRequest<C extends DistributionExecutionChannel = DistributionExecutionChannel> {
  contractVersion: 1; requestId: string; payload: DistributionExecutionPayloads[C];
}
export type DistributionExecutionResult<C extends DistributionExecutionChannel = DistributionExecutionChannel> =
  { contractVersion: 1; requestId: string; ok: true; data: DistributionExecutionData[C] }
  | { contractVersion: 1; requestId: string; ok: false; error: DistributionExecutionError };
export interface DistributionExecutionBridge {
  prepareDistributionExecution(requestId: string, input: DistributionExecutionBinding): Promise<DistributionExecutionResult<'distribution:prepareExecution'>>;
  getDistributionExecutionPreparation(prepareRequestId: string): Promise<DistributionExecutionResult<'distribution:executionPreparation'>>;
  cancelDistributionExecutionPreparation(prepareRequestId: string): Promise<DistributionExecutionResult<'distribution:cancelExecutionPreparation'>>;
  confirmDistributionExecution(requestId: string, input: DistributionExecutionPayloads['distribution:confirmExecution']): Promise<DistributionExecutionResult<'distribution:confirmExecution'>>;
  recoverDistributionExecution(requestId: string, taskId: string): Promise<DistributionExecutionResult<'distribution:recoverExecution'>>;
}
type ErrorSpec = Pick<AppError, 'category' | 'messageKey' | 'retryable'>;
const ERRORS: Record<DistributionExecutionCode, ErrorSpec> = {
  INVALID_ARGUMENT: { category: 'validation', messageKey: 'invalidArgument', retryable: false },
  INVALID_SENDER: { category: 'permission', messageKey: 'invalidSender', retryable: false },
  UNSUPPORTED_CONTRACT: { category: 'validation', messageKey: 'unsupportedContract', retryable: false },
  TIMEOUT: { category: 'system', messageKey: 'timeout', retryable: true },
  UNAVAILABLE: { category: 'system', messageKey: 'unavailable', retryable: true },
  SOURCE_UNAVAILABLE: { category: 'biz', messageKey: 'distributionUnconfigured', retryable: false },
  UNTRUSTED_DISTRIBUTION: { category: 'permission', messageKey: 'distributionUntrusted', retryable: false },
  RELEASE_EXPIRED: { category: 'validation', messageKey: 'unavailable', retryable: false },
  RELEASE_DOWNGRADE: { category: 'validation', messageKey: 'distributionUntrusted', retryable: false },
  RELEASE_EQUIVOCATION: { category: 'validation', messageKey: 'distributionUntrusted', retryable: false },
  PROPOSAL_EXPIRED: { category: 'biz', messageKey: 'unavailable', retryable: false },
  REQUEST_CONFLICT: { category: 'validation', messageKey: 'invalidArgument', retryable: false },
  CAPACITY_EXCEEDED: { category: 'biz', messageKey: 'distributionLimit', retryable: false },
  FILES_CHANGED: { category: 'biz', messageKey: 'instanceChanged', retryable: true },
  INSTANCE_BUSY: { category: 'biz', messageKey: 'distributionBusy', retryable: true },
  CANCELLED: { category: 'cancelled', messageKey: 'packCheckCancelled', retryable: true },
  CANCEL_TOO_LATE: { category: 'biz', messageKey: 'unavailable', retryable: false },
  NEEDS_RECOVERY: { category: 'disk', messageKey: 'unavailable', retryable: false },
};
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase();
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function bounded(value: unknown): boolean {
  try { const body = JSON.stringify(value); return typeof body === 'string' && new TextEncoder().encode(body).length <= DISTRIBUTION_EXECUTION_MAX_RESPONSE_BYTES; }
  catch { return false; }
}
/** Error codes have one fixed redacted category/message/retry mapping; no upstream detail field exists. */
export function distributionExecutionFailure<C extends DistributionExecutionChannel>(requestId: string, code: DistributionExecutionCode, traceId: string): DistributionExecutionResult<C> {
  return { contractVersion: 1, requestId, ok: false, error: { ...ERRORS[code], code, traceId } };
}
export function isDistributionExecutionError(value: unknown): value is DistributionExecutionError {
  if (!exactObject(value, ['category', 'code', 'messageKey', 'retryable', 'traceId']) || typeof value.code !== 'string' || !Object.hasOwn(ERRORS, value.code) || !uuid(value.traceId)) return false;
  const spec = ERRORS[value.code as DistributionExecutionCode];
  return value.category === spec.category && value.messageKey === spec.messageKey && value.retryable === spec.retryable;
}
export function isDistributionExecutionBinding(value: unknown): value is DistributionExecutionBinding {
  return exactObject(value, ['rootId', 'instanceId', 'sourceId', 'packageId', 'packageVersion']) && uuid(value.rootId) && uuid(value.instanceId)
    && [value.sourceId, value.packageId, value.packageVersion].every(id => typeof id === 'string' && DISTRIBUTION_ID.test(id));
}
function relativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= DISTRIBUTION_EXECUTION_MAX_PATH
    && !/[<>:"\\|?*]/.test(value) && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && value.split('/').every(part => part.length > 0 && part.length <= 255 && part !== '.' && part !== '..' && !/[. ]$/.test(part)
      && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}
function location(value: Record<string, unknown>): boolean {
  return typeof value.area === 'string' && ['mods', 'resourcepacks', 'config'].includes(value.area) && relativePath(value.path);
}
/** No raw manifest, key, root directory or journal may enter this bounded public proposal. */
export function isDistributionExecutionProposal(value: unknown): value is DistributionExecutionProposal {
  if (!exactObject(value, ['rootId', 'instanceId', 'sourceId', 'packageId', 'packageVersion', 'proposalId', 'sequence', 'instanceRevision', 'expiresAt', 'changes', 'conflicts'])
    || !isDistributionExecutionBinding({ rootId: value.rootId, instanceId: value.instanceId, sourceId: value.sourceId, packageId: value.packageId, packageVersion: value.packageVersion })
    || !uuid(value.proposalId) || !positive(value.sequence) || !positive(value.instanceRevision) || !positive(value.expiresAt)
    || !Array.isArray(value.changes) || !Array.isArray(value.conflicts) || value.changes.length + value.conflicts.length > DISTRIBUTION_EXECUTION_MAX_OPERATIONS
    || value.changes.length > 0 && value.conflicts.length > 0) return false;
  if (!value.changes.every(row => exactObject(row, ['area', 'path', 'kind']) && location(row) && typeof row.kind === 'string' && ['add', 'replace', 'remove'].includes(row.kind)
    && !(row.area === 'config' && row.kind !== 'add'))
    || !value.conflicts.every(row => exactObject(row, ['area', 'path', 'code']) && location(row) && typeof row.code === 'string' && ['EXISTS', 'UNMANAGED', 'CHANGED'].includes(row.code))) return false;
  const paths: string[] = [];
  for (const row of [...value.changes, ...value.conflicts] as Array<{ area: string; path: string }>) {
    const path = `${row.area}/${row.path}`.toLowerCase();
    if (paths.some(old => old === path || old.startsWith(path + '/') || path.startsWith(old + '/'))) return false; paths.push(path);
  }
  return bounded(value);
}
export function isDistributionExecutionPreparation(value: unknown): value is DistributionExecutionPreparation {
  if (!exactObject(value, ['prepareRequestId', 'state', 'proposal', 'error']) || !uuid(value.prepareRequestId)) return false;
  if (value.state === 'ready') return value.error === null && isDistributionExecutionProposal(value.proposal);
  if (value.state === 'failed') return value.proposal === null && isDistributionExecutionError(value.error);
  return typeof value.state === 'string' && ['pending', 'cancelled', 'expired'].includes(value.state) && value.proposal === null && value.error === null;
}
export function isDistributionExecutionPayload<C extends DistributionExecutionChannel>(value: unknown, channel: C): value is DistributionExecutionPayloads[C] {
  switch (channel) {
    case 'distribution:prepareExecution': return isDistributionExecutionBinding(value);
    case 'distribution:executionPreparation': case 'distribution:cancelExecutionPreparation': return exactObject(value, ['prepareRequestId']) && uuid(value.prepareRequestId);
    case 'distribution:confirmExecution': return exactObject(value, ['proposalId', 'instanceRevision', 'sequence']) && uuid(value.proposalId) && positive(value.instanceRevision) && positive(value.sequence);
    case 'distribution:recoverExecution': return exactObject(value, ['taskId']) && uuid(value.taskId);
    default: return false;
  }
}
export function isDistributionExecutionRequest<C extends DistributionExecutionChannel>(value: unknown, channel: C): value is DistributionExecutionRequest<C> {
  return exactObject(value, ['contractVersion', 'requestId', 'payload']) && value.contractVersion === 1 && uuid(value.requestId) && isDistributionExecutionPayload(value.payload, channel);
}
function task(value: unknown): value is TaskSnapshot {
  return isTaskSnapshot(value) && value.kind === 'distribution-install' && uuid(value.taskId) && (!value.error || uuid(value.error.traceId));
}
export function isDistributionExecutionData<C extends DistributionExecutionChannel>(value: unknown, channel: C): value is DistributionExecutionData[C] {
  if (!bounded(value)) return false;
  switch (channel) {
    case 'distribution:prepareExecution': case 'distribution:executionPreparation': return isDistributionExecutionPreparation(value);
    case 'distribution:cancelExecutionPreparation': return exactObject(value, ['cancelled']) && typeof value.cancelled === 'boolean';
    case 'distribution:confirmExecution': return exactObject(value, ['taskId', 'proposalId', 'snapshot']) && uuid(value.taskId) && uuid(value.proposalId)
      && task(value.snapshot) && value.snapshot.taskId === value.taskId;
    case 'distribution:recoverExecution': return exactObject(value, ['taskId', 'recoveryRequestId', 'snapshot']) && uuid(value.taskId) && uuid(value.recoveryRequestId)
      && task(value.snapshot) && value.snapshot.taskId === value.taskId;
    default: return false;
  }
}
/** Correlates exact channel DTOs AND business identities to the original request, not merely its envelope UUID. */
export function isDistributionExecutionResult<C extends DistributionExecutionChannel>(value: unknown, request: DistributionExecutionRequest<C>, channel: C): value is DistributionExecutionResult<C> {
  if (!isDistributionExecutionRequest(request, channel) || !bounded(value)
    || !exactObject(value, value && typeof value === 'object' && 'ok' in value && value.ok === true ? ['contractVersion', 'requestId', 'ok', 'data'] : ['contractVersion', 'requestId', 'ok', 'error'])
    || value.contractVersion !== 1 || value.requestId !== request.requestId) return false;
  if (value.ok === false) return isDistributionExecutionError(value.error);
  if (value.ok !== true || !isDistributionExecutionData(value.data, channel)) return false;
  const data = value.data;
  if (channel === 'distribution:prepareExecution' || channel === 'distribution:executionPreparation') {
    const preparation = data as DistributionExecutionPreparation;
    const expected = channel === 'distribution:prepareExecution' ? request.requestId : (request.payload as { prepareRequestId: string }).prepareRequestId;
    if (preparation.prepareRequestId !== expected) return false;
    if (channel === 'distribution:prepareExecution' && preparation.state === 'ready') {
      const binding = request.payload as DistributionExecutionBinding; const proposal = preparation.proposal;
      return proposal.rootId === binding.rootId && proposal.instanceId === binding.instanceId && proposal.sourceId === binding.sourceId
        && proposal.packageId === binding.packageId && proposal.packageVersion === binding.packageVersion;
    }
  } else if (channel === 'distribution:confirmExecution') return (data as DistributionExecutionAccepted).proposalId === (request.payload as { proposalId: string }).proposalId;
  else if (channel === 'distribution:recoverExecution') return (data as DistributionExecutionRecovery).taskId === (request.payload as { taskId: string }).taskId
    && (data as DistributionExecutionRecovery).recoveryRequestId === request.requestId;
  return true;
}
