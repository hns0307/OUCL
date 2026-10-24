import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RecordStore } from '../src/services/storage/records.js';
import type { Checkpoint } from '../src/services/storage/records.js';
import { StorageError } from '../src/services/storage/files.js';
import { controlTask } from '../src/core/task/machine.js';

function parse(value: unknown): { label: string } {
  if (typeof value !== 'object' || value === null || !('label' in value) || typeof value.label !== 'string'
    || Object.keys(value).length !== 1) throw new StorageError('INVALID_RECORD');
  return { label: value.label };
}
async function fixture(work: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-storage-'));
  try { await work(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('versioned JSON commits real files, reopens and preserves strict revisions', async () => fixture(async root => {
  let store = await RecordStore.open(root);
  try {
    await assert.rejects(store.read('settings', parse), { code: 'NEEDS_RECOVERY' });
    await store.recover();
    assert.equal(await store.read('settings', parse), undefined);
    assert.deepEqual(await store.write('settings', 0, { label: '中文 空格' }, parse), { schemaVersion: 1, revision: 1, data: { label: '中文 空格' } });
    assert.equal(JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8')).revision, 1);
    await assert.rejects(store.write('settings', 0, { label: 'conflict' }, parse), { code: 'REVISION_CONFLICT' });
    await store.write('settings', 1, { label: 'second' }, parse);
    await store.close();
    store = await RecordStore.open(root);
    await store.recover();
    assert.equal((await store.read('settings', parse))?.data.label, 'second');
    await store.recover();
  } finally { await store.close(); }
}));

test('all five commit boundaries recover old or new JSON and replay idempotently', async () => {
  for (const point of ['prepared', 'applying', 'staged', 'renamed', 'committed'] as Checkpoint[]) {
    await fixture(async root => {
      const store = await RecordStore.open(root);
      try {
        await store.recover();
        await store.write('instance', 0, { label: 'old' }, parse);
        await assert.rejects(store.write('instance', 1, { label: 'new' }, parse, async checkpoint => {
          if (checkpoint === point) throw new Error('simulated interruption');
        }), { code: 'NEEDS_RECOVERY' });
        await assert.rejects(store.read('instance', parse), { code: 'NEEDS_RECOVERY' });
        await store.recover();
        await store.recover();
        const result = await store.read('instance', parse);
        const committed = point === 'renamed' || point === 'committed';
        assert.equal(result?.data.label, committed ? 'new' : 'old');
        assert.equal(result?.revision, committed ? 2 : 1);
        await store.write('instance', result!.revision, { label: 'next' }, parse);
        assert.equal((await readdir(root)).filter(name => name.endsWith('.tmp')).length, 0);
      } finally { await store.close(); }
    });
  }
});

test('first-create interruption rolls back absence or completes committed JSON', async () => {
  for (const point of ['prepared', 'staged', 'renamed'] as Checkpoint[]) await fixture(async root => {
    const store = await RecordStore.open(root);
    try {
      await store.recover();
      await assert.rejects(store.write('first', 0, { label: 'new' }, parse, async current => {
        if (current === point) throw new Error('stop');
      }));
      await store.recover();
      assert.equal((await store.read('first', parse))?.revision, point === 'renamed' ? 1 : undefined);
    } finally { await store.close(); }
  });
});

test('same-process revisions serialize and another repository cannot acquire the owner lease', async () => fixture(async root => {
  const store = await RecordStore.open(root);
  try {
    await store.recover();
    await assert.rejects(RecordStore.open(root), { code: 'STORE_BUSY' });
    const results = await Promise.allSettled([store.write('a', 0, { label: 'a' }, parse), store.write('a', 0, { label: 'b' }, parse)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  } finally { await store.close(); }
}));

test('invalid data and identifiers never create an operation or change JSON', async () => fixture(async root => {
  const store = await RecordStore.open(root);
  try {
    await store.recover();
    for (const id of ['../outside', 'a/b', 'a:b', '', 'CON', 'nul', 'COM1', 'x'.repeat(81)]) await assert.rejects(store.write(id, 0, { label: 'bad' }, parse), { code: 'INVALID_RECORD' });
    for (const revision of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER]) await assert.rejects(store.write('a', revision, { label: 'bad' }, parse), { code: 'INVALID_RECORD' });
    await assert.rejects(store.write('a', 0, { label: 'x'.repeat(4 * 1024 * 1024) }, parse), { code: 'INVALID_RECORD' });
    await assert.rejects(store.write<unknown>('a', 0, { label: 1 }, parse), { code: 'INVALID_RECORD' });
    await store.write('a', 0, { label: 'valid' }, parse);
  } finally { await store.close(); }
}));

test('changed JSON or missing authoritative database never silently becomes an empty store', async () => fixture(async root => {
  const store = await RecordStore.open(root);
  await store.recover(); await store.write('a', 0, { label: 'original' }, parse);
  await writeFile(path.join(root, 'a.json'), '{"schemaVersion":1,"revision":1,"data":{"label":"changed"}}\n');
  await assert.rejects(store.read('a', parse), { code: 'NEEDS_RECOVERY' });
  await assert.rejects(store.recover(), { code: 'NEEDS_RECOVERY' });
  await store.close();
  await rm(path.join(root, 'tasks.sqlite'));
  await assert.rejects(RecordStore.open(root), { code: 'NEEDS_RECOVERY' });
  assert.equal((await readdir(root)).includes('tasks.sqlite'), false);
}));

test('unknown operation state, broken history and future schema all stop recovery', async () => {
  for (const sql of ["UPDATE operations SET phase='UNKNOWN'", "UPDATE operations SET before_json='{}'", 'PRAGMA user_version=2']) await fixture(async root => {
    const store = await RecordStore.open(root);
    await store.recover(); await store.write('a', 0, { label: 'safe' }, parse); await store.close();
    const db = new DatabaseSync(path.join(root, 'tasks.sqlite')); db.exec(sql); db.close();
    if (sql.startsWith('PRAGMA')) await assert.rejects(RecordStore.open(root), { code: 'NEEDS_RECOVERY' });
    else {
      const opened = await RecordStore.open(root);
      try { await assert.rejects(opened.recover(), { code: 'NEEDS_RECOVERY' }); }
      finally { await opened.close(); }
    }
  });
});

test('unknown staging content and unjournaled records are preserved for recovery', async () => {
  for (const name of ['foreign.json', 'unknown.tmp']) await fixture(async root => {
    const store = await RecordStore.open(root);
    try {
      await store.recover();
      await writeFile(path.join(root, name), 'sentinel');
      await assert.rejects(store.recover(), { code: 'NEEDS_RECOVERY' });
      assert.equal(await readFile(path.join(root, name), 'utf8'), 'sentinel');
    } finally { await store.close(); }
  });
});

test('linked repository paths are refused without touching the target', async () => fixture(async root => {
  const target = path.join(root, 'target'); const alias = path.join(root, 'alias');
  await mkdir(target); await writeFile(path.join(target, 'sentinel'), 'keep');
  await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(RecordStore.open(alias), { code: 'UNSAFE_PATH' });
  assert.equal(await readFile(path.join(target, 'sentinel'), 'utf8'), 'keep');
}));

test('an existing stale/foreign lease is never removed automatically', async () => fixture(async root => {
  await writeFile(path.join(root, 'owner.lock'), 'foreign-owner');
  await assert.rejects(RecordStore.open(root), { code: 'STORE_BUSY' });
  assert.equal(await readFile(path.join(root, 'owner.lock'), 'utf8'), 'foreign-owner');
}));

test('corrupt staging is kept intact and never promoted or silently discarded', async () => fixture(async root => {
  const store = await RecordStore.open(root);
  try {
    await store.recover();
    await assert.rejects(store.write('a', 0, { label: 'new' }, parse, async point => {
      if (point === 'staged') {
        const temporary = (await readdir(root)).find(name => name.endsWith('.tmp'))!;
        await writeFile(path.join(root, temporary), 'corrupt sentinel');
        throw new Error('stop');
      }
    }));
    await assert.rejects(store.recover(), { code: 'NEEDS_RECOVERY' });
    const temporary = (await readdir(root)).find(name => name.endsWith('.tmp'))!;
    assert.equal(await readFile(path.join(root, temporary), 'utf8'), 'corrupt sentinel');
    await assert.rejects(store.write('b', 0, { label: 'blocked' }, parse), { code: 'NEEDS_RECOVERY' });
  } finally { await store.close(); }
}));

const ownerId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const otherOwner = '00000000-0000-4000-8000-000000000003';

test('SQLite atomically accepts tasks and identical request retries return the same task', async () => fixture(async root => {
  const store = await RecordStore.open(root);
  try {
    await store.recover();
    const accepted = await store.acceptTask(ownerId, requestId, 'download', 'a'.repeat(64));
    assert.deepEqual(await store.acceptTask(ownerId, requestId, 'download', 'a'.repeat(64)), accepted);
    await assert.rejects(store.acceptTask(ownerId, requestId, 'download', 'b'.repeat(64)), { code: 'REVISION_CONFLICT' });
    await assert.rejects(store.acceptTask(ownerId, requestId, 'install', 'a'.repeat(64)), { code: 'REVISION_CONFLICT' });
    assert.equal(await store.getTask(otherOwner, accepted.taskId), undefined);
    const independent = await store.acceptTask(otherOwner, requestId, 'download', 'a'.repeat(64));
    assert.notEqual(independent.taskId, accepted.taskId);
    assert.equal((await readdir(root)).some(name => name.endsWith('.json')), false);
    await assert.rejects(store.acceptTask('bad', requestId, 'download', 'a'.repeat(64)), { code: 'INVALID_RECORD' });
    await assert.rejects(store.acceptTask(ownerId, requestId, 'download', ''), { code: 'INVALID_RECORD' });
  } finally { await store.close(); }
}));

test('persisted task CAS rejects stale updates and restart protects uncertain effects', async () => fixture(async root => {
  let store = await RecordStore.open(root);
  try {
    await store.recover();
    const task = await store.acceptTask(ownerId, requestId, 'launch', 'a'.repeat(64));
    const running = controlTask(task.execution, 'start').execution;
    await store.updateTask(ownerId, task.taskId, 1, running);
    await assert.rejects(store.updateTask(ownerId, task.taskId, 1, running), { code: 'REVISION_CONFLICT' });
    await assert.rejects(store.updateTask(otherOwner, task.taskId, 2, { ...running, revision: 3 }), { code: 'REVISION_CONFLICT' });
    await assert.rejects(store.updateTask(ownerId, task.taskId, 2, { ...running, revision: 3, bytesDone: -1 }), { code: 'INVALID_RECORD' });
    await store.close();
    store = await RecordStore.open(root); await store.recover();
    const recovered = await store.getTask(ownerId, task.taskId);
    assert.equal(recovered?.execution.state, 'needsRecovery');
    assert.equal(recovered?.execution.revision, 3);
    await store.recover();
    assert.equal((await store.getTask(ownerId, task.taskId))?.execution.revision, 3);
    assert.equal((await store.acceptTask(ownerId, requestId, 'launch', 'a'.repeat(64))).taskId, task.taskId);
  } finally { await store.close(); }
}));

test('missing acceptance evidence and corrupt task state fail recovery instead of replaying', async () => {
  for (const sql of ['DELETE FROM requests', "UPDATE tasks SET execution='{}'", "UPDATE requests SET payload_digest='invalid'"]) await fixture(async root => {
    const store = await RecordStore.open(root);
    await store.recover(); await store.acceptTask(ownerId, requestId, 'download', 'a'.repeat(64)); await store.close();
    const db = new DatabaseSync(path.join(root, 'tasks.sqlite')); db.exec(sql); db.close();
    const reopened = await RecordStore.open(root);
    try { await assert.rejects(reopened.recover(), { code: 'NEEDS_RECOVERY' }); }
    finally { await reopened.close(); }
  });
});
