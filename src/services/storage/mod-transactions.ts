import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { resourceFilename, resourceId } from '../../shared/contracts/resources.js';
import { StorageError } from './files.js';

export type ModTransactionPhase = 'prepared' | 'applying' | 'committed' | 'rolledBack' | 'needsRecovery';
export interface ModFileIdentity { dev: string; ino: string }
export interface ModTransactionFile {
  filename: string; projectId: string; versionId: string; sha1: string; sha256: string; sha512: string; size: number; sourceKey: string;
  identity: ModFileIdentity | null;
}
export interface ModTransaction {
  formatVersion: 1; taskId: string; rootId: string; planRequestId: string; planId: string; instanceId: string;
  instanceRevision: number; fingerprint: string; beforeInstanceDigest: string; afterInstanceDigest: string;
  leaseToken: string; phase: ModTransactionPhase; files: ModTransactionFile[];
}
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);
const hex = (value: unknown, length: number): value is string => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
function invalid(): never { throw new StorageError('INVALID_RECORD'); }
export function modTransactionRecordId(taskId: string): string { if (!uuid(taskId)) invalid(); return `mod-txn-${taskId.toLowerCase()}`; }
/** Fixed managed-file receipt/recovery evidence. No filesystem path or arbitrary operation is accepted. */
export function parseModTransaction(value: unknown): ModTransaction {
  if (!exactObject(value, ['formatVersion', 'taskId', 'rootId', 'planRequestId', 'planId', 'instanceId', 'instanceRevision', 'fingerprint',
    'beforeInstanceDigest', 'afterInstanceDigest', 'leaseToken', 'phase', 'files']) || value.formatVersion !== 1
    || ![value.taskId, value.rootId, value.planRequestId, value.instanceId, value.leaseToken].every(uuid)
    || ![value.planId, value.fingerprint, value.beforeInstanceDigest, value.afterInstanceDigest].every(item => hex(item, 64))
    || typeof value.instanceRevision !== 'number' || !Number.isSafeInteger(value.instanceRevision) || value.instanceRevision < 1
    || value.instanceRevision >= Number.MAX_SAFE_INTEGER - 1 || !['prepared', 'applying', 'committed', 'rolledBack', 'needsRecovery'].includes(value.phase as string)
    || !Array.isArray(value.files) || value.files.length > 256) invalid();
  const names = new Set<string>(); const projects = new Set<string>();
  for (const file of value.files) {
    if (!exactObject(file, ['filename', 'projectId', 'versionId', 'sha1', 'sha256', 'sha512', 'size', 'sourceKey', 'identity'])
      || !resourceFilename(file.filename) || !file.filename.toLowerCase().endsWith('.jar') || !resourceId(file.projectId) || !resourceId(file.versionId)
      || !hex(file.sha1, 40) || !hex(file.sha256, 64) || !hex(file.sha512, 128) || !hex(file.sourceKey, 64)
      || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 1024 ** 3
      || file.identity !== null && (!exactObject(file.identity, ['dev', 'ino']) || file.identity.ino === '0'
        || ![file.identity.dev, file.identity.ino].every(item => typeof item === 'string' && /^\d{1,32}$/.test(item)))) invalid();
    if (names.has(file.filename.toLowerCase()) || projects.has(file.projectId)
      || ['applying', 'committed'].includes(value.phase as string) && file.identity === null) invalid();
    names.add(file.filename.toLowerCase()); projects.add(file.projectId);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) invalid();
  const result = structuredClone(value) as unknown as ModTransaction;
  for (const key of ['taskId', 'rootId', 'planRequestId', 'instanceId', 'leaseToken'] as const) result[key] = result[key].toLowerCase();
  return result;
}
/** Transaction identity and prepared evidence cannot be rewritten during recovery. */
export function assertModTransactionTransition(previous: ModTransaction | undefined, next: ModTransaction): void {
  if (!previous) { if (next.phase !== 'prepared' || next.files.some(file => file.identity !== null)) invalid(); return; }
  const immutable = (record: ModTransaction) => JSON.stringify({ ...record, phase: 'prepared', files: record.files.map(file => ({ ...file, identity: null })) });
  if (immutable(previous) !== immutable(next)) invalid();
  const allowed: Record<ModTransactionPhase, readonly ModTransactionPhase[]> = {
    prepared: ['prepared', 'applying', 'rolledBack', 'needsRecovery'], applying: ['committed', 'rolledBack', 'needsRecovery'],
    needsRecovery: ['needsRecovery', 'committed', 'rolledBack'], committed: [], rolledBack: [],
  };
  if (!allowed[previous.phase].includes(next.phase)) invalid();
  for (const [index, file] of previous.files.entries()) if (file.identity !== null
    && JSON.stringify(file.identity) !== JSON.stringify(next.files[index]!.identity)) invalid();
  if (previous.phase !== 'prepared' && previous.files.some((file, index) => JSON.stringify(file.identity) !== JSON.stringify(next.files[index]!.identity))) invalid();
}
