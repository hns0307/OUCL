import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { exactObject, UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { MAX_RECORD_BYTES, StorageError } from '../storage/files.js';
import { parseDistributionPlan, transactionDigest } from './transaction-record.js';
import type { DirectoryProof, DistributionPlan } from './transaction-record.js';

export interface AdmissionIntent {
  confirmRequestId: string; proposalId: string; plan: DistributionPlan; releaseSha256: string;
  gameIdentity: DirectoryProof; previewFingerprint: string;
}
interface AdmissionData {
  formatVersion: 1; proposalId: string; taskId: string; inputDigest: string; plan: DistributionPlan;
  releaseSha256: string; gameIdentity: DirectoryProof; previewFingerprint: string;
}
export interface AdmissionRecord extends AdmissionData { phase: 'accepted' | 'projected'; revision: 1 | 2 }
export interface AdmissionRepository {
  admit(intent: AdmissionIntent): Promise<AdmissionRecord>;
  bindReceiptAlias(expectedRootId: string, confirmRequestId: string, proposalId: string, inputDigest: string): Promise<AdmissionRecord>;
  readByRequest(confirmRequestId: string): Promise<AdmissionRecord | undefined>;
  readByProposal(proposalId: string): Promise<AdmissionRecord | undefined>;
  listPending(limit?: number): Promise<AdmissionRecord[]>;
  listAll(): Promise<AdmissionRecord[]>;
  markProjected(proposalId: string, taskId: string): Promise<AdmissionRecord>;
}
const MAX_ADMISSIONS = 1024;
const MAX_ALIASES = 4096;
export const MAX_ADMISSION_TOTAL_BYTES = 16 * 1024 * 1024;
function reject(code: 'INVALID_RECORD' | 'REVISION_CONFLICT' | 'NEEDS_RECOVERY' = 'INVALID_RECORD'): never { throw new StorageError(code); }
function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value) || value !== value.toLowerCase()) reject();
}
function hash(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) reject(); }
function identity(value: unknown): DirectoryProof {
  if (!exactObject(value, ['dev', 'ino']) || typeof value.dev !== 'string' || !/^\d{1,30}$/.test(value.dev)
    || typeof value.ino !== 'string' || !/^[1-9]\d{0,29}$/.test(value.ino)) reject();
  return { dev: value.dev, ino: value.ino };
}
function canonicalInput(value: Omit<AdmissionIntent, 'confirmRequestId'>): Omit<AdmissionIntent, 'confirmRequestId'> {
  uuid(value.proposalId); hash(value.releaseSha256); hash(value.previewFingerprint);
  const plan = parseDistributionPlan(structuredClone(value.plan));
  if (plan.txId !== value.proposalId) reject();
  return { proposalId: value.proposalId, plan, releaseSha256: value.releaseSha256,
    gameIdentity: identity(value.gameIdentity), previewFingerprint: value.previewFingerprint };
}
function intent(value: AdmissionIntent): AdmissionIntent {
  try {
    if (!exactObject(value, ['confirmRequestId', 'proposalId', 'plan', 'releaseSha256', 'gameIdentity', 'previewFingerprint'])) reject();
    uuid(value.confirmRequestId);
    return { confirmRequestId: value.confirmRequestId, ...canonicalInput(value) };
  } catch { return reject(); }
}
function serialize(value: unknown): string {
  const text = JSON.stringify(value); if (Buffer.byteLength(text) > MAX_RECORD_BYTES) reject(); return text;
}
function parseData(value: unknown): AdmissionData {
  if (!exactObject(value, ['formatVersion', 'proposalId', 'taskId', 'inputDigest', 'plan', 'releaseSha256', 'gameIdentity', 'previewFingerprint'])
    || value.formatVersion !== 1) reject();
  uuid(value.taskId); hash(value.inputDigest);
  uuid(value.proposalId); hash(value.releaseSha256); hash(value.previewFingerprint);
  const input = canonicalInput({ proposalId: value.proposalId, plan: parseDistributionPlan(value.plan),
    releaseSha256: value.releaseSha256, gameIdentity: identity(value.gameIdentity), previewFingerprint: value.previewFingerprint });
  if (transactionDigest(input) !== value.inputDigest) reject();
  return { formatVersion: 1, ...input, taskId: value.taskId, inputDigest: value.inputDigest };
}

/** Strict detached authority record parser for internal ports and reconciliation read-back. */
export function parseAdmissionRecord(value: unknown): AdmissionRecord {
  if (!exactObject(value, ['formatVersion', 'proposalId', 'taskId', 'inputDigest', 'plan', 'releaseSha256', 'gameIdentity', 'previewFingerprint', 'phase', 'revision'])
    || !(value.phase === 'accepted' && value.revision === 1 || value.phase === 'projected' && value.revision === 2)) reject();
  const { phase, revision, ...data } = value;
  try { return { ...parseData(data), phase, revision }; } catch { return reject(); }
}

const columns: Record<string, string[]> = {
  release_states: ['source_id:TEXT:1:1', 'package_id:TEXT:1:2', 'sequence:INTEGER:1:0', 'release_sha256:TEXT:1:0'],
  journals: ['id:TEXT:0:1', 'revision:INTEGER:1:0', 'data:TEXT:1:0'],
  receipts: ['id:TEXT:0:1', 'revision:INTEGER:1:0', 'data:TEXT:1:0'],
  accepted_releases: ['source_id:TEXT:1:1', 'package_id:TEXT:1:2', 'data:TEXT:1:0'],
  admissions: ['proposal_id:TEXT:1:1', 'task_id:TEXT:1:0', 'input_digest:TEXT:1:0', 'data:TEXT:1:0'],
  admission_aliases: ['request_id:TEXT:1:1', 'proposal_id:TEXT:1:0'],
  admission_outbox: ['proposal_id:TEXT:1:1', 'task_id:TEXT:1:0', 'revision:INTEGER:1:0', 'phase:TEXT:1:0'],
};
function schema(database: DatabaseSync, version: number): void {
  const expected = Object.keys(columns).slice(0, version === 1 ? 4 : 7).sort();
  const objects = database.prepare("SELECT type,name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','trigger','view') ORDER BY name").all();
  if (objects.some(row => row.type !== 'table') || JSON.stringify(objects.map(row => row.name)) !== JSON.stringify(expected)) reject('NEEDS_RECOVERY');
  for (const name of expected) {
    const actual = database.prepare(`PRAGMA table_info(${name})`).all().map(row => `${row.name}:${row.type}:${row.notnull}:${row.pk}`);
    if (JSON.stringify(actual) !== JSON.stringify(columns[name])) reject('NEEDS_RECOVERY');
    const keys = database.prepare(`PRAGMA index_list(${name})`).all().map(row => {
      if (row.unique !== 1 || typeof row.name !== 'string' || !/^sqlite_autoindex_[a-z_]+_\d+$/.test(row.name)) return reject('NEEDS_RECOVERY');
      return database.prepare(`PRAGMA index_info(${row.name})`).all().map(column => column.name).join(',');
    }).sort();
    const required = name === 'admissions' ? ['proposal_id', 'task_id'] : name === 'admission_outbox' ? ['proposal_id', 'task_id']
      : name === 'admission_aliases' ? ['request_id'] : name === 'journals' || name === 'receipts' ? ['id'] : ['source_id,package_id'];
    if (JSON.stringify(keys) !== JSON.stringify(required.sort())) reject('NEEDS_RECOVERY');
    const foreign = database.prepare(`PRAGMA foreign_key_list(${name})`).all();
    if (name === 'admission_aliases' || name === 'admission_outbox') {
      if (foreign.length !== 1 || foreign[0]?.table !== 'admissions' || foreign[0]?.from !== 'proposal_id' || foreign[0]?.to !== 'proposal_id') reject('NEEDS_RECOVERY');
    } else if (foreign.length) reject('NEEDS_RECOVERY');
  }
}
/** Atomic additive migration; unknown schemas are never repaired by guessing or dropping historical tables. */
export function initializeAdmissionSchema(database: DatabaseSync): void {
  const version = database.prepare('PRAGMA user_version').get()?.user_version;
  if (version !== 1 && version !== 2) reject('NEEDS_RECOVERY');
  schema(database, version);
  if (version === 1) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`CREATE TABLE admissions(proposal_id TEXT NOT NULL PRIMARY KEY,task_id TEXT NOT NULL UNIQUE,input_digest TEXT NOT NULL,data TEXT NOT NULL);
        CREATE TABLE admission_aliases(request_id TEXT NOT NULL PRIMARY KEY,proposal_id TEXT NOT NULL REFERENCES admissions(proposal_id));
        CREATE TABLE admission_outbox(proposal_id TEXT NOT NULL PRIMARY KEY REFERENCES admissions(proposal_id),task_id TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL,phase TEXT NOT NULL);
        PRAGMA user_version=2; COMMIT;`);
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  schema(database, 2);
  if (database.prepare('PRAGMA foreign_key_check').get()) reject('NEEDS_RECOVERY');
}

/** Private confirmation/outbox repository. It only records acceptance, never runs or projects a task. */
export class SqliteAdmissionRepository implements AdmissionRepository {
  constructor(private readonly database: DatabaseSync, private readonly verify: () => Promise<void>,
    private readonly assertAuthority: (value: AdmissionIntent) => void) {}

  private totalBytes(): number {
    const bytes = this.database.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM admissions').get()?.bytes;
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) reject('NEEDS_RECOVERY');
    return bytes;
  }

  private record(id: string): AdmissionRecord | undefined {
    const row = this.database.prepare(`SELECT a.proposal_id,a.task_id,a.input_digest,a.data,o.task_id AS out_task,o.phase,o.revision
      FROM admissions a LEFT JOIN admission_outbox o ON o.proposal_id=a.proposal_id WHERE a.proposal_id=?`).get(id);
    if (!row) return;
    try {
      if (typeof row.data !== 'string' || Buffer.byteLength(row.data) > MAX_RECORD_BYTES) reject();
      const data = parseData(JSON.parse(row.data) as unknown);
      if (data.proposalId !== row.proposal_id || data.taskId !== row.task_id || data.taskId !== row.out_task || data.inputDigest !== row.input_digest
        || !(row.phase === 'accepted' && row.revision === 1 || row.phase === 'projected' && row.revision === 2)) reject();
      return parseAdmissionRecord({ ...data, phase: row.phase, revision: row.revision });
    } catch { return reject('NEEDS_RECOVERY'); }
  }

  /** Bounded startup audit detects orphaned/corrupt records before allowing any writes. */
  validateStored(): void {
    if (this.database.prepare('PRAGMA user_version').get()?.user_version !== 2) reject('NEEDS_RECOVERY');
    schema(this.database, 2);
    const rows = this.database.prepare('SELECT proposal_id FROM admissions LIMIT 1025').all();
    const aliases = this.database.prepare('SELECT request_id,proposal_id FROM admission_aliases LIMIT 4097').all();
    const outbox = this.database.prepare('SELECT proposal_id FROM admission_outbox LIMIT 1025').all();
    if (rows.length > MAX_ADMISSIONS || aliases.length > MAX_ALIASES || outbox.length !== rows.length) reject('NEEDS_RECOVERY');
    if (this.totalBytes() > MAX_ADMISSION_TOTAL_BYTES) reject('NEEDS_RECOVERY');
    const ids = new Set<string>();
    for (const row of rows) {
      if (typeof row.proposal_id !== 'string' || !this.record(row.proposal_id)) reject('NEEDS_RECOVERY');
      ids.add(row.proposal_id);
    }
    const referenced = new Set<string>();
    for (const alias of aliases) {
      try { uuid(alias.request_id); uuid(alias.proposal_id); } catch { return reject('NEEDS_RECOVERY'); }
      if (!ids.has(alias.proposal_id)) reject('NEEDS_RECOVERY'); referenced.add(alias.proposal_id);
    }
    for (const id of ids) if (!referenced.has(id)) reject('NEEDS_RECOVERY');
    for (const row of outbox) if (typeof row.proposal_id !== 'string' || !ids.has(row.proposal_id)) reject('NEEDS_RECOVERY');
  }

  private transaction<T>(work: () => T, readOnly = false): T {
    let begun = false;
    try {
      this.database.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE'); begun = true;
      this.validateStored(); const value = work(); this.database.exec('COMMIT'); return value;
    } catch (error) {
      if (begun) { try { this.database.exec('ROLLBACK'); } catch { return reject('NEEDS_RECOVERY'); } }
      throw error instanceof StorageError ? error : new StorageError('NEEDS_RECOVERY');
    }
  }

  async admit(raw: AdmissionIntent): Promise<AdmissionRecord> {
    const value = intent(raw); const input = canonicalInput(value); const digest = transactionDigest(input);
    await this.verify();
    return this.transaction(() => {
      const alias = this.database.prepare('SELECT proposal_id FROM admission_aliases WHERE request_id=?').get(value.confirmRequestId);
      if (alias && alias.proposal_id !== value.proposalId) reject('REVISION_CONFLICT');
      let record = this.record(value.proposalId);
      if (record && record.inputDigest !== digest) reject('REVISION_CONFLICT');
      // Existing receipt lookup is not a fresh execution grant and survives later publisher updates.
      if (alias && record) return record;
      this.assertAuthority(value);
      if (!record) {
        const count = this.database.prepare('SELECT COUNT(*) AS n FROM admissions').get()?.n;
        if (typeof count !== 'number' || count >= MAX_ADMISSIONS) reject('REVISION_CONFLICT');
        const data: AdmissionData = { formatVersion: 1, ...input, taskId: randomUUID(), inputDigest: digest };
        const text = serialize(data);
        if (this.totalBytes() + Buffer.byteLength(text) > MAX_ADMISSION_TOTAL_BYTES) reject('REVISION_CONFLICT');
        this.database.prepare('INSERT INTO admissions VALUES(?,?,?,?)').run(value.proposalId, data.taskId, digest, text);
        this.database.prepare("INSERT INTO admission_outbox VALUES(?,?,1,'accepted')").run(value.proposalId, data.taskId);
        record = { ...data, phase: 'accepted', revision: 1 };
      }
      if (!alias) {
        const count = this.database.prepare('SELECT COUNT(*) AS n FROM admission_aliases').get()?.n;
        if (typeof count !== 'number' || count >= MAX_ALIASES) reject('REVISION_CONFLICT');
        this.database.prepare('INSERT INTO admission_aliases VALUES(?,?)').run(value.confirmRequestId, value.proposalId);
      }
      return record;
    });
  }

  /** Binds an existing receipt only. It never accepts a new plan, creates an outbox, or grants execution. */
  async bindReceiptAlias(expectedRootId: string, requestId: string, proposalId: string, inputDigest: string): Promise<AdmissionRecord> {
    uuid(expectedRootId); uuid(requestId); uuid(proposalId); hash(inputDigest); await this.verify();
    return this.transaction(() => {
      const record = this.record(proposalId);
      if (!record || record.plan.rootId !== expectedRootId || record.inputDigest !== inputDigest) reject('REVISION_CONFLICT');
      const alias = this.database.prepare('SELECT proposal_id FROM admission_aliases WHERE request_id=?').get(requestId);
      if (alias && alias.proposal_id !== proposalId) reject('REVISION_CONFLICT');
      if (!alias) {
        const count = this.database.prepare('SELECT COUNT(*) AS n FROM admission_aliases').get()?.n;
        if (typeof count !== 'number' || count >= MAX_ALIASES) reject('REVISION_CONFLICT');
        this.database.prepare('INSERT INTO admission_aliases VALUES(?,?)').run(requestId, proposalId);
      }
      return record;
    });
  }

  async readByRequest(requestId: string): Promise<AdmissionRecord | undefined> {
    uuid(requestId); await this.verify();
    try {
      this.validateStored();
      const alias = this.database.prepare('SELECT proposal_id FROM admission_aliases WHERE request_id=?').get(requestId);
      if (!alias) return;
      if (typeof alias.proposal_id !== 'string') reject('NEEDS_RECOVERY');
      return this.record(alias.proposal_id);
    } catch (error) { throw error instanceof StorageError ? error : new StorageError('NEEDS_RECOVERY'); }
  }
  async readByProposal(proposalId: string): Promise<AdmissionRecord | undefined> {
    uuid(proposalId); await this.verify();
    try { this.validateStored(); return this.record(proposalId); }
    catch (error) { throw error instanceof StorageError ? error : new StorageError('NEEDS_RECOVERY'); }
  }
  async listPending(limit = 100): Promise<AdmissionRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ADMISSIONS) reject();
    await this.verify();
    try {
      this.validateStored();
      return this.database.prepare("SELECT proposal_id FROM admission_outbox WHERE phase='accepted' ORDER BY proposal_id LIMIT ?").all(limit)
        .map(row => { if (typeof row.proposal_id !== 'string') return reject('NEEDS_RECOVERY'); return this.record(row.proposal_id)!; });
    } catch (error) { throw error instanceof StorageError ? error : new StorageError('NEEDS_RECOVERY'); }
  }
  /** Complete bounded authority snapshot for reconciliation; accepted and projected are both retained. */
  async listAll(): Promise<AdmissionRecord[]> {
    await this.verify();
    return this.transaction(() => this.database.prepare('SELECT proposal_id FROM admissions ORDER BY proposal_id').all()
      .map(row => {
        if (typeof row.proposal_id !== 'string') return reject('NEEDS_RECOVERY');
        const value = this.record(row.proposal_id);
        if (!value) return reject('NEEDS_RECOVERY');
        return value;
      }), true);
  }
  async markProjected(proposalId: string, taskId: string): Promise<AdmissionRecord> {
    uuid(proposalId); uuid(taskId); await this.verify();
    return this.transaction(() => {
      const record = this.record(proposalId);
      if (!record || record.taskId !== taskId) reject('REVISION_CONFLICT');
      if (record.phase === 'accepted') this.database.prepare("UPDATE admission_outbox SET revision=2,phase='projected' WHERE proposal_id=? AND task_id=? AND revision=1 AND phase='accepted'").run(proposalId, taskId);
      return this.record(proposalId)!;
    });
  }
}
