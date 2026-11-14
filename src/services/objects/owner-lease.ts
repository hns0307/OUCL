import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { lstat, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { guardDirectory, hasCode, readRegular } from '../storage/files.js';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { ObjectError } from './provenance.js';

const MARKER_NAME = 'objects.owner.lock';
const GUARD_NAME = 'objects.owner.guard.sqlite';
const APPLICATION_ID = 0x4f554f47;
const DOMAIN = 'oucl.object-store.v1';
const PREFIX = 'oucl-object-owner-v1:';
const MARKER = /^oucl-object-owner-v1:([a-f0-9-]{36}):(\d+):(\d+):(\d+):(\d+)$/;
const SIDECARS = ['-journal', '-wal', '-shm'] as const;
interface Identity { dev: bigint; ino: bigint }
interface Marker { text: string; identity: Identity }

async function identity(file: string, directory = false): Promise<Identity> {
  const info = await lstat(file, { bigint: true });
  if (info.isSymbolicLink() || info.ino === 0n || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n)) throw new ObjectError('NEEDS_RECOVERY');
  return { dev: info.dev, ino: info.ino };
}
function same(left: Identity, right: Identity): boolean { return left.dev === right.dev && left.ino === right.ino; }
async function present(file: string): Promise<boolean> {
  try { await identity(file); return true; } catch (error) { if (hasCode(error, 'ENOENT')) return false; throw error; }
}
async function marker(file: string): Promise<Marker | undefined> {
  let before: Identity;
  try { before = await identity(file); } catch (error) { if (hasCode(error, 'ENOENT')) return undefined; throw error; }
  const bytes = await readRegular(file, 512);
  if (!bytes || !same(before, await identity(file))) throw new ObjectError('NEEDS_RECOVERY');
  return { text: bytes.toString('utf8'), identity: before };
}
function accepted(value: string): void {
  const match = MARKER.exec(value);
  if (!match || !UUID_PATTERN.test(match[1]!)) throw new ObjectError(value.startsWith(PREFIX) ? 'NEEDS_RECOVERY' : 'STORE_BUSY');
}
function failure(error: unknown): ObjectError {
  if (error instanceof ObjectError) return error;
  if (typeof error === 'object' && error !== null && 'errcode' in error && typeof error.errcode === 'number' && (error.errcode & 0xff) === 5) return new ObjectError('STORE_BUSY');
  return new ObjectError('NEEDS_RECOVERY');
}
function combined(error: unknown, cleanup: unknown): ObjectError {
  return Object.assign(new ObjectError('NEEDS_RECOVERY'), { cause: new AggregateError([error, cleanup], 'OBJECT_LEASE_CLEANUP_FAILED') });
}

/** Object-root ownership only. Metadata ownership never authorizes taking this lease. */
export class ObjectOwnerLease {
  private invalid = false;
  private closed = false;
  private constructor(private readonly root: string, private readonly rootIdentity: Identity, private readonly owned: Marker,
    private db?: DatabaseSync, private readonly guardIdentity?: Identity, private readonly guardId?: string) {}

  /** Windows reclaims only identity-bound object markers after obtaining the same OS lock; other platforms keep UUID exclusion. */
  static async acquire(root: string): Promise<ObjectOwnerLease> {
    try { return await ObjectOwnerLease.acquireRoot(root); } catch (error) { throw failure(error); }
  }

  private static async acquireRoot(root: string): Promise<ObjectOwnerLease> {
    const canonical = await guardDirectory(root); const rootIdentity = await identity(canonical, true);
    const markerPath = path.join(canonical, MARKER_NAME);
    if (process.platform !== 'win32') {
      const token = randomUUID(); let handle;
      try { handle = await open(markerPath, 'wx'); }
      catch (error) { throw new ObjectError(hasCode(error, 'EEXIST') ? 'STORE_BUSY' : 'OBJECT_IO'); }
      try { await handle.writeFile(token); await handle.sync(); } finally { await handle.close(); }
      const owned = await marker(markerPath);
      if (!owned || owned.text !== token) throw new ObjectError('NEEDS_RECOVERY');
      return new ObjectOwnerLease(canonical, rootIdentity, owned);
    }
    const prior = await marker(markerPath); if (prior) accepted(prior.text);
    const file = path.join(canonical, GUARD_NAME); let exists = await present(file);
    for (const suffix of SIDECARS) {
      if (await present(file + suffix)) throw new ObjectError('NEEDS_RECOVERY');
    }
    if (!exists && prior) throw new ObjectError('NEEDS_RECOVERY');
    if (!exists) {
      try { const handle = await open(file, 'wx'); await handle.close(); }
      catch (error) { if (!hasCode(error, 'EEXIST')) throw error; exists = true; }
    }
    const before = await identity(file); let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(file); db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE;');
      if (!same(before, await identity(file)) || !same(rootIdentity, await identity(canonical, true))) throw new ObjectError('NEEDS_RECOVERY');
      if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'delete') throw new ObjectError('NEEDS_RECOVERY');
      if (!exists) {
        db.exec('CREATE TABLE object_owner (id TEXT NOT NULL, domain TEXT NOT NULL);');
        db.prepare('INSERT INTO object_owner VALUES (?, ?)').run(randomUUID(), DOMAIN);
        db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1; COMMIT; BEGIN IMMEDIATE;`);
      }
      if (db.prepare('PRAGMA application_id').get()?.application_id !== APPLICATION_ID || db.prepare('PRAGMA user_version').get()?.user_version !== 1
        || db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new ObjectError('NEEDS_RECOVERY');
      const schema = db.prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
      if (schema.length !== 1 || schema[0]?.type !== 'table' || schema[0]?.name !== 'object_owner') throw new ObjectError('NEEDS_RECOVERY');
      const rows = db.prepare('SELECT id, domain FROM object_owner').all(); const id = rows[0]?.id;
      if (rows.length !== 1 || typeof id !== 'string' || !UUID_PATTERN.test(id) || rows[0]?.domain !== DOMAIN) throw new ObjectError('NEEDS_RECOVERY');
      const text = `${PREFIX}${id}:${before.dev}:${before.ino}:${rootIdentity.dev}:${rootIdentity.ino}`;
      let current = await marker(markerPath);
      if (current) { accepted(current.text); if (current.text !== text) throw new ObjectError('NEEDS_RECOVERY'); }
      else {
        let handle;
        try { handle = await open(markerPath, 'wx'); }
        catch (error) { throw new ObjectError(hasCode(error, 'EEXIST') ? 'STORE_BUSY' : 'OBJECT_IO'); }
        try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
        current = await marker(markerPath);
      }
      if (!current || current.text !== text) throw new ObjectError('NEEDS_RECOVERY');
      const lease = new ObjectOwnerLease(canonical, rootIdentity, current, db, before, id);
      await lease.verify(); return lease;
    } catch (error) {
      try { db?.close(); } catch (cleanup) { throw combined(error, cleanup); }
      throw failure(error);
    }
  }

  /** Check before effects and after asynchronous boundaries; once evidence is lost this instance stays invalid. */
  async verify(): Promise<void> {
    if (this.closed || this.invalid) throw new ObjectError('NEEDS_RECOVERY');
    try {
      if (await guardDirectory(this.root) !== this.root || !same(this.rootIdentity, await identity(this.root, true))) throw new ObjectError('NEEDS_RECOVERY');
      const current = await marker(path.join(this.root, MARKER_NAME));
      if (!current || current.text !== this.owned.text || !same(current.identity, this.owned.identity)) throw new ObjectError('NEEDS_RECOVERY');
      if (this.db) {
        const file = path.join(this.root, GUARD_NAME);
        if (!this.guardIdentity || !same(this.guardIdentity, await identity(file))) throw new ObjectError('NEEDS_RECOVERY');
        for (const suffix of SIDECARS) if (await present(file + suffix)) throw new ObjectError('NEEDS_RECOVERY');
        const rows = this.db.prepare('SELECT id, domain FROM object_owner').all();
        if (rows.length !== 1 || rows[0]?.id !== this.guardId || rows[0]?.domain !== DOMAIN) throw new ObjectError('NEEDS_RECOVERY');
      }
    } catch (error) { this.invalid = true; throw error instanceof ObjectError ? error : new ObjectError('NEEDS_RECOVERY'); }
  }

  private release(): void {
    const db = this.db; if (!db) return;
    let rollbackError: unknown;
    try { db.exec('ROLLBACK'); } catch (error) { rollbackError = error; }
    try { db.close(); this.db = undefined; } catch (error) { if (rollbackError) throw combined(rollbackError, error); throw error; }
    if (rollbackError) throw rollbackError;
  }

  /** Caller must first drain all object work. Invalid evidence is preserved, even when the OS handle is released. */
  async close(): Promise<void> {
    if (this.closed) return;
    let original: unknown;
    try { await this.verify(); await unlink(path.join(this.root, MARKER_NAME)); }
    catch (error) { original = error; }
    this.closed = true;
    try { this.release(); } catch (cleanup) { throw original ? combined(original, cleanup) : failure(cleanup); }
    if (original) throw original;
  }
}
