import { DatabaseSync } from 'node:sqlite';
import { readFile, copyFile, lstat, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { digest } from './fixture.mjs';

/** Reads only regular experiment files; does not protect against hostile races. */
async function regularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('UNKNOWN_FILE_TYPE');
  return readFile(file);
}

/** Validates the existing minimal experiment metadata, not a production schema. */
async function manifestAt(root) {
  const value = JSON.parse(await regularFile(path.join(root, 'instance.json')));
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
    || value.schemaVersion !== 1 || ![1, 2].includes(value.revision) || typeof value.hash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.hash)) throw new Error('UNKNOWN_MANIFEST');
  return value;
}

/** Stops on inconsistent evidence, locks before writes, and permits safe replay. */
export async function recover(root, checkpoint = async () => {}) {
  let db;
  let transaction = false;
  try {
    if (!path.basename(root).startsWith('oucl-phase0-') || (await lstat(root)).isSymbolicLink()) return 'needsRecovery';
    await manifestAt(root);
    const journal = path.join(root, 'tasks.sqlite');
    await regularFile(journal); // Missing evidence must not create a new empty database.
    db = new DatabaseSync(journal);
    db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
    transaction = true;
    const manifest = await manifestAt(root);
    const operation = db.prepare('SELECT state FROM operation WHERE id=?').get('op-1');
    if (!operation || !['PREPARED', 'APPLYING', 'COMMITTED', 'ROLLED_BACK'].includes(operation.state)) return 'needsRecovery';
    const entry = path.join(root, 'entry');
    if (manifest.revision === 1) {
      if (operation.state === 'COMMITTED') return 'needsRecovery';
      if (operation.state === 'ROLLED_BACK') return digest(await regularFile(entry)) === manifest.hash ? 'rolledBack' : 'needsRecovery';
      const backup = path.join(root, 'old-backup');
      if (digest(await regularFile(backup)) !== manifest.hash) return 'needsRecovery';
      await regularFile(entry);
      const temporary = path.join(root, 'entry.recovery.tmp');
      try { await regularFile(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await copyFile(backup, temporary);
      if (digest(await regularFile(temporary)) !== manifest.hash) return 'needsRecovery';
      const handle = await open(temporary, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      await checkpoint('recovery-staged');
      await rename(temporary, entry);
      await checkpoint('recovery-entry-replaced');
      db.prepare('UPDATE operation SET state=?').run('ROLLED_BACK');
      await checkpoint('recovery-log-updated');
      db.exec('COMMIT'); transaction = false;
      return 'rolledBack';
    }
    if (!['APPLYING', 'COMMITTED'].includes(operation.state)) return 'needsRecovery';
    if (digest(await regularFile(entry)) !== manifest.hash) return 'needsRecovery';
    db.prepare('UPDATE operation SET state=?').run('COMMITTED');
    db.exec('COMMIT'); transaction = false;
    return 'committed';
  } catch (error) {
    return [5, 6].includes(error.errcode & 0xff) ? 'busy' : 'needsRecovery';
  } finally {
    if (transaction) db.exec('ROLLBACK');
    if (db) db.close();
  }
}
