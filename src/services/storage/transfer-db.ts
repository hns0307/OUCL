import { DatabaseSync } from 'node:sqlite';
import { lstat } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { exactObject } from '../../shared/contracts/handshake.js';
import { parseTransferRecord } from '../download/types.js';
import type { TransferRecord } from '../download/types.js';
import { guardDatabase, guardDirectory, hasCode, StorageError } from './files.js';
import type { RecordStore } from './records.js';

const APPLICATION_ID = 0x4f554354;
const SCHEMA_VERSION = 1;
const MAX_ROW_BYTES = 16384;
interface FileIdentity { dev: bigint; ino: bigint; isFile(): boolean; isSymbolicLink(): boolean }
type FileProbe = (file: string) => FileIdentity;
const probeFile: FileProbe = file => lstatSync(file, { bigint: true });

function marker(value: unknown): { enabled: true } {
  if (!exactObject(value, ['enabled']) || value.enabled !== true) throw new StorageError('INVALID_RECORD');
  return { enabled: true };
}

function validKey(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new StorageError('INVALID_RECORD');
}

function databaseFailure(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  if (typeof error === 'object' && error !== null && 'errcode' in error && typeof error.errcode === 'number'
    && [5, 6].includes(error.errcode & 0xff)) return new StorageError('STORE_BUSY');
  return new StorageError('NEEDS_RECOVERY');
}

function decode(key: unknown, json: unknown): TransferRecord {
  try {
    if (typeof key !== 'string' || typeof json !== 'string' || Buffer.byteLength(json) > MAX_ROW_BYTES) throw new StorageError('NEEDS_RECOVERY');
    const record = parseTransferRecord(JSON.parse(json) as unknown);
    if (record.key !== key) throw new StorageError('NEEDS_RECOVERY');
    return record;
  } catch { throw new StorageError('NEEDS_RECOVERY'); }
}

/** Worker-owned authoritative download checkpoints, physically separate from search hints.
 * The caller must hold the RecordStore lease for this same directory for the entire lifetime.
 * bytesDone is a caller-acknowledged fsync prefix, never an inferred file-size observation.
 */
export class TransferDatabase {
  private closed = false;
  private constructor(private readonly db: DatabaseSync, private readonly file: string,
    private readonly identity: { dev: bigint; ino: bigint }, private readonly inspect: FileProbe) {}

  /** Opens only an understood ledger; a durable marker prevents recreating a lost ledger as empty. */
  static async open(directory: string, records: RecordStore, inspect: FileProbe = probeFile): Promise<TransferDatabase> {
    let db: DatabaseSync | undefined;
    try {
      const root = await guardDirectory(directory);
      const enabled = await records.read('transfers', marker);
      const file = path.join(root, 'transfers.sqlite');
      const exists = await guardDatabase(file);
      if (!exists) {
        if (enabled) throw new StorageError('NEEDS_RECOVERY');
        for (const suffix of ['-wal', '-shm', '-journal']) {
          try { await lstat(file + suffix); throw new StorageError('NEEDS_RECOVERY'); }
          catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
        }
      }
      db = new DatabaseSync(file);
      if (exists && (db.prepare('PRAGMA application_id').get()?.application_id !== APPLICATION_ID
        || db.prepare('PRAGMA user_version').get()?.user_version !== SCHEMA_VERSION
        || db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')) throw new StorageError('NEEDS_RECOVERY');
      db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      if (!exists) db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE transfers (key TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(length(record_json)<=${MAX_ROW_BYTES})) STRICT;
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION}; COMMIT;`);
      const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const columns = db.prepare('PRAGMA table_info(transfers)').all();
      if (tables.length !== 1 || tables[0]?.name !== 'transfers' || columns.length !== 2
        || db.prepare("PRAGMA table_list('transfers')").get()?.strict !== 1
        || columns[0]?.name !== 'key' || columns[0]?.type !== 'TEXT' || columns[0]?.pk !== 1
        || columns[1]?.name !== 'record_json' || columns[1]?.type !== 'TEXT' || columns[1]?.notnull !== 1
        || columns[1]?.pk !== 0) throw new StorageError('NEEDS_RECOVERY');
      const opened = inspect(file);
      if (!opened.isFile() || opened.isSymbolicLink()) throw new StorageError('NEEDS_RECOVERY');
      const ledger = new TransferDatabase(db, file, { dev: opened.dev, ino: opened.ino }, inspect);
      const entries = ledger.list();
      if (!enabled) {
        if (entries.length) throw new StorageError('NEEDS_RECOVERY');
        await records.write('transfers', 0, { enabled: true }, marker);
      }
      return ledger;
    } catch (error) {
      try { db?.close(); } catch { throw new StorageError('NEEDS_RECOVERY'); }
      const failure = databaseFailure(error);
      throw new StorageError(failure.code === 'STORE_BUSY' ? 'STORE_BUSY' : 'NEEDS_RECOVERY');
    }
  }

  private requireOpen(): void {
    if (this.closed) throw new StorageError('STORAGE_IO');
    // SQLite may retain cached pages/an open handle after the backing name disappears or changes.
    // This small synchronous metadata check stays inside the owner worker, before any SQL operation.
    try {
      const current = this.inspect(this.file);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== this.identity.dev || current.ino !== this.identity.ino) throw new StorageError('NEEDS_RECOVERY');
    } catch { throw new StorageError('NEEDS_RECOVERY'); }
  }

  /** Reads a checked durable checkpoint. Missing is distinct from malformed evidence. */
  get(key: string): TransferRecord | undefined {
    this.requireOpen(); validKey(key);
    try {
      const row = this.db.prepare('SELECT key, record_json FROM transfers WHERE key=?').get(key);
      return row ? decode(row.key, row.record_json) : undefined;
    } catch (error) { throw databaseFailure(error); }
  }

  /** Lists validated checkpoints for recovery without replaying network or filesystem effects. */
  list(): TransferRecord[] {
    this.requireOpen();
    try { return this.db.prepare('SELECT key, record_json FROM transfers ORDER BY key').all().map(row => decode(row.key, row.record_json)); }
    catch (error) { throw databaseFailure(error); }
  }

  /** Commits one revision using an immediate SQLite transaction; only a zero-byte reset may retreat. */
  set(expectedRevision: number, next: TransferRecord): void {
    this.requireOpen();
    let record: TransferRecord;
    try { record = parseTransferRecord(next); } catch { throw new StorageError('INVALID_RECORD'); }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || record.revision !== expectedRevision + 1) throw new StorageError('INVALID_RECORD');
    let transaction = false;
    try {
      this.db.exec('BEGIN IMMEDIATE'); transaction = true;
      const previous = this.get(record.key);
      if ((previous?.revision ?? 0) !== expectedRevision) throw new StorageError('REVISION_CONFLICT');
      if (!previous) {
        if (record.state !== 'partial' || record.bytesDone !== 0 || record.etag !== undefined || record.lastModified !== undefined) throw new StorageError('INVALID_RECORD');
      } else {
        const invalid = previous.stagingId !== record.stagingId
          || JSON.stringify(previous.expected) !== JSON.stringify(record.expected) || JSON.stringify(previous.anchor) !== JSON.stringify(record.anchor)
          || previous.state === 'committed'
          || record.state === 'committed' && previous.state !== 'complete'
          || previous.state === 'complete' && record.state === 'partial' && record.bytesDone !== 0
          || record.bytesDone < previous.bytesDone && record.bytesDone !== 0
          || previous.url !== record.url && (record.state !== 'partial' || record.bytesDone !== 0 || record.etag !== undefined || record.lastModified !== undefined)
          || previous.bytesDone > 0 && record.bytesDone > 0 && (previous.etag !== record.etag || previous.lastModified !== record.lastModified);
        if (invalid) throw new StorageError('INVALID_RECORD');
      }
      this.db.prepare('INSERT INTO transfers VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET record_json=excluded.record_json')
        .run(record.key, JSON.stringify(record));
      this.db.exec('COMMIT'); transaction = false;
    } catch (error) {
      if (transaction) {
        try { this.db.exec('ROLLBACK'); } catch { throw new StorageError('NEEDS_RECOVERY'); }
      }
      throw databaseFailure(error);
    }
  }

  /** Releases this ledger handle before the enclosing metadata lease is released. */
  close(): void {
    if (this.closed) return;
    try { this.db.close(); this.closed = true; } catch (error) { throw databaseFailure(error); }
  }
}
