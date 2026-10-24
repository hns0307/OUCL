import { DatabaseSync } from 'node:sqlite';
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from './fixture.mjs';
import { recover } from './recovery.mjs';

const [mode, root, stopAt] = process.argv.slice(2);
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
if (mode === 'sqlite') {
  db.exec("CREATE TABLE task (id TEXT PRIMARY KEY); INSERT INTO task VALUES ('committed'); BEGIN IMMEDIATE; INSERT INTO task VALUES ('uncommitted');");
  await checkpoint('transaction-open');
} else if (mode === 'operation') {
  db.exec("CREATE TABLE operation (id TEXT PRIMARY KEY, state TEXT NOT NULL); INSERT INTO operation VALUES ('op-1', 'PREPARED');");
  await checkpoint('prepared');
  await copyFile(path.join(root, 'new-object'), path.join(root, 'staged'));
  await checkpoint('staged');
  db.exec("UPDATE operation SET state='APPLYING'");
  await checkpoint('applying');
  await copyFile(path.join(root, 'staged'), path.join(root, 'entry'));
  await checkpoint('entry-replaced');
  const next = JSON.parse(await readFile(path.join(root, 'next.json'), 'utf8'));
  await atomicJson(path.join(root, 'instance.json'), next);
  await checkpoint('json-committed');
  db.exec("UPDATE operation SET state='COMMITTED'");
  await checkpoint('committed');
} else { throw new Error('UNKNOWN_MODE'); }
db.close();
}
