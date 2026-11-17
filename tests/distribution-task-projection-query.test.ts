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
import { parseReply, parseStorageRequest } from '../src/services/workers/protocol.js';

const digest = 'a'.repeat(64);
async function directory() {
  const base = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp', 'distribution-query');
  await mkdir(base, { recursive: true }); return mkdtemp(path.join(base, 'case-'));
}
test('real RecordStore and worker return the complete fixed identity projection and reject stale roots', async () => {
  const root = await directory(); const owner = randomUUID(); const proposal = randomUUID(); const id = randomUUID();
  const store = await RecordStore.open(root);
  let expected;
  try {
    await store.recover(); assert.deepEqual(await store.readDistributionTaskProjections(owner), []);
    await store.write('installation', 0, { rootId: owner, dataDirectory: root }, parseInstallation);
    const task = await store.projectDistributionTask(owner, proposal, digest, id);
    expected = [{ proposalId: proposal, payloadDigest: digest, task }];
    assert.deepEqual(await store.readDistributionTaskProjections(owner), expected);
  } finally { await store.close(); }
  const client = await StorageClient.open(new URL('../src/services/workers/entry.js', import.meta.url), root);
  try {
    await assert.rejects(client.readDistributionTaskProjections(randomUUID()), { code: 'NEEDS_RECOVERY' });
    const actual = await client.readDistributionTaskProjections(owner);
    assert.deepEqual(actual, expected); assert.deepEqual(await client.readDistributionTaskProjections(owner), actual);
  } finally { await client.close(); }
});
test('SQL reader rejects either orphan, kind mismatch, invalid digest and overflow without writing', () => {
  for (const scenario of ['task-only', 'request-only', 'kind', 'digest', 'overflow'] as const) {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,execution TEXT); CREATE TABLE requests(owner_id TEXT,request_id TEXT,kind TEXT,payload_digest TEXT,task_id TEXT UNIQUE,PRIMARY KEY(owner_id,request_id));');
    try {
      const table = new TaskTable(db); const owner = randomUUID();
      for (let i = 0; i < (scenario === 'overflow' ? 1025 : 1); i++) table.projectDistribution(owner, randomUUID(), digest, randomUUID());
      if (scenario === 'task-only') db.exec('DELETE FROM requests');
      if (scenario === 'request-only') db.exec('DELETE FROM tasks');
      if (scenario === 'kind') db.exec("UPDATE requests SET kind='mod-install'");
      if (scenario === 'digest') db.exec("UPDATE requests SET payload_digest='invalid'");
      const before = JSON.stringify([db.prepare('SELECT * FROM tasks').all(), db.prepare('SELECT * FROM requests').all()]);
      assert.throws(() => table.readDistributionProjections(owner), { code: 'NEEDS_RECOVERY' });
      assert.equal(JSON.stringify([db.prepare('SELECT * FROM tasks').all(), db.prepare('SELECT * FROM requests').all()]), before);
    } finally { db.close(); }
  }
});
test('private query parser rejects owner injection and reply duplicate aliases', () => {
  const command = { kind: 'distribution-task:list', expectedRootId: randomUUID() };
  assert.doesNotThrow(() => parseStorageRequest({ version: 1, id: randomUUID(), command }));
  assert.throws(() => parseStorageRequest({ version: 1, id: randomUUID(), command: { ...command, ownerId: randomUUID() } }), { code: 'INVALID_MESSAGE' });
  const task = { taskId: randomUUID(), ownerId: randomUUID(), kind: 'distribution-install', execution: { state: 'queued', attempt: 0, lastSequence: 0, revision: 1, bytesDone: 0 } };
  const row = { proposalId: randomUUID(), payloadDigest: digest, task };
  assert.throws(() => parseReply({ version: 1, id: randomUUID(), kind: 'response', ok: true, distributionProjections: [row, row] }), { code: 'INVALID_MESSAGE' });
});
