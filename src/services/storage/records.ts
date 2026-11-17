import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { guardDatabase, guardDirectory, hasCode, MAX_RECORD_BYTES, ownsLease, readRegular, StorageError } from './files.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { TaskTable } from './tasks.js';
import type { StoredTask, TaskKind } from './tasks.js';
import type { Execution } from '../../core/task/machine.js';
import { isOwnerGuardFile } from './owner-guard.js';

export interface RecordEnvelope<T> { schemaVersion: 1; revision: number; data: T }
export type Checkpoint = 'prepared' | 'applying' | 'staged' | 'renamed' | 'committed';
type Phase = 'PREPARED' | 'APPLYING' | 'COMMITTED' | 'ROLLED_BACK';
interface Operation { id: string; recordId: string; phase: Phase; before: string | null; after: string }
const APPLICATION_ID = 0x4f55434c;
const STORE_VERSION = 1;
const ID_PATTERN = /^(?!(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$)[a-zA-Z0-9_-]{1,80}$/i;

function digest(bytes: Buffer | string | undefined): string | undefined {
  return bytes === undefined ? undefined : createHash('sha256').update(bytes).digest('hex');
}

function envelope<T>(text: string, parseData: (value: unknown) => T): RecordEnvelope<T> {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'data,revision,schemaVersion'
      || !('schemaVersion' in value) || value.schemaVersion !== 1 || !('revision' in value) || !Number.isSafeInteger(value.revision)
      || typeof value.revision !== 'number' || value.revision < 1 || !('data' in value)) throw new StorageError('INVALID_RECORD');
    return { schemaVersion: 1, revision: value.revision, data: parseData(value.data) };
  } catch { throw new StorageError('INVALID_RECORD'); }
}

/** Worker-owned single-writer metadata repository. Never construct on Electron's main thread.
 * JSON is the commit point. SQLite operations are authoritative recovery evidence, not a disposable index.
 * A stale lease after a process crash deliberately blocks opening pending explicit owner recovery.
 */
export class RecordStore {
  private available = false;
  private closed = false;
  private tail: Promise<void> = Promise.resolve();
  private constructor(private readonly directory: string, private readonly db: DatabaseSync, private readonly token: string, private readonly externalOwner: boolean) {}

  /** Opens a dedicated, existing, non-linked directory and claims an exclusive fail-closed lease. */
  static async open(directory: string, externalToken?: string): Promise<RecordStore> {
    let root: string;
    try { root = await guardDirectory(directory); }
    catch (error) { throw error instanceof StorageError ? error : new StorageError('STORAGE_IO'); }
    const leasePath = path.join(root, 'owner.lock');
    const token = externalToken ?? randomUUID();
    let lease;
    if (externalToken === undefined) {
      try { lease = await open(leasePath, 'wx'); } catch (error) {
        throw new StorageError(hasCode(error, 'EEXIST') ? 'STORE_BUSY' : 'STORAGE_IO');
      }
    } else if ((await readRegular(leasePath, 200))?.toString('utf8') !== externalToken) throw new StorageError('STORE_BUSY');
    let db: DatabaseSync | undefined;
    try {
      if (lease) { await lease.writeFile(token); await lease.sync(); await lease.close(); }
      const databasePath = path.join(root, 'tasks.sqlite');
      const exists = await guardDatabase(databasePath);
      if (!exists && (await readdir(root)).some(name => name !== 'owner.lock' && !(externalToken && isOwnerGuardFile(name)))) throw new StorageError('NEEDS_RECOVERY');
      db = new DatabaseSync(databasePath);
      if (exists) {
        const application = db.prepare('PRAGMA application_id').get();
        const version = db.prepare('PRAGMA user_version').get();
        if (application?.application_id !== APPLICATION_ID || version?.user_version !== STORE_VERSION
          || db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new StorageError('NEEDS_RECOVERY');
      }
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
      if (!exists) db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE operations (id TEXT PRIMARY KEY, record_id TEXT NOT NULL, phase TEXT NOT NULL,
          before_json TEXT, after_json TEXT NOT NULL);
        CREATE TABLE tasks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, execution TEXT NOT NULL);
        CREATE TABLE requests (owner_id TEXT NOT NULL, request_id TEXT NOT NULL, kind TEXT NOT NULL,
          payload_digest TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id), PRIMARY KEY (owner_id, request_id));
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${STORE_VERSION}; COMMIT;`);
      return new RecordStore(root, db, token, externalToken !== undefined);
    } catch (error) {
      db?.close(); await lease?.close().catch(() => {});
      if (externalToken === undefined && await ownsLease(leasePath, token)) await unlink(leasePath);
      throw error instanceof StorageError ? error : new StorageError('NEEDS_RECOVERY');
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => {
      if (this.closed) throw new StorageError('STORAGE_IO');
      try { await guardDirectory(this.directory); return await work(); }
      catch (error) { throw error instanceof StorageError ? error : new StorageError('STORAGE_IO'); }
    });
    this.tail = pending.then(() => {}, () => {});
    return pending;
  }

  private file(recordId: string): string {
    if (!ID_PATTERN.test(recordId)) throw new StorageError('INVALID_RECORD');
    return path.join(this.directory, `${recordId}.json`);
  }

  private *operations(): Iterable<Operation> {
    // Journal size grows with revisions, while the worker heap must stay bounded by a few records.
    for (const row of this.db.prepare('SELECT id, record_id, phase, before_json, after_json FROM operations ORDER BY rowid').iterate()) {
      if (typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)
        || typeof row.record_id !== 'string' || !ID_PATTERN.test(row.record_id)
        || typeof row.phase !== 'string' || !['PREPARED', 'APPLYING', 'COMMITTED', 'ROLLED_BACK'].includes(row.phase)
        || (row.before_json !== null && (typeof row.before_json !== 'string' || Buffer.byteLength(row.before_json) > MAX_RECORD_BYTES)) || typeof row.after_json !== 'string'
        || Buffer.byteLength(row.after_json) > MAX_RECORD_BYTES) throw new StorageError('NEEDS_RECOVERY');
      yield { id: row.id, recordId: row.record_id, phase: row.phase as Phase, before: row.before_json, after: row.after_json };
    }
  }

  private requireKnown(recordId: string, bytes: Buffer | undefined): void {
    const row = this.db.prepare('SELECT phase, before_json, after_json FROM operations WHERE record_id=? ORDER BY rowid DESC LIMIT 1').get(recordId);
    if (!row && bytes === undefined) return;
    const wanted = row?.phase === 'COMMITTED' ? row.after_json : row?.phase === 'ROLLED_BACK' ? row.before_json : false;
    if (wanted === false || (wanted !== null && typeof wanted !== 'string') || digest(bytes) !== digest(wanted ?? undefined)) {
      this.available = false; throw new StorageError('NEEDS_RECOVERY');
    }
  }

  /** Resolves prepared operations using the actual JSON commit point; unknown evidence stops writes. */
  recover(): Promise<void> {
    return this.serial(async () => {
      this.available = false;
      try {
        const outcomes = new Map<string, string | undefined>();
        const pending = new Set<string>();
        for (const operation of this.operations()) {
          if (pending.has(operation.recordId)) throw new StorageError('NEEDS_RECOVERY');
          if (operation.phase === 'PREPARED' || operation.phase === 'APPLYING') pending.add(operation.recordId);
          if (digest(operation.before ?? undefined) !== outcomes.get(operation.recordId)) throw new StorageError('NEEDS_RECOVERY');
          const before = operation.before === null ? undefined : envelope(operation.before, value => value);
          const after = envelope(operation.after, value => value);
          if (after.revision !== (before?.revision ?? 0) + 1) throw new StorageError('NEEDS_RECOVERY');
          outcomes.set(operation.recordId, digest(operation.phase === 'COMMITTED' ? operation.after : operation.before ?? undefined));
        }
        const latest = new Map<string, string | undefined>();
        for (const operation of this.operations()) {
          if (operation.phase === 'COMMITTED' || operation.phase === 'ROLLED_BACK') {
            latest.set(operation.recordId, digest(operation.phase === 'COMMITTED' ? operation.after : operation.before ?? undefined)); continue;
          }
          const current = await readRegular(this.file(operation.recordId));
          let phase: Phase;
          if (digest(current) === digest(operation.after) && operation.phase === 'APPLYING') phase = 'COMMITTED';
          else if (digest(current) === digest(operation.before ?? undefined)) phase = 'ROLLED_BACK';
          else throw new StorageError('NEEDS_RECOVERY');
          const temporary = path.join(this.directory, `${operation.id}.tmp`);
          const staged = await readRegular(temporary);
          if (staged !== undefined && digest(staged) !== digest(operation.after)) throw new StorageError('NEEDS_RECOVERY');
          this.db.prepare('UPDATE operations SET phase=? WHERE id=?').run(phase, operation.id);
          latest.set(operation.recordId, digest(phase === 'COMMITTED' ? operation.after : operation.before ?? undefined));
          if (staged !== undefined) await unlink(temporary);
        }
        // Each latest record must agree with its last authoritative journal outcome.
        for (const [id, wantedDigest] of latest) {
          if (digest(await readRegular(this.file(id))) !== wantedDigest) throw new StorageError('NEEDS_RECOVERY');
        }
        const known = new Set([...latest.keys()].map(id => `${id}.json`));
        for (const name of await readdir(this.directory)) {
          if (name.endsWith('.json') && !known.has(name) || name.endsWith('.tmp')) throw new StorageError('NEEDS_RECOVERY');
        }
        new TaskTable(this.db).recover();
        this.available = true;
      } catch { throw new StorageError('NEEDS_RECOVERY'); }
    });
  }

  /** Reads an exact accepted request without changing the task or request journal. */
  readModConfirmations(ownerId: string) {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      return new TaskTable(this.db).modConfirmations(ownerId);
    });
  }

  /** Reads the bounded, bidirectionally checked inventory for the selected Mod domains. */
  readModTargetAdmissions(ownerId: string, kinds: readonly ('mod-check' | 'mod-install')[], checkBudget?: () => void) {
    let budgetFailed = false; let budgetError: unknown;
    const check = checkBudget && (() => {
      try { checkBudget(); } catch (error) { budgetFailed = true; budgetError = error; throw error; }
    });
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      return new TaskTable(this.db).modTargetAdmissions(ownerId, kinds, check);
    }).catch((error: unknown) => { if (budgetFailed) throw budgetError; throw error; });
  }

  /** Reads an exact accepted request without changing the task or request journal. */
  findAcceptedTask(ownerId: string, requestId: string, kind: TaskKind, payloadDigest: string): Promise<StoredTask | undefined> {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      return new TaskTable(this.db).findAccepted(ownerId, requestId, kind, payloadDigest);
    });
  }

  /** Accepts and persists a side-effect request before any executor starts. */
  acceptTask(ownerId: string, requestId: string, kind: TaskKind, payloadDigest: string): Promise<StoredTask> {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      return new TaskTable(this.db).accept(ownerId, requestId, kind, payloadDigest);
    });
  }

  /** Projects a confirmed distribution identity without starting or recovering work. */
  projectDistributionTask(ownerId: string, proposalId: string, payloadDigest: string, taskId: string): Promise<StoredTask> {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      return new TaskTable(this.db).projectDistribution(ownerId, proposalId, payloadDigest, taskId);
    });
  }

  /** Claims a pristine distribution task once; an unknown acknowledgement must not be read back as permission. */
  claimDistributionTask(ownerId: string, proposalId: string, payloadDigest: string, taskId: string): Promise<StoredTask> {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      return new TaskTable(this.db).claimDistribution(ownerId, proposalId, payloadDigest, taskId);
    });
  }

  /** Reads the complete bounded distribution task projection without changing either table. */
  readDistributionTaskProjections(ownerId: string) {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      return new TaskTable(this.db).readDistributionProjections(ownerId);
    });
  }

  /** Reads a task only for its stable application owner. */
  getTask(ownerId: string, taskId: string): Promise<StoredTask | undefined> {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      return new TaskTable(this.db).get(ownerId, taskId);
    });
  }

  /** Persists a state transition before the caller dispatches its effects. */
  updateTask(ownerId: string, taskId: string, expectedRevision: number, execution: Execution): Promise<StoredTask> {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      return new TaskTable(this.db).update(ownerId, taskId, expectedRevision, execution);
    });
  }

  /** Reads a schema-checked record after recovery. Missing is not treated as empty data. */
  read<T>(recordId: string, parseData: (value: unknown) => T): Promise<RecordEnvelope<T> | undefined> {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      const raw = await readRegular(this.file(recordId));
      this.requireKnown(recordId, raw);
      return raw === undefined ? undefined : envelope(raw.toString('utf8'), parseData);
    });
  }

  /** Atomically commits one versioned JSON record; revision 0 means create, never overwrite unknown data. */
  write<T>(recordId: string, expectedRevision: number, data: T, parseData: (value: unknown) => T,
    checkpoint: (point: Checkpoint) => Promise<void> = async () => {}): Promise<RecordEnvelope<T>> {
    return this.serial(async () => {
      if (!this.available) throw new StorageError('NEEDS_RECOVERY');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new StorageError('INVALID_RECORD');
      const target = this.file(recordId);
      const raw = await readRegular(target);
      this.requireKnown(recordId, raw);
      const before = raw?.toString('utf8');
      const current = before === undefined ? undefined : envelope(before, parseData);
      if ((current?.revision ?? 0) !== expectedRevision) throw new StorageError('REVISION_CONFLICT');
      const after = JSON.stringify({ schemaVersion: 1, revision: expectedRevision + 1, data: parseData(data) }) + '\n';
      if (Buffer.byteLength(after) > MAX_RECORD_BYTES) throw new StorageError('INVALID_RECORD');
      const result = envelope(after, parseData);
      const id = randomUUID();
      const temporary = path.join(this.directory, `${id}.tmp`);
      this.available = false;
      try {
        this.db.prepare('INSERT INTO operations VALUES (?, ?, ?, ?, ?)').run(id, recordId, 'PREPARED', before ?? null, after);
        await checkpoint('prepared');
        this.db.prepare('UPDATE operations SET phase=? WHERE id=?').run('APPLYING', id);
        await checkpoint('applying');
        const handle = await open(temporary, 'wx');
        try { await handle.writeFile(after); await handle.sync(); } finally { await handle.close(); }
        await checkpoint('staged');
        await guardDirectory(this.directory);
        if (digest(await readRegular(target)) !== digest(before)) throw new StorageError('NEEDS_RECOVERY');
        await rename(temporary, target);
        await checkpoint('renamed');
        this.db.prepare('UPDATE operations SET phase=? WHERE id=?').run('COMMITTED', id);
        await checkpoint('committed');
        this.available = true;
        return result;
      } catch { throw new StorageError('NEEDS_RECOVERY'); }
    });
  }

  /** Closes only this repository; removing a stale/foreign lease is deliberately unsupported. */
  close(): Promise<void> {
    return this.serial(async () => {
      this.db.close(); this.closed = true; this.available = false;
      const lease = path.join(this.directory, 'owner.lock');
      if (this.externalOwner) {
        if ((await readRegular(lease, 200))?.toString('utf8') !== this.token) throw new StorageError('NEEDS_RECOVERY');
        return;
      }
      if (!await ownsLease(lease, this.token)) throw new StorageError('NEEDS_RECOVERY');
      await unlink(lease);
    });
  }
}
