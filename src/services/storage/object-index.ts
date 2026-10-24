import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { guardDatabase, StorageError } from './files.js';

export interface IndexedObject { digest: string; size: number }
/** Disposable search hints only: provenance sidecars and verified object bytes remain authoritative. */
export class ObjectIndex {
  private constructor(private readonly db: DatabaseSync) {}
  /** Opens a separate cache database, never the task/recovery database. Call under the store lease. */
  static async open(directory: string): Promise<ObjectIndex> {
    const file = path.join(directory, 'objects-index.sqlite');
    const exists = await guardDatabase(file);
    const db = new DatabaseSync(file);
    try {
      if (exists && (db.prepare('PRAGMA application_id').get()?.application_id !== 0x4f554349
        || db.prepare('PRAGMA user_version').get()?.user_version !== 1
        || db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')) throw new StorageError('NEEDS_RECOVERY');
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      if (!exists) db.exec('BEGIN IMMEDIATE; CREATE TABLE objects (source_key TEXT PRIMARY KEY, digest TEXT NOT NULL, size INTEGER NOT NULL); PRAGMA application_id=1330987849; PRAGMA user_version=1; COMMIT;');
      return new ObjectIndex(db);
    } catch { db.close(); throw new StorageError('NEEDS_RECOVERY'); }
  }
  /** Looks up an untrusted hint; the consumer must verify sidecar and bytes. */
  lookup(sourceKey: string): IndexedObject | undefined {
    const row = this.db.prepare('SELECT digest, size FROM objects WHERE source_key=?').get(sourceKey);
    if (!row) return undefined;
    if (typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest) || typeof row.size !== 'number'
      || !Number.isSafeInteger(row.size) || row.size < 0) throw new StorageError('NEEDS_RECOVERY');
    return { digest: row.digest, size: row.size };
  }
  /** Records a verified hint; does not grant provenance or create object references. */
  remember(sourceKey: string, object: IndexedObject): void {
    this.db.prepare('INSERT INTO objects VALUES (?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET digest=excluded.digest,size=excluded.size')
      .run(sourceKey, object.digest, object.size);
  }
  /** Clears only this cache's rows, never operations, accepted requests or task state. */
  clear(): void { this.db.exec('DELETE FROM objects'); }
  /** Releases the separate cache handle before releasing the enclosing repository lease. */
  close(): void { this.db.close(); }
}
