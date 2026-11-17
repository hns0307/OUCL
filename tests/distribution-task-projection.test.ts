import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RecordStore } from '../src/services/storage/records.js';
import { TaskTable } from '../src/services/storage/tasks.js';
import { parseInstallation } from '../src/services/storage/installation.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { parseStorageRequest } from '../src/services/workers/protocol.js';

const digest = 'a'.repeat(64);
async function directory(): Promise<string> {
  const root = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp', 'distribution-task-projection');
  await mkdir(root, { recursive: true }); return mkdtemp(path.join(root, 'case-'));
}

test('real RecordStore projects the exact admitted task identity idempotently without executing it', async () => {
  const store = await RecordStore.open(await directory()); const owner = randomUUID(); const proposal = randomUUID(); const id = randomUUID();
  try {
    await store.recover();
    const first = await store.projectDistributionTask(owner, proposal, digest, id);
    assert.equal(first.taskId, id); assert.equal(first.kind, 'distribution-install'); assert.equal(first.execution.state, 'queued');
    assert.deepEqual(await store.projectDistributionTask(owner, proposal, digest, id), first);
    for (const [root, request, hash, task] of [[owner, proposal, 'b'.repeat(64), id], [owner, proposal, digest, randomUUID()],
      [owner, randomUUID(), digest, id], [randomUUID(), proposal, digest, id]]) {
      await assert.rejects(store.projectDistributionTask(root!, request!, hash!, task!), { code: 'NEEDS_RECOVERY' });
    }
    await assert.rejects(store.acceptTask(owner, randomUUID(), 'distribution-install', digest), { code: 'INVALID_RECORD' });
    assert.deepEqual(await store.getTask(owner, id), first);
  } finally { await store.close(); }
});

test('SQL projection rejects either orphan side and foreign kind instead of adopting existing rows', () => {
  for (const scenario of ['task-only', 'request-only', 'foreign-kind'] as const) {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,execution TEXT); CREATE TABLE requests(owner_id TEXT,request_id TEXT,kind TEXT,payload_digest TEXT,task_id TEXT UNIQUE,PRIMARY KEY(owner_id,request_id));');
    const table = new TaskTable(db); const owner = randomUUID(); const proposal = randomUUID(); const id = randomUUID();
    try {
      const first = table.projectDistribution(owner, proposal, digest, id);
      if (scenario === 'task-only') db.prepare('DELETE FROM requests').run();
      else if (scenario === 'request-only') db.prepare('DELETE FROM tasks').run();
      else db.prepare("UPDATE tasks SET kind='mod-install'").run();
      const before = JSON.stringify([db.prepare('SELECT * FROM tasks').all(), db.prepare('SELECT * FROM requests').all()]);
      assert.throws(() => table.projectDistribution(owner, proposal, digest, id), { code: 'NEEDS_RECOVERY' });
      assert.equal(JSON.stringify([db.prepare('SELECT * FROM tasks').all(), db.prepare('SELECT * FROM requests').all()]), before);
      assert.equal(first.taskId, id);
    } finally { db.close(); }
  }
});

test('real worker bridge derives owner and rejects a stale expected root without projection', async () => {
  const root = await directory(); const owner = randomUUID(); const proposal = randomUUID(); const id = randomUUID();
  const store = await RecordStore.open(root);
  try { await store.recover(); await store.write('installation', 0, { rootId: owner, dataDirectory: root }, parseInstallation); }
  finally { await store.close(); }
  const client = await StorageClient.open(new URL('../src/services/workers/entry.js', import.meta.url), root);
  try {
    await assert.rejects(client.projectDistributionTask(randomUUID(), proposal, digest, id), { code: 'NEEDS_RECOVERY' });
    assert.equal(await client.get(owner, id), undefined);
    const task = await client.projectDistributionTask(owner, proposal, digest, id);
    assert.equal(task.ownerId, owner); assert.equal(task.taskId, id); assert.equal(task.execution.state, 'queued');
    assert.deepEqual(await client.projectDistributionTask(owner, proposal, digest, id), task);
    await assert.rejects(client.accept(owner, randomUUID(), 'distribution-install', digest), { code: 'INVALID_MESSAGE' });
  } finally { await client.close(); }
});

test('private projection command rejects caller owner fields and malformed bindings', () => {
  const command = { kind: 'distribution-task:project', expectedRootId: randomUUID(), proposalId: randomUUID(), taskId: randomUUID(), payloadDigest: digest };
  assert.doesNotThrow(() => parseStorageRequest({ version: 1, id: randomUUID(), command }));
  for (const bad of [{ ...command, ownerId: randomUUID() }, { ...command, payloadDigest: 'unknown' }, { ...command, taskId: 'invalid' }]) {
    assert.throws(() => parseStorageRequest({ version: 1, id: randomUUID(), command: bad }), { code: 'INVALID_MESSAGE' });
  }
});
