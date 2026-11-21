import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { isModCode } from '../../shared/contracts/mods.js';
import type { ModCode } from '../../shared/contracts/mods.js';
import { isModReport } from '../../shared/contracts/mods-report.js';
import type { ModReport } from '../../shared/contracts/mods-report.js';
import { StorageError } from './files.js';

export type ModJobStage = 'queued' | 'local' | 'platform' | 'rechecking' | 'completed' | 'failed' | 'cancelled' | 'needsRecovery';
export interface ModJobRecord {
  taskId: string; requestId: string; payloadDigest: string; instanceId: string; instanceRevision: number;
  mode: 'list' | 'check'; stage: ModJobStage; reportRevision: 0 | 1; errorCode: ModCode | null;
}
export interface ModJobs { formatVersion: 1; rootId: string; items: ModJobRecord[] }
export interface StoredModReport { formatVersion: 1; rootId: string; taskId: string; report: ModReport }
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
function invalid(): never { throw new StorageError('INVALID_RECORD'); }
export function modReportRecordId(taskId: string): string { if (!uuid(taskId)) invalid(); return `mod-report-${taskId.toLowerCase()}`; }
/** Fixed versioned job index. Unknown future fields/versions stop reads and writes without discarding history. */
export function parseModJobs(value: unknown): ModJobs {
  if (!exactObject(value, ['formatVersion', 'rootId', 'items']) || value.formatVersion !== 1 || !uuid(value.rootId)
    || !Array.isArray(value.items) || value.items.length > 1000) invalid();
  const requests = new Set<string>(); const tasks = new Set<string>();
  for (const job of value.items) {
    if (!exactObject(job, ['taskId', 'requestId', 'payloadDigest', 'instanceId', 'instanceRevision', 'mode', 'stage', 'reportRevision', 'errorCode'])
      || !uuid(job.taskId) || !uuid(job.requestId) || !uuid(job.instanceId) || typeof job.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(job.payloadDigest)
      || typeof job.instanceRevision !== 'number' || !Number.isSafeInteger(job.instanceRevision) || job.instanceRevision < 1
      || job.mode !== 'list' && job.mode !== 'check' || typeof job.stage !== 'string'
      || !['queued', 'local', 'platform', 'rechecking', 'completed', 'failed', 'cancelled', 'needsRecovery'].includes(job.stage)
      || job.reportRevision !== 0 && job.reportRevision !== 1 || job.errorCode !== null && !isModCode(job.errorCode)) invalid();
    if (job.stage === 'completed' && (job.reportRevision !== 1 || job.errorCode !== null)
      || job.reportRevision === 1 && job.errorCode !== null || requests.has(job.requestId.toLowerCase()) || tasks.has(job.taskId.toLowerCase())) invalid();
    requests.add(job.requestId.toLowerCase()); tasks.add(job.taskId.toLowerCase());
  }
  return value as unknown as ModJobs;
}
export function parseStoredModReport(value: unknown): StoredModReport {
  if (!exactObject(value, ['formatVersion', 'rootId', 'taskId', 'report']) || value.formatVersion !== 1 || !uuid(value.rootId) || !uuid(value.taskId) || !isModReport(value.report)) invalid();
  return value as unknown as StoredModReport;
}
