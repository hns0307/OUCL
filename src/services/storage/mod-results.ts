import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isModCode } from '../../shared/contracts/mods.js';
import type { ModCode } from '../../shared/contracts/mods.js';
import { isModReport } from '../../shared/contracts/mods-report.js';
import type { ModReport } from '../../shared/contracts/mods-report.js';
import { StorageError } from './files.js';

export interface ModInstallResult {
  formatVersion: 1; rootId: string; taskId: string; planRequestId: string; planId: string;
  instanceId: string; instanceRevision: number; state: 'completed' | 'failed' | 'cancelled' | 'needsRecovery';
  errorCode: ModCode | null; assessment: ModReport | null;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
function invalid(): never { throw new StorageError('INVALID_RECORD'); }
export function modResultRecordId(taskId: string): string { if (!uuid(taskId)) invalid(); return `mod-result-${taskId.toLowerCase()}`; }
/** Fixed path-free result; the immutable plan retains download provenance and dependency chains. */
export function parseModInstallResult(value: unknown): ModInstallResult {
  if (!exactObject(value, ['formatVersion', 'rootId', 'taskId', 'planRequestId', 'planId', 'instanceId', 'instanceRevision', 'state', 'errorCode', 'assessment'])
    || value.formatVersion !== 1 || !uuid(value.rootId) || !uuid(value.taskId) || !uuid(value.planRequestId) || !uuid(value.instanceId)
    || typeof value.planId !== 'string' || !/^[a-f0-9]{64}$/.test(value.planId)
    || typeof value.instanceRevision !== 'number' || !Number.isSafeInteger(value.instanceRevision) || value.instanceRevision < 1
    || !['completed', 'failed', 'cancelled', 'needsRecovery'].includes(String(value.state))
    || value.errorCode !== null && !isModCode(value.errorCode) || value.assessment !== null && !isModReport(value.assessment)
    || (value.state === 'completed') !== (value.errorCode === null)
    || value.state === 'cancelled' && value.errorCode !== 'CANCELLED' || value.state === 'needsRecovery' && value.errorCode !== 'NEEDS_RECOVERY'
    || value.assessment !== null && (value.assessment.instanceId !== value.instanceId || value.assessment.instanceRevision !== value.instanceRevision)
    || Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 ** 2) invalid();
  return structuredClone(value) as unknown as ModInstallResult;
}
/** A recovery observation may resolve once; terminal evidence can never be silently rewritten. */
export function assertModResultTransition(previous: ModInstallResult | undefined, next: ModInstallResult): void {
  if (!previous) return;
  const identity = (value: ModInstallResult) => JSON.stringify({ rootId: value.rootId, taskId: value.taskId,
    planRequestId: value.planRequestId, planId: value.planId, instanceId: value.instanceId, instanceRevision: value.instanceRevision });
  if (identity(previous) !== identity(next) || previous.state !== 'needsRecovery' && JSON.stringify(previous) !== JSON.stringify(next)) invalid();
}
