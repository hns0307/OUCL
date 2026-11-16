import { DatabaseSync } from 'node:sqlite';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { UUID_PATTERN, exactObject } from '../../shared/contracts/handshake.js';
import { canonicalDistributionReleasePayload, parseDistributionReleaseEnvelope } from '../../core/distribution/release.js';
import { OwnerGuard, isOwnerGuardFile } from '../storage/owner-guard.js';
import { guardDatabase, guardDirectory, hasCode, MAX_RECORD_BYTES, readRegular, StorageError } from '../storage/files.js';
import type { AcceptedDistributionRelease, ReleaseScope, ReleaseState, ReleaseStateStore } from './release-source.js';
import { assertDistributionJournalTransition, parseDistributionJournal, parseDistributionReceipt } from './transaction-record.js';
import type { JournalRepository, ReceiptRepository, TransactionEnvelope } from './transaction-record.js';

const DATABASE_NAME = 'distribution.sqlite';
const APPLICATION_ID = 0x4f554450;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
type FileIdentity = { dev: bigint; ino: bigint };
function state(value: unknown): ReleaseState {
  if (!exactObject(value, ['sequence', 'releaseSha256']) || typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || typeof value.releaseSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.releaseSha256)) throw new StorageError('INVALID_RECORD');
  return { sequence: value.sequence, releaseSha256: value.releaseSha256 };
}
function scope(value: ReleaseScope): void {
  if (!exactObject(value, ['sourceId', 'packageId']) || typeof value.sourceId !== 'string' || !IDENTIFIER.test(value.sourceId)
    || typeof value.packageId !== 'string' || !IDENTIFIER.test(value.packageId)) throw new StorageError('INVALID_RECORD');
}
function id(value: string): void { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new StorageError('INVALID_RECORD'); }
function serialize(value: unknown): string {
  const text = JSON.stringify(value); if (Buffer.byteLength(text) > MAX_RECORD_BYTES) throw new StorageError('INVALID_RECORD'); return text;
}

/** Independent private ledger. It never imports game-directory receipt claims or supplies an execution endpoint. */
export class DistributionStore implements ReleaseStateStore {
  private closed = false;
  private closing: Promise<void> | undefined;
  private constructor(private readonly root: string, private readonly file: string, private readonly identity: FileIdentity,
    private readonly owner: OwnerGuard, private readonly database: DatabaseSync, private readonly recoveryCandidates: Set<string>) {}

  /** Requires a dedicated ordinary metadata directory; unknown databases and legacy owner evidence stop writes. */
  static async open(directory: string): Promise<DistributionStore> {
    const root = await guardDirectory(directory);
    const allowed = (name: string): boolean => name === 'owner.lock' || isOwnerGuardFile(name) || [DATABASE_NAME, `${DATABASE_NAME}-journal`, `${DATABASE_NAME}-wal`, `${DATABASE_NAME}-shm`].includes(name);
    if ((await readdir(root)).some(name => !allowed(name))) throw new StorageError('NEEDS_RECOVERY');
    const owner = await OwnerGuard.acquire(root); const file = path.join(root, DATABASE_NAME); let database: DatabaseSync | undefined;
    try {
      let exists = await guardDatabase(file);
      if (!exists) { try { const handle = await open(file, 'wx'); await handle.close(); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; exists = true; } }
      const before = await lstat(file, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.ino === 0n) throw new StorageError('UNSAFE_PATH');
      database = new DatabaseSync(file); database.exec('PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON;');
      if (!exists) database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE release_states(source_id TEXT NOT NULL,package_id TEXT NOT NULL,sequence INTEGER NOT NULL,release_sha256 TEXT NOT NULL,PRIMARY KEY(source_id,package_id));
        CREATE TABLE journals(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
        CREATE TABLE receipts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
        CREATE TABLE accepted_releases(source_id TEXT NOT NULL,package_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(source_id,package_id));
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1; COMMIT;`);
      if (database.prepare('PRAGMA application_id').get()?.application_id !== APPLICATION_ID || database.prepare('PRAGMA user_version').get()?.user_version !== 1
        || database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new StorageError('NEEDS_RECOVERY');
      const rows = database.prepare('SELECT id,data FROM journals LIMIT 1025').all();
      if (rows.length > 1024) throw new StorageError('NEEDS_RECOVERY');
      const recoverable = new Set<string>();
      for (const row of rows) {
        if (typeof row.id !== 'string' || typeof row.data !== 'string' || Buffer.byteLength(row.data) > MAX_RECORD_BYTES) throw new StorageError('NEEDS_RECOVERY');
        const journal = parseDistributionJournal(JSON.parse(row.data) as unknown); if (journal.plan.txId !== row.id) throw new StorageError('NEEDS_RECOVERY');
        // A terminal journal may still own a lock if the predecessor died just before releasing it.
        recoverable.add(row.id);
      }
      const store = new DistributionStore(root, file, { dev: before.dev, ino: before.ino }, owner, database, recoverable);
      await store.verify(); return store;
    } catch (error) {
      try { database?.close(); } finally { await owner.close(); }
      throw error instanceof StorageError ? error : new StorageError('NEEDS_RECOVERY');
    }
  }

  private async verify(): Promise<void> {
    try {
      if (this.closed) throw new StorageError('STORAGE_IO'); await guardDirectory(this.root);
      const info = await lstat(this.file, { bigint: true });
      if (this.closed || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.dev !== this.identity.dev || info.ino !== this.identity.ino
        || (await readRegular(path.join(this.root, 'owner.lock'), 200))?.toString('utf8') !== this.owner.token) throw new StorageError('NEEDS_RECOVERY');
      if (this.closed) throw new StorageError('STORAGE_IO');
    } catch (error) { throw error instanceof StorageError ? error : new StorageError('NEEDS_RECOVERY'); }
  }
  private sql<T>(operation: () => T): T {
    try { return operation(); } catch (error) { throw error instanceof StorageError ? error : new StorageError('NEEDS_RECOVERY'); }
  }
  private current(scopeValue: ReleaseScope): ReleaseState | undefined {
    const row = this.sql(() => this.database.prepare('SELECT sequence,release_sha256 FROM release_states WHERE source_id=? AND package_id=?').get(scopeValue.sourceId, scopeValue.packageId));
    return row ? state({ sequence: row.sequence, releaseSha256: row.release_sha256 }) : undefined;
  }
  async read(scopeValue: ReleaseScope): Promise<ReleaseState | undefined> { scope(scopeValue); await this.verify(); return this.current(scopeValue); }
  /** Same-state CAS is intentional: it linearizes idempotent acceptance against concurrent higher sequences. */
  async compareAndSet(scopeValue: ReleaseScope, expected: ReleaseState | undefined, next: ReleaseState): Promise<boolean> {
    scope(scopeValue); const valid = state(next); if (expected !== undefined) state(expected); await this.verify();
    this.sql(() => this.database.exec('BEGIN IMMEDIATE'));
    try {
      const current = this.current(scopeValue);
      if (current?.sequence !== expected?.sequence || current?.releaseSha256 !== expected?.releaseSha256) { this.database.exec('ROLLBACK'); return false; }
      if (current && (valid.sequence < current.sequence || valid.sequence === current.sequence && valid.releaseSha256 !== current.releaseSha256)) throw new StorageError('INVALID_RECORD');
      this.database.prepare('INSERT INTO release_states VALUES(?,?,?,?) ON CONFLICT(source_id,package_id) DO UPDATE SET sequence=excluded.sequence,release_sha256=excluded.release_sha256')
        .run(scopeValue.sourceId, scopeValue.packageId, valid.sequence, valid.releaseSha256);
      this.database.exec('COMMIT'); return true;
    } catch (error) { this.database.exec('ROLLBACK'); throw error instanceof StorageError ? error : new StorageError('STORAGE_IO'); }
  }
  /** Archive only bytes whose canonical hash already matches the authenticated high-water mark. */
  async saveAcceptedRelease(value: AcceptedDistributionRelease): Promise<void> {
    const envelope = parseDistributionReleaseEnvelope(value.envelope);
    const releaseSha256 = createHash('sha256').update(canonicalDistributionReleasePayload(envelope.payload)).digest('hex');
    if (releaseSha256 !== value.releaseSha256) throw new StorageError('INVALID_RECORD');
    const scopeValue = { sourceId: envelope.payload.sourceId, packageId: envelope.payload.packageId };
    await this.verify(); this.sql(() => this.database.exec('BEGIN IMMEDIATE'));
    try {
      const highest = this.current(scopeValue);
      if (!highest || highest.sequence !== envelope.payload.sequence || highest.releaseSha256 !== releaseSha256) throw new StorageError('REVISION_CONFLICT');
      this.database.prepare('INSERT INTO accepted_releases VALUES(?,?,?) ON CONFLICT(source_id,package_id) DO UPDATE SET data=excluded.data')
        .run(scopeValue.sourceId, scopeValue.packageId, serialize({ envelope, releaseSha256 }));
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error instanceof StorageError ? error : new StorageError('STORAGE_IO'); }
  }
  /** Fresh authority binding for an executor. Stale archives do not follow a newer high-water mark. */
  async readAcceptedRelease(scopeValue: ReleaseScope): Promise<AcceptedDistributionRelease | undefined> {
    scope(scopeValue); await this.verify();
    try {
      const row = this.database.prepare('SELECT data FROM accepted_releases WHERE source_id=? AND package_id=?').get(scopeValue.sourceId, scopeValue.packageId);
      if (!row) return;
      if (typeof row.data !== 'string' || Buffer.byteLength(row.data) > MAX_RECORD_BYTES) throw new Error();
      const raw: unknown = JSON.parse(row.data);
      if (!exactObject(raw, ['envelope', 'releaseSha256'])) throw new Error();
      const envelope = parseDistributionReleaseEnvelope(raw.envelope);
      const releaseSha256 = createHash('sha256').update(canonicalDistributionReleasePayload(envelope.payload)).digest('hex');
      if (releaseSha256 !== raw.releaseSha256 || envelope.payload.sourceId !== scopeValue.sourceId || envelope.payload.packageId !== scopeValue.packageId) throw new Error();
      const highest = this.current(scopeValue);
      if (!highest || highest.sequence !== envelope.payload.sequence || highest.releaseSha256 !== releaseSha256) return;
      return { envelope, releaseSha256 };
    } catch { throw new StorageError('NEEDS_RECOVERY'); }
  }
  private record<T>(table: 'journals' | 'receipts', recordId: string, parse: (value: unknown) => T): TransactionEnvelope<T> | undefined {
    const row = this.sql(() => this.database.prepare(`SELECT revision,data FROM ${table} WHERE id=?`).get(recordId));
    if (!row) return;
    if (typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.data !== 'string' || Buffer.byteLength(row.data) > MAX_RECORD_BYTES) throw new StorageError('NEEDS_RECOVERY');
    try { return { revision: row.revision, data: parse(JSON.parse(row.data) as unknown) }; } catch { throw new StorageError('NEEDS_RECOVERY'); }
  }
  private async write<T>(table: 'journals' | 'receipts', recordId: string, expected: number, value: T, parse: (value: unknown) => T): Promise<TransactionEnvelope<T>> {
    id(recordId); if (!Number.isSafeInteger(expected) || expected < 0 || expected === Number.MAX_SAFE_INTEGER) throw new StorageError('INVALID_RECORD');
    const data = parse(value); const text = serialize(data); await this.verify(); this.sql(() => this.database.exec('BEGIN IMMEDIATE'));
    try {
      const current = this.record(table, recordId, parse);
      if ((current?.revision ?? 0) !== expected) throw new StorageError('REVISION_CONFLICT');
      if (table === 'journals') assertDistributionJournalTransition(current ? parseDistributionJournal(current.data) : undefined, parseDistributionJournal(data));
      if (table === 'receipts') {
        const receipt = parseDistributionReceipt(data);
        const journal = this.record('journals', receipt.txId, parseDistributionJournal);
        if (!journal) throw new StorageError('INVALID_RECORD');
        if (journal) {
          const plan = journal.data.plan;
          if (journal.data.phase !== 'applying' || journal.data.beforeReceiptRevision !== expected || serialize(journal.data.afterReceipt) !== text) throw new StorageError('INVALID_RECORD');
          const highest = this.current({ sourceId: plan.sourceId, packageId: plan.packageId });
          const acceptedRow = this.database.prepare('SELECT data FROM accepted_releases WHERE source_id=? AND package_id=?').get(plan.sourceId, plan.packageId);
          if (!highest || highest.sequence !== plan.sequence || typeof acceptedRow?.data !== 'string') throw new StorageError('REVISION_CONFLICT');
          const accepted: unknown = JSON.parse(acceptedRow.data);
          if (!exactObject(accepted, ['envelope', 'releaseSha256'])) throw new StorageError('NEEDS_RECOVERY');
          const envelope = parseDistributionReleaseEnvelope(accepted.envelope);
          const hash = createHash('sha256').update(canonicalDistributionReleasePayload(envelope.payload)).digest('hex');
          if (hash !== highest.releaseSha256 || accepted.releaseSha256 !== hash || envelope.payload.sourceId !== plan.sourceId || envelope.payload.packageId !== plan.packageId
            || envelope.payload.packageVersion !== plan.packageVersion || envelope.payload.sequence !== plan.sequence || envelope.payload.manifestSha256 !== plan.manifestSha256) throw new StorageError('REVISION_CONFLICT');
        }
      }
      this.database.prepare(`INSERT INTO ${table}(id,revision,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data`).run(recordId, expected + 1, text);
      this.database.exec('COMMIT'); return { revision: expected + 1, data };
    } catch (error) { this.database.exec('ROLLBACK'); throw error instanceof StorageError ? error : new StorageError('STORAGE_IO'); }
  }
  /** Typed authority ports; neither accepts a game-directory path or renderer observation. */
  get journals(): JournalRepository {
    return { read: async txId => { id(txId); await this.verify(); const value = this.record('journals', txId, parseDistributionJournal);
      if (value && value.data.plan.txId !== txId) throw new StorageError('NEEDS_RECOVERY'); return value; },
    write: (txId, revision, value) => { if (value.plan.txId !== txId) throw new StorageError('INVALID_RECORD'); return this.write('journals', txId, revision, value, parseDistributionJournal); } };
  }
  get receipts(): ReceiptRepository {
    return { read: async instanceId => { id(instanceId); await this.verify(); const value = this.record('receipts', instanceId, parseDistributionReceipt);
      if (value && value.data.instanceId !== instanceId) throw new StorageError('NEEDS_RECOVERY'); return value; },
    commit: (instanceId, revision, value) => { if (value.instanceId !== instanceId) throw new StorageError('INVALID_RECORD'); return this.write('receipts', instanceId, revision, value, parseDistributionReceipt); } };
  }
  /** Only journals discovered when this exclusively owned store was opened can represent a dead predecessor. */
  async canRecover(txId: string, leaseToken: string): Promise<boolean> {
    id(txId); if (!this.recoveryCandidates.has(txId)) return false;
    const saved = await this.journals.read(txId); return saved?.data.leaseToken === leaseToken;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (this.closed) return;
      await this.verify(); this.closed = true;
      try { this.database.close(); await this.owner.close(); }
      catch (error) { throw error instanceof StorageError ? error : new StorageError('STORAGE_IO'); }
    })();
    return this.closing;
  }
}
