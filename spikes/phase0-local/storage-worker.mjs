import { DatabaseSync } from 'node:sqlite';
import { copyFile, readFile, rename, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { atomicJson, digest } from './fixture.mjs';
import { recover } from './recovery.mjs';

const [mode, root, stopAt, sourceRoot] = process.argv.slice(2);
if (!path.basename(root).startsWith('oucl-phase0-')) throw new Error('NOT_FIXTURE');

async function checkpoint(name) {
  if (name === stopAt) {
    process.send({ checkpoint: name });
    await new Promise(() => {});
  }
}

if (mode === 'recovery') {
  await recover(root, checkpoint);
} else {
  const db = new DatabaseSync(path.join(root, 'tasks.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  try {
    if (mode === 'sqlite') {
      db.exec("CREATE TABLE task (id TEXT PRIMARY KEY); INSERT INTO task VALUES ('committed'); BEGIN IMMEDIATE; INSERT INTO task VALUES ('uncommitted');");
      await checkpoint('transaction-open');
    } else if (mode === 'operation' || mode === 'cross-operation') {
      if (mode === 'cross-operation' && !path.basename(sourceRoot ?? '').startsWith('oucl-phase0-')) throw new Error('NOT_SOURCE_FIXTURE');
      db.exec("CREATE TABLE operation (id TEXT PRIMARY KEY, state TEXT NOT NULL); INSERT INTO operation VALUES ('op-1', 'PREPARED');");
      await checkpoint('prepared');
      const staged = path.join(root, 'staged');
      await copyFile(path.join(mode === 'cross-operation' ? sourceRoot : root, 'new-object'), staged, constants.COPYFILE_EXCL);
      await checkpoint('staged');
      const next = JSON.parse(await readFile(path.join(root, 'next.json'), 'utf8'));
      if (digest(await readFile(staged)) !== next.hash) throw new Error('STAGED_HASH_MISMATCH');
      const handle = await open(staged, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      db.exec("UPDATE operation SET state='APPLYING'");
      await checkpoint('applying');
      await rename(staged, path.join(root, 'entry'));
      await checkpoint('entry-replaced');
      await atomicJson(path.join(root, 'instance.json'), next);
      await checkpoint('json-committed');
      db.exec("UPDATE operation SET state='COMMITTED'");
      await checkpoint('committed');
    } else { throw new Error('UNKNOWN_MODE'); }
  } finally { db.close(); }
}
