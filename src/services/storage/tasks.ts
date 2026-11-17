import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createExecution, controlTask } from '../../core/task/machine.js';
import type { Execution } from '../../core/task/machine.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { StorageError } from './files.js';

export const TASK_KINDS = ['download', 'install', 'java', 'launch', 'stop', 'mod-check', 'mod-install', 'distribution-install'] as const;
export type TaskKind = typeof TASK_KINDS[number];
export interface StoredTask { taskId: string; ownerId: string; kind: TaskKind; execution: Execution }
export interface DistributionTaskProjection { proposalId: string; payloadDigest: string; task: StoredTask }
export interface ModConfirmation { planRequestId: string; payloadDigest: string; task: StoredTask }
export interface ModTargetAdmission { requestId: string; payloadDigest: string; task: StoredTask }
const STATES = ['queued', 'running', 'verifying', 'committing', 'pausing', 'paused', 'cancelling', 'cancelled', 'completed', 'failing', 'failed', 'needsRecovery'];
const KINDS: readonly string[] = TASK_KINDS;

/** Checks the exact private execution format rather than accepting arbitrary serialized objects. */
export function parseExecution(value: unknown): Execution {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new StorageError('INVALID_RECORD');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['state', 'attempt', 'lastSequence', 'revision', 'bytesDone', 'bytesTotal'].includes(key))
    || typeof record.state !== 'string' || !STATES.includes(record.state)
    || !['attempt', 'lastSequence', 'revision', 'bytesDone'].every(key => typeof record[key] === 'number' && Number.isSafeInteger(record[key]) && record[key] >= 0)
    || record.revision === 0 || record.revision === Number.MAX_SAFE_INTEGER
    || (record.bytesTotal !== undefined && (typeof record.bytesTotal !== 'number' || !Number.isSafeInteger(record.bytesTotal)
      || record.bytesTotal < (record.bytesDone as number)))) throw new StorageError('INVALID_RECORD');
  return { state: record.state as Execution['state'], attempt: record.attempt as number, lastSequence: record.lastSequence as number,
    revision: record.revision as number, bytesDone: record.bytesDone as number,
    ...(record.bytesTotal === undefined ? {} : { bytesTotal: record.bytesTotal as number }) };
}

function identity(value: string): void { if (!UUID_PATTERN.test(value)) throw new StorageError('INVALID_RECORD'); }

/** SQLite-only tasks and request deduplication, called exclusively while RecordStore owns its lease. */
export class TaskTable {
  constructor(private readonly db: DatabaseSync) {}

  /** Reads a complete bounded projection inventory, rejecting either orphan side. */
  readDistributionProjections(ownerId: string): DistributionTaskProjection[] {
    identity(ownerId);
    if (ownerId !== ownerId.toLowerCase()) throw new StorageError('INVALID_RECORD');
    const requests = this.db.prepare("SELECT * FROM requests WHERE owner_id=? AND kind='distribution-install' ORDER BY request_id LIMIT 1025").all(ownerId);
    const tasks = this.db.prepare("SELECT id FROM tasks WHERE owner_id=? AND kind='distribution-install' LIMIT 1025").all(ownerId);
    if (requests.length > 1024 || tasks.length > 1024 || requests.length !== tasks.length) throw new StorageError('NEEDS_RECOVERY');
    const remaining = new Set<string>(); const proposals = new Set<string>(); const result: DistributionTaskProjection[] = [];
    for (const row of tasks) {
      if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id) || row.id !== row.id.toLowerCase() || remaining.has(row.id)) throw new StorageError('NEEDS_RECOVERY');
      remaining.add(row.id);
    }
    for (const row of requests) {
      if (typeof row.request_id !== 'string' || !UUID_PATTERN.test(row.request_id) || row.request_id !== row.request_id.toLowerCase()
        || proposals.has(row.request_id) || typeof row.payload_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.payload_digest)
        || typeof row.task_id !== 'string' || !remaining.delete(row.task_id)) throw new StorageError('NEEDS_RECOVERY');
      proposals.add(row.request_id);
      const task = this.get(ownerId, row.task_id);
      if (!task || task.kind !== 'distribution-install') throw new StorageError('NEEDS_RECOVERY');
      result.push({ proposalId: row.request_id, payloadDigest: row.payload_digest, task });
    }
    if (remaining.size) throw new StorageError('NEEDS_RECOVERY');
    return result;
  }

  /** Reads both sides of each requested domain's acceptance inventory without changing storage. */
  modTargetAdmissions(ownerId: string, kinds: readonly ('mod-check' | 'mod-install')[], checkBudget?: () => void): ModTargetAdmission[] {
    identity(ownerId);
    if (kinds.length < 1 || kinds.length > 2 || new Set(kinds).size !== kinds.length
      || kinds.some(kind => kind !== 'mod-check' && kind !== 'mod-install')) throw new StorageError('INVALID_RECORD');
    const result: ModTargetAdmission[] = [];
    const requestIds = new Set<string>();
    for (const kind of kinds) {
      checkBudget?.();
      const requests = this.db.prepare('SELECT request_id, payload_digest, task_id FROM requests WHERE owner_id=? AND kind=? LIMIT 1001').all(ownerId, kind);
      checkBudget?.();
      const tasks = this.db.prepare('SELECT id FROM tasks WHERE owner_id=? AND kind=? LIMIT 1001').all(ownerId, kind);
      checkBudget?.();
      if (requests.length > 1000 || tasks.length > 1000 || requests.length !== tasks.length) throw new StorageError('NEEDS_RECOVERY');
      const remaining = new Set<string>();
      for (const row of tasks) {
        checkBudget?.();
        if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id) || remaining.has(row.id.toLowerCase())) throw new StorageError('NEEDS_RECOVERY');
        remaining.add(row.id.toLowerCase());
      }
      for (const row of requests) {
        checkBudget?.();
        if (typeof row.request_id !== 'string' || !UUID_PATTERN.test(row.request_id)
          || typeof row.payload_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.payload_digest)
          || typeof row.task_id !== 'string' || !UUID_PATTERN.test(row.task_id)
          || requestIds.has(row.request_id.toLowerCase()) || !remaining.delete(row.task_id.toLowerCase())) throw new StorageError('NEEDS_RECOVERY');
        requestIds.add(row.request_id.toLowerCase());
        const task = this.get(ownerId, row.task_id);
        if (!task || task.kind !== kind) throw new StorageError('NEEDS_RECOVERY');
        result.push({ requestId: row.request_id, payloadDigest: row.payload_digest, task });
      }
      if (remaining.size) throw new StorageError('NEEDS_RECOVERY');
    }
    return result;
  }

  /** Fixed bounded recovery inventory; never accepts arbitrary SQL or a caller-selected task kind. */
  modConfirmations(ownerId: string): ModConfirmation[] {
    identity(ownerId);
    const rows = this.db.prepare("SELECT request_id, payload_digest, task_id FROM requests WHERE owner_id=? AND kind='mod-install' ORDER BY request_id LIMIT 1001").all(ownerId);
    if (rows.length > 1000) throw new StorageError('NEEDS_RECOVERY');
    return rows.map(row => {
      if (typeof row.request_id !== 'string' || typeof row.payload_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.payload_digest)
        || typeof row.task_id !== 'string') throw new StorageError('NEEDS_RECOVERY');
      identity(row.request_id); const task = this.get(ownerId, row.task_id);
      if (!task || task.kind !== 'mod-install') throw new StorageError('NEEDS_RECOVERY');
      return { planRequestId: row.request_id, payloadDigest: row.payload_digest, task };
    });
  }

  /** Read-only acceptance lookup; an absent request never allocates a task or changes its state. */
  findAccepted(ownerId: string, requestId: string, kind: TaskKind, payloadDigest: string): StoredTask | undefined {
    identity(ownerId); identity(requestId);
    if (!KINDS.includes(kind) || !/^[a-f0-9]{64}$/.test(payloadDigest)) throw new StorageError('INVALID_RECORD');
    const accepted = this.db.prepare('SELECT task_id, kind, payload_digest FROM requests WHERE owner_id=? AND request_id=?').get(ownerId, requestId);
    if (!accepted) return undefined;
    if (accepted.kind !== kind || accepted.payload_digest !== payloadDigest || typeof accepted.task_id !== 'string') throw new StorageError('REVISION_CONFLICT');
    const task = this.get(ownerId, accepted.task_id);
    if (!task || task.kind !== kind) throw new StorageError('NEEDS_RECOVERY');
    return task;
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  /** Persists requestId and task together; identical retries recover the original acceptance. */
  accept(ownerId: string, requestId: string, kind: TaskKind, payloadDigest: string): StoredTask {
    identity(ownerId); identity(requestId);
    if (!KINDS.includes(kind) || kind === 'distribution-install' || !/^[a-f0-9]{64}$/.test(payloadDigest)) throw new StorageError('INVALID_RECORD');
    return this.transaction(() => {
      const accepted = this.db.prepare('SELECT task_id, kind, payload_digest FROM requests WHERE owner_id=? AND request_id=?').get(ownerId, requestId);
      if (accepted) {
        if (accepted.kind !== kind || accepted.payload_digest !== payloadDigest || typeof accepted.task_id !== 'string') throw new StorageError('REVISION_CONFLICT');
        const task = this.get(ownerId, accepted.task_id);
        if (!task) throw new StorageError('NEEDS_RECOVERY');
        return task;
      }
      const task: StoredTask = { taskId: randomUUID(), ownerId, kind, execution: createExecution() };
      this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)').run(task.taskId, ownerId, kind, JSON.stringify(task.execution));
      this.db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)').run(ownerId, requestId, kind, payloadDigest, task.taskId);
      return task;
    });
  }

  /** Projects an already admitted identity; this never authorizes or starts execution. */
  projectDistribution(ownerId: string, requestId: string, payloadDigest: string, taskId: string): StoredTask {
    for (const value of [ownerId, requestId, taskId]) {
      identity(value); if (value !== value.toLowerCase()) throw new StorageError('INVALID_RECORD');
    }
    if (!/^[a-f0-9]{64}$/.test(payloadDigest)) throw new StorageError('INVALID_RECORD');
    return this.transaction(() => {
      const requests = this.db.prepare('SELECT * FROM requests WHERE (owner_id=? AND request_id=?) OR task_id=?').all(ownerId, requestId, taskId);
      const existing = this.db.prepare('SELECT owner_id, kind FROM tasks WHERE id=?').get(taskId);
      if (requests.length || existing) {
        if (requests.length !== 1 || !existing) throw new StorageError('NEEDS_RECOVERY');
        const request = requests[0]!;
        if (request.owner_id !== ownerId || request.request_id !== requestId || request.task_id !== taskId
          || request.kind !== 'distribution-install' || request.payload_digest !== payloadDigest
          || existing.owner_id !== ownerId || existing.kind !== 'distribution-install') throw new StorageError('NEEDS_RECOVERY');
        const task = this.get(ownerId, taskId); if (!task) throw new StorageError('NEEDS_RECOVERY'); return task;
      }
      const task: StoredTask = { taskId, ownerId, kind: 'distribution-install', execution: createExecution() };
      this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)').run(taskId, ownerId, task.kind, JSON.stringify(task.execution));
      this.db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)').run(ownerId, requestId, task.kind, payloadDigest, taskId);
      return task;
    });
  }

  /** Atomically grants only this call the pristine task's first start; retries never grant it again. */
  claimDistribution(ownerId: string, proposalId: string, payloadDigest: string, taskId: string): StoredTask {
    for (const value of [ownerId, proposalId, taskId]) {
      identity(value); if (value !== value.toLowerCase()) throw new StorageError('INVALID_RECORD');
    }
    if (!/^[a-f0-9]{64}$/.test(payloadDigest)) throw new StorageError('INVALID_RECORD');
    return this.transaction(() => {
      const rows = this.db.prepare('SELECT * FROM requests WHERE (owner_id=? AND request_id=?) OR task_id=? LIMIT 2').all(ownerId, proposalId, taskId);
      const row = rows[0]; const task = this.get(ownerId, taskId);
      if (rows.length !== 1 || !row || row.owner_id !== ownerId || row.request_id !== proposalId || row.task_id !== taskId
        || row.payload_digest !== payloadDigest || row.kind !== 'distribution-install' || !task || task.kind !== 'distribution-install') throw new StorageError('NEEDS_RECOVERY');
      const current = task.execution;
      if (current.state !== 'queued' || current.attempt !== 0 || current.revision !== 1 || current.lastSequence !== 0
        || current.bytesDone !== 0 || current.bytesTotal !== undefined) throw new StorageError('NEEDS_RECOVERY');
      const next = controlTask(current, 'start');
      if (next.rejected || next.execution.state !== 'running' || next.execution.attempt !== 1 || next.execution.revision !== 2
        || next.execution.lastSequence !== 0 || next.execution.bytesDone !== 0 || next.execution.bytesTotal !== undefined) throw new StorageError('NEEDS_RECOVERY');
      this.db.prepare('UPDATE tasks SET execution=? WHERE id=? AND owner_id=?').run(JSON.stringify(next.execution), taskId, ownerId);
      return { ...task, execution: next.execution };
    });
  }

  /** Looks up by stable application owner, not a transient window session. */
  get(ownerId: string, taskId: string): StoredTask | undefined {
    identity(ownerId); identity(taskId);
    const row = this.db.prepare('SELECT owner_id, kind, execution FROM tasks WHERE id=? AND owner_id=?').get(taskId, ownerId);
    if (!row) return undefined;
    if (typeof row.kind !== 'string' || !KINDS.includes(row.kind) || typeof row.execution !== 'string') throw new StorageError('NEEDS_RECOVERY');
    try { return { taskId, ownerId, kind: row.kind as TaskKind, execution: parseExecution(JSON.parse(row.execution) as unknown) }; }
    catch { throw new StorageError('NEEDS_RECOVERY'); }
  }

  /** Uses compare-and-swap revision so concurrent callbacks cannot overwrite newer task state. */
  update(ownerId: string, taskId: string, expectedRevision: number, execution: Execution): StoredTask {
    const validated = parseExecution(execution);
    return this.transaction(() => {
      const current = this.get(ownerId, taskId);
      if (!current || current.execution.revision !== expectedRevision || validated.revision !== expectedRevision + 1) throw new StorageError('REVISION_CONFLICT');
      this.db.prepare('UPDATE tasks SET execution=? WHERE id=? AND owner_id=?').run(JSON.stringify(validated), taskId, ownerId);
      return { ...current, execution: validated };
    });
  }

  /** Marks uncertain in-flight work for recovery; never automatically replays side effects. */
  recover(): void {
    this.transaction(() => {
      for (const row of this.db.prepare('SELECT id, owner_id FROM tasks').all()) {
        if (typeof row.id !== 'string' || typeof row.owner_id !== 'string') throw new StorageError('NEEDS_RECOVERY');
        const task = this.get(row.owner_id, row.id);
        if (!task) throw new StorageError('NEEDS_RECOVERY');
        const recovered = controlTask(task.execution, 'interrupted').execution;
        if (recovered !== task.execution) this.db.prepare('UPDATE tasks SET execution=? WHERE id=?').run(JSON.stringify(recovered), row.id);
      }
      const accepted = new Set<string>();
      for (const row of this.db.prepare('SELECT * FROM requests').all()) {
        if (typeof row.owner_id !== 'string' || typeof row.request_id !== 'string' || typeof row.task_id !== 'string'
          || typeof row.payload_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.payload_digest)) throw new StorageError('NEEDS_RECOVERY');
        identity(row.request_id);
        const task = this.get(row.owner_id, row.task_id);
        if (!task || task.kind !== row.kind || accepted.has(row.task_id)) throw new StorageError('NEEDS_RECOVERY');
        accepted.add(row.task_id);
      }
      if (accepted.size !== this.db.prepare('SELECT id FROM tasks').all().length) throw new StorageError('NEEDS_RECOVERY');
      if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new StorageError('NEEDS_RECOVERY');
    });
  }
}
