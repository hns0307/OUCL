import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RecordStore } from '../src/services/storage/records.js';
import { TransferDatabase } from '../src/services/storage/transfer-db.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import type { TrustAnchor } from '../src/services/objects/provenance.js';
import type { ExpectedArtifact } from '../src/core/download/integrity.js';
import type { TransferRecord } from '../src/services/download/types.js';

const expected: ExpectedArtifact = { algorithm: 'sha1', digest: 'a'.repeat(40), size: 12, provenanceId: 'fixture:client' };
const anchor: TrustAnchor = { kind: 'mojang-version', algorithm: 'sha1', digest: 'b'.repeat(40) };
const stagingId = '00000000-0000-4000-8000-000000000001';
const key = sourceKey(expected, anchor);
function initial(): TransferRecord {
  return { url: 'https://piston-data.mojang.com/client.jar', expected, anchor, key, stagingId, revision: 1, bytesDone: 0, state: 'partial' };
}
interface Fixture { root: string; records: RecordStore; ledger: TransferDatabase | undefined }
async function fixture(work: (f: Fixture) => Promise<void>, initialize = true): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-download-journal-'));
  const records = await RecordStore.open(root); await records.recover();
  const f: Fixture = { root, records, ledger: undefined };
  try { if (initialize) f.ledger = await TransferDatabase.open(root, records); await work(f); }
  finally { f.ledger?.close(); await f.records.close(); await rm(root, { recursive: true, force: true }); }
}
function mutate(root: string, sql: string): void {
  const db = new DatabaseSync(path.join(root, 'transfers.sqlite'));
  try { db.exec(sql); } finally { db.close(); }
}
function createInterruptedDatabase(root: string, record?: TransferRecord): void {
  const db = new DatabaseSync(path.join(root, 'transfers.sqlite'));
  try {
    db.exec(`CREATE TABLE transfers (key TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(length(record_json)<=16384)) STRICT;
      PRAGMA application_id=${0x4f554354}; PRAGMA user_version=1;`);
    if (record) db.prepare('INSERT INTO transfers VALUES (?, ?)').run(record.key, JSON.stringify(record));
  } finally { db.close(); }
}

test('durable transfer checkpoint is created with its marker and reopens without losing validators', async () => fixture(async f => {
  assert.deepEqual((await f.records.read('transfers', value => value))?.data, { enabled: true });
  assert.deepEqual(f.ledger!.list(), []); assert.equal(f.ledger!.get(key), undefined);
  f.ledger!.set(0, initial());
  const partial = { ...initial(), revision: 2, bytesDone: 4, etag: '"fixture-v1"' };
  f.ledger!.set(1, partial);
  assert.deepEqual(f.ledger!.get(key), partial);
  f.ledger!.close(); await f.records.close();
  f.records = await RecordStore.open(f.root); await f.records.recover(); f.ledger = await TransferDatabase.open(f.root, f.records);
  assert.deepEqual(f.ledger.list(), [partial]);
}));

test('transfer revisions reject stale callbacks and roll back a locked write cleanly', async () => fixture(async f => {
  f.ledger!.set(0, initial());
  assert.throws(() => f.ledger!.set(0, initial()), { code: 'REVISION_CONFLICT' });
  const locker = new DatabaseSync(path.join(f.root, 'transfers.sqlite'));
  try {
    locker.exec('BEGIN IMMEDIATE');
    assert.throws(() => f.ledger!.set(1, { ...initial(), revision: 2, bytesDone: 2 }), { code: 'STORE_BUSY' });
    assert.equal(f.ledger!.get(key)?.revision, 1);
    locker.exec('ROLLBACK');
    f.ledger!.set(1, { ...initial(), revision: 2, bytesDone: 2 });
  } finally { locker.close(); }
  assert.equal(f.ledger!.get(key)?.bytesDone, 2);
}));

test('invalid identity, metadata, progress and validators cannot replace a checkpoint', async () => fixture(async f => {
  f.ledger!.set(0, initial());
  for (const invalid of [
    { ...initial(), revision: 2, stagingId: '00000000-0000-4000-8000-000000000099' },
    { ...initial(), revision: 2, expected: { ...expected, size: 13 } },
    { ...initial(), revision: 2, anchor: { ...anchor, digest: 'c'.repeat(40) } },
    { ...initial(), revision: 2, bytesDone: -1 },
    { ...initial(), revision: 2, bytesDone: 13 },
    { ...initial(), revision: 2, etag: 'W/"weak"' },
    { ...initial(), revision: 2, lastModified: 'not a date' },
    { ...initial(), revision: 2, state: 'complete' as const, bytesDone: 4 },
    { ...initial(), revision: 2, state: 'committed' as const, bytesDone: 12, objectDigest: 'd'.repeat(64) }
  ]) assert.throws(() => f.ledger!.set(1, invalid), { code: 'INVALID_RECORD' });
  assert.throws(() => f.ledger!.get('../outside'), { code: 'INVALID_RECORD' });
  assert.deepEqual(f.ledger!.get(key), initial());
}));

test('only a zero-byte reset may change source or retreat; committed state cannot be rewritten', async () => fixture(async f => {
  f.ledger!.set(0, initial());
  const partial = { ...initial(), revision: 2, bytesDone: 8, etag: '"v1"' }; f.ledger!.set(1, partial);
  assert.throws(() => f.ledger!.set(2, { ...partial, revision: 3, bytesDone: 7 }), { code: 'INVALID_RECORD' });
  assert.throws(() => f.ledger!.set(2, { ...partial, revision: 3, etag: '"v2"' }), { code: 'INVALID_RECORD' });
  assert.throws(() => f.ledger!.set(2, { ...partial, revision: 3, url: 'https://libraries.minecraft.net/client.jar' }), { code: 'INVALID_RECORD' });
  assert.throws(() => f.ledger!.set(2, { ...partial, revision: 3, bytesDone: 0, url: 'https://libraries.minecraft.net/client.jar' }), { code: 'INVALID_RECORD' });
  const reset = { ...initial(), revision: 3, url: 'https://libraries.minecraft.net/client.jar' }; f.ledger!.set(2, reset);
  const complete: TransferRecord = { ...reset, revision: 4, bytesDone: 12, state: 'complete' }; f.ledger!.set(3, complete);
  assert.throws(() => f.ledger!.set(4, { ...complete, revision: 5, state: 'partial', bytesDone: 4 }), { code: 'INVALID_RECORD' });
  const retry: TransferRecord = { ...reset, revision: 5 }; f.ledger!.set(4, retry);
  const completed: TransferRecord = { ...retry, revision: 6, bytesDone: 12, state: 'complete' }; f.ledger!.set(5, completed);
  const committed: TransferRecord = { ...completed, revision: 7, state: 'committed', objectDigest: 'd'.repeat(64) }; f.ledger!.set(6, committed);
  assert.throws(() => f.ledger!.set(7, { ...committed, revision: 8 }), { code: 'INVALID_RECORD' });
  assert.deepEqual(f.ledger!.get(key), committed);
}));

test('losing the authoritative ledger never creates an empty replacement or removes accepted tasks', async () => fixture(async f => {
  const ownerId = '00000000-0000-4000-8000-000000000002'; const requestId = '00000000-0000-4000-8000-000000000003';
  const task = await f.records.acceptTask(ownerId, requestId, 'download', 'a'.repeat(64));
  f.ledger!.set(0, initial()); f.ledger!.close(); f.ledger = undefined;
  await rm(path.join(f.root, 'transfers.sqlite'));
  await assert.rejects(TransferDatabase.open(f.root, f.records), { code: 'NEEDS_RECOVERY' });
  await assert.rejects(readFile(path.join(f.root, 'transfers.sqlite')), { code: 'ENOENT' });
  assert.equal((await f.records.getTask(ownerId, task.taskId))?.taskId, task.taskId);
  assert.equal((await f.records.acceptTask(ownerId, requestId, 'download', 'a'.repeat(64))).taskId, task.taskId);
}));

test('the empty initialization crash window may finish the marker but populated unmarked ledgers stop', async () => {
  await fixture(async f => {
    createInterruptedDatabase(f.root);
    f.ledger = await TransferDatabase.open(f.root, f.records);
    assert.deepEqual(f.ledger.list(), []);
    assert.deepEqual((await f.records.read('transfers', value => value))?.data, { enabled: true });
  }, false);
  await fixture(async f => {
    createInterruptedDatabase(f.root, initial());
    await assert.rejects(TransferDatabase.open(f.root, f.records), { code: 'NEEDS_RECOVERY' });
    assert.equal(await f.records.read('transfers', value => value), undefined);
    const inspect = new DatabaseSync(path.join(f.root, 'transfers.sqlite'));
    try { assert.equal(inspect.prepare('SELECT count(*) AS count FROM transfers').get()?.count, 1); } finally { inspect.close(); }
  }, false);
});

test('unknown ledger version, identity or schema stays on disk without being reset', async () => {
  for (const sql of ['PRAGMA user_version=2', 'PRAGMA application_id=1', 'ALTER TABLE transfers ADD COLUMN future TEXT', 'CREATE TABLE future (value TEXT)']) await fixture(async f => {
    f.ledger!.set(0, initial()); f.ledger!.close(); f.ledger = undefined; mutate(f.root, sql);
    await assert.rejects(TransferDatabase.open(f.root, f.records), { code: 'NEEDS_RECOVERY' });
    const inspect = new DatabaseSync(path.join(f.root, 'transfers.sqlite'));
    try { assert.equal(inspect.prepare('SELECT count(*) AS count FROM transfers').get()?.count, 1); } finally { inspect.close(); }
  });
});

test('malformed checkpoint records and unknown states block opening instead of disappearing', async () => {
  for (const corrupted of ['{}', JSON.stringify({ ...initial(), state: 'future' }), JSON.stringify({ ...initial(), key: '0'.repeat(64) })]) await fixture(async f => {
    f.ledger!.set(0, initial()); f.ledger!.close(); f.ledger = undefined;
    const writer = new DatabaseSync(path.join(f.root, 'transfers.sqlite'));
    try { writer.prepare('UPDATE transfers SET record_json=?').run(corrupted); } finally { writer.close(); }
    await assert.rejects(TransferDatabase.open(f.root, f.records), { code: 'NEEDS_RECOVERY' });
    const inspect = new DatabaseSync(path.join(f.root, 'transfers.sqlite'));
    try { assert.equal(inspect.prepare('SELECT record_json FROM transfers').get()?.record_json, corrupted); } finally { inspect.close(); }
  });
});

test('cached SQLite handles reject missing, changed or nonregular backing identity before reads and writes', async () => fixture(async f => {
  let mode: 'missing' | 'changed' | 'link' | 'directory' | undefined;
  f.ledger = await TransferDatabase.open(f.root, f.records, file => {
    if (mode === 'missing') throw new Error('private path must not escape');
    const stats = lstatSync(file, { bigint: true });
    return { dev: stats.dev, ino: mode === 'changed' ? stats.ino + 1n : stats.ino,
      isFile: () => mode !== 'directory', isSymbolicLink: () => mode === 'link' };
  });
  f.ledger.set(0, initial());
  for (const failure of ['missing', 'changed', 'link', 'directory'] as const) {
    mode = failure;
    assert.throws(() => f.ledger!.get(key), { code: 'NEEDS_RECOVERY', message: 'NEEDS_RECOVERY' });
    assert.throws(() => f.ledger!.list(), { code: 'NEEDS_RECOVERY' });
    assert.throws(() => f.ledger!.set(1, { ...initial(), revision: 2, bytesDone: 2 }), { code: 'NEEDS_RECOVERY' });
    mode = undefined;
    assert.equal(f.ledger.get(key)?.revision, 1);
  }
}, false));

test('real backing-path removal/replacement is refused while the cached handle exists when the OS permits rename', async t => fixture(async f => {
  f.ledger!.set(0, initial());
  const file = path.join(f.root, 'transfers.sqlite'); const moved = path.join(f.root, 'transfers.sqlite.moved');
  try { await rename(file, moved); }
  catch (error) {
    if (process.platform === 'win32' && typeof error === 'object' && error !== null && 'code' in error && ['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code))) {
      t.skip('Windows refused rename of an open SQLite database; deterministic identity-adapter coverage remains active.'); return;
    }
    throw error;
  }
  let replacement = false;
  try {
    assert.throws(() => f.ledger!.get(key), { code: 'NEEDS_RECOVERY' });
    assert.throws(() => f.ledger!.set(1, { ...initial(), revision: 2, bytesDone: 2 }), { code: 'NEEDS_RECOVERY' });
    await writeFile(file, 'foreign sentinel', { flag: 'wx' }); replacement = true;
    assert.throws(() => f.ledger!.get(key), { code: 'NEEDS_RECOVERY' });
    assert.throws(() => f.ledger!.list(), { code: 'NEEDS_RECOVERY' });
    assert.equal(await readFile(file, 'utf8'), 'foreign sentinel');
  } finally { if (replacement) await unlink(file); await rename(moved, file); }
  assert.equal(f.ledger!.get(key)?.revision, 1);
}));
