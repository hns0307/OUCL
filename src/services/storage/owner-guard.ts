import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { lstat, open, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { guardDatabase, guardDirectory, hasCode, readRegular, StorageError } from './files.js';

const GUARD_NAME = 'owner.guard.sqlite';
const APPLICATION_ID = 0x4f554347;
const MARKER = /^oucl-owner-v2:([a-f0-9-]{36}):(\d+):(\d+)$/;

/** Main-process lease. Unknown or legacy markers are never removed or adopted. */
export class OwnerGuard {
  private constructor(private readonly db: DatabaseSync, private readonly marker: string,
    private readonly markerPath: string) {}

  static async acquire(directory: string): Promise<OwnerGuard> {
    if (process.platform !== 'win32') throw new StorageError('NEEDS_RECOVERY');
    const root = await guardDirectory(directory);
    const markerPath = path.join(root, 'owner.lock');
    const prior = await readRegular(markerPath, 200);
    if (prior && !MARKER.test(prior.toString('utf8'))) throw new StorageError('STORE_BUSY');
    const file = path.join(root, GUARD_NAME);
    let exists = await guardDatabase(file);
    if (!exists && prior) throw new StorageError('NEEDS_RECOVERY');
    if (!exists && (await readdir(root)).some(name => name !== GUARD_NAME && isOwnerGuardFile(name))) throw new StorageError('NEEDS_RECOVERY');
    if (!exists) {
      try { const handle = await open(file, 'wx'); await handle.close(); }
      catch (error) { if (!hasCode(error, 'EEXIST')) throw new StorageError('STORAGE_IO'); exists = true; }
    }
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.ino === 0n) throw new StorageError('UNSAFE_PATH');
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(file);
      db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE;');
      const after = await lstat(file, { bigint: true });
      if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1n || before.dev !== after.dev || before.ino !== after.ino) throw new StorageError('UNSAFE_PATH');
      if (exists) {
        if (db.prepare('PRAGMA application_id').get()?.application_id !== APPLICATION_ID
          || db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new StorageError('NEEDS_RECOVERY');
      } else {
        db.exec(`CREATE TABLE guard (id TEXT NOT NULL); INSERT INTO guard VALUES ('${randomUUID()}'); PRAGMA application_id=${APPLICATION_ID}; COMMIT; BEGIN IMMEDIATE;`);
      }
      const row = db.prepare('SELECT id FROM guard').all();
      const id = row.length === 1 ? row[0]?.id : undefined;
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new StorageError('NEEDS_RECOVERY');
      const marker = `oucl-owner-v2:${id}:${after.dev}:${after.ino}`;
      const current = await readRegular(markerPath, 200);
      if (current) {
        if (current.toString('utf8') !== marker) throw new StorageError('STORE_BUSY');
      } else {
        let handle;
        try { handle = await open(markerPath, 'wx'); }
        catch (error) { throw new StorageError(hasCode(error, 'EEXIST') ? 'STORE_BUSY' : 'STORAGE_IO'); }
        try { await handle.writeFile(marker); await handle.sync(); } finally { await handle.close(); }
      }
      return new OwnerGuard(db, marker, markerPath);
    } catch (error) {
      try { db?.close(); } catch { /* preserve original failure */ }
      if (error instanceof StorageError) throw error;
      if (typeof error === 'object' && error !== null && 'errcode' in error && typeof error.errcode === 'number' && (error.errcode & 0xff) === 5) throw new StorageError('STORE_BUSY');
      throw new StorageError('NEEDS_RECOVERY');
    }
  }

  /** The worker may use this marker but must not remove it. */
  get token(): string { return this.marker; }

  /** Releases the operating-system lock while preserving recovery evidence. */
  abandon(): void { this.db.exec('ROLLBACK'); this.db.close(); }

  /** Called only after all work and the storage worker have stopped normally. */
  async close(): Promise<void> {
    if ((await readRegular(this.markerPath, 200))?.toString('utf8') !== this.marker) throw new StorageError('NEEDS_RECOVERY');
    await unlink(this.markerPath);
    this.db.exec('ROLLBACK'); this.db.close();
  }
}

/** Guard files are private metadata, not application records. */
export function isOwnerGuardFile(name: string): boolean {
  return [GUARD_NAME, `${GUARD_NAME}-journal`, `${GUARD_NAME}-wal`, `${GUARD_NAME}-shm`].includes(name);
}
