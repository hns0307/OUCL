import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { parseExecution } from '../storage/tasks.js';
import type { DistributionTaskProjection, StoredTask } from '../storage/tasks.js';
import { MAX_ADMISSION_TOTAL_BYTES, parseAdmissionRecord } from './admission-record.js';
import type { AdmissionRecord, AdmissionRepository } from './admission-record.js';

export interface DistributionReconciliationPorts {
  admissions: Pick<AdmissionRepository, 'listAll' | 'readByProposal' | 'markProjected'>;
  readProjections(expectedRootId: string): Promise<DistributionTaskProjection[]>;
  project(expectedRootId: string, proposalId: string, payloadDigest: string, taskId: string): Promise<StoredTask>;
}
export interface DistributionReconciliationResult { rootId: string; inspected: number; projected: number }
/** Only metadata is reconciled. A task projection is never permission to replay file operations. */
export class DistributionReconciliationError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NEEDS_RECOVERY' | 'CLOSED') { super(code); this.name = 'DistributionReconciliationError'; }
}
function fail(): never { throw new DistributionReconciliationError('NEEDS_RECOVERY'); }
function budget(rows: readonly unknown[]): void {
  let bytes = 0;
  for (const row of rows) {
    const text = JSON.stringify(row);
    if (typeof text !== 'string') fail();
    bytes += Buffer.byteLength(text);
    // Repository output adds phase/revision fields to each stored JSON record.
    if (bytes > MAX_ADMISSION_TOTAL_BYTES + 1024 * 128) fail();
  }
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID_PATTERN.test(value) && value === value.toLowerCase(); }
function task(value: unknown, rootId: string): StoredTask {
  if (!exactObject(value, ['taskId', 'ownerId', 'kind', 'execution']) || !uuid(value.taskId) || value.ownerId !== rootId
    || value.kind !== 'distribution-install') fail();
  return { taskId: value.taskId, ownerId: rootId, kind: 'distribution-install', execution: parseExecution(value.execution) };
}
function same(left: AdmissionRecord, right: AdmissionRecord): boolean {
  return left.proposalId === right.proposalId && left.taskId === right.taskId && left.inputDigest === right.inputDigest
    && left.plan.rootId === right.plan.rootId;
}

/** Startup runs before accepting new confirmations. Both owners must remain exclusive throughout this bounded reconciliation. */
export class DistributionAdmissionReconciler {
  private running: Promise<DistributionReconciliationResult> | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly rootId: string, private readonly ports: DistributionReconciliationPorts) {
    if (!uuid(rootId)) throw new DistributionReconciliationError('INVALID_ARGUMENT');
  }
  private async admissions(): Promise<Map<string, AdmissionRecord>> {
    const observed = await this.ports.admissions.listAll();
    if (!Array.isArray(observed) || observed.length > 1024) fail();
    budget(observed);
    const raw = structuredClone(observed);
    const result = new Map<string, AdmissionRecord>(); const tasks = new Set<string>(); const ids = new Set<string>();
    for (const value of raw) {
      const record = parseAdmissionRecord(value);
      if (ids.has(record.proposalId) || tasks.has(record.taskId)) fail();
      ids.add(record.proposalId); tasks.add(record.taskId);
      if (record.plan.rootId === this.rootId) result.set(record.proposalId, record);
    }
    return result;
  }
  private async projections(admissions: Map<string, AdmissionRecord>): Promise<Map<string, DistributionTaskProjection>> {
    const observed = await this.ports.readProjections(this.rootId);
    if (!Array.isArray(observed) || observed.length > 1024) fail();
    budget(observed);
    const raw = structuredClone(observed);
    const result = new Map<string, DistributionTaskProjection>(); const tasks = new Set<string>();
    for (const row of raw) {
      if (!exactObject(row, ['proposalId', 'payloadDigest', 'task']) || !uuid(row.proposalId)
        || typeof row.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.payloadDigest)) fail();
      const stored = task(row.task, this.rootId); const admission = admissions.get(row.proposalId);
      if (!admission || admission.taskId !== stored.taskId || admission.inputDigest !== row.payloadDigest
        || result.has(row.proposalId) || tasks.has(stored.taskId)) fail();
      result.set(row.proposalId, { proposalId: row.proposalId, payloadDigest: row.payloadDigest, task: stored }); tasks.add(stored.taskId);
    }
    return result;
  }
  private async mark(record: AdmissionRecord): Promise<void> {
    let observed: AdmissionRecord;
    try { observed = parseAdmissionRecord(await this.ports.admissions.markProjected(record.proposalId, record.taskId)); }
    catch {
      const read = await this.ports.admissions.readByProposal(record.proposalId);
      if (!read) return fail(); observed = parseAdmissionRecord(read);
    }
    if (!same(record, observed) || observed.phase !== 'projected') fail();
  }
  private async work(): Promise<DistributionReconciliationResult> {
    try {
      const admissions = await this.admissions(); let projections = await this.projections(admissions); let projected = 0;
      // A projected record with a lost task may have already executed. Never recreate it as queued.
      for (const record of admissions.values()) if (record.phase === 'projected' && !projections.has(record.proposalId)) fail();
      for (const record of admissions.values()) {
        if (!projections.has(record.proposalId)) {
          try {
            const stored = task(await this.ports.project(this.rootId, record.proposalId, record.inputDigest, record.taskId), this.rootId);
            if (stored.taskId !== record.taskId) fail();
          } catch {
            // A lost acknowledgement is resolved only by an exact durable read-back, never a new ID.
            projections = await this.projections(admissions);
            if (!projections.has(record.proposalId)) fail();
          }
          projections = await this.projections(admissions);
          if (!projections.has(record.proposalId)) fail();
        }
        if (record.phase === 'accepted') { await this.mark(record); projected++; }
      }
      const final = await this.admissions();
      if (final.size !== admissions.size) fail();
      for (const record of admissions.values()) {
        const observed = final.get(record.proposalId);
        if (!observed || !same(record, observed) || observed.phase !== 'projected') fail();
      }
      const finalTasks = await this.projections(final);
      if (finalTasks.size !== final.size) fail();
      return { rootId: this.rootId, inspected: final.size, projected };
    } catch { throw new DistributionReconciliationError('NEEDS_RECOVERY'); }
  }
  /** Shares one in-flight reconciliation; each caller receives a detached summary. */
  reconcile(): Promise<DistributionReconciliationResult> {
    if (this.closed) return Promise.reject(new DistributionReconciliationError('CLOSED'));
    this.running ??= this.work().finally(() => { this.running = undefined; });
    return this.running.then(result => ({ ...result }));
  }
  /** Waits for metadata commits/read-backs to settle; no cancellation abandons an uncertain commit. */
  close(): Promise<void> {
    this.closed = true;
    return this.closing ??= (async () => { await this.running?.catch(() => {}); })();
  }
}
