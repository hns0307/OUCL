import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { buildTaskTargetDeadlineWorker } from './fixtures/task-target-deadline-worker.js';
import { DatabaseSync } from 'node:sqlite';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';
import type { ModJobRecord } from '../src/services/storage/mod-jobs.js';
import { RecordStore } from '../src/services/storage/records.js';
import { WorkerError } from '../src/services/workers/protocol.js';
import { TaskTable } from '../src/services/storage/tasks.js';
import { createExecution } from '../src/core/task/machine.js';

const rootId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000000002';
const sourceRoot = process.env.OUCL_SOURCE_ROOT ?? process.cwd();

test('worker stops inventory between records at deadline, preserves bytes and remains usable', async t => {
  const base = await mkdtemp(path.join(tmpdir(), 'oucl-target-inventory-'));
  const worker = process.env.B02_WORKER ?? await buildTaskTargetDeadlineWorker(sourceRoot, path.join(base, 'worker')); const metadata = path.join(base, 'metadata'); const games = path.join(base, 'games');
  await mkdir(metadata); await mkdir(games); const client = await StorageClient.open(worker!, metadata);
  try {
    await client.createInstallation({ rootId, dataDirectory: games }); await client.writeInstance(instanceId, 0, modReadyInstance(rootId, instanceId));
    const jobs: ModJobRecord[] = [];
    for (let n = 0; n < 6; n++) {
      const requestId = randomUUID(); const payloadDigest = createHash('sha256').update(JSON.stringify({ instanceId, expectedRevision: 1, mode: 'check' })).digest('hex');
      const task = await client.accept(rootId, requestId, 'mod-check', payloadDigest);
      jobs.push({ taskId: task.taskId, requestId, payloadDigest, instanceId, instanceRevision: 1, mode: 'check', stage: 'queued', reportRevision: 0, errorCode: null });
    }
    await client.writeModJobs(0, { formatVersion: 1, rootId, items: jobs });
    const db = new DatabaseSync(path.join(metadata, 'tasks.sqlite'), { readOnly: true });
    try {
      const rows = (): string => JSON.stringify({ tasks: db.prepare('SELECT * FROM tasks ORDER BY id').all(), requests: db.prepare('SELECT * FROM requests ORDER BY request_id').all() });
      const files = async (): Promise<Buffer[]> => Promise.all(['tasks.sqlite', 'tasks.sqlite-wal', 'mod-jobs.json'].map(name => readFile(path.join(metadata, name))));
      const beforeRows = rows(); const beforeFiles = await files();
      const workerThread = (client as unknown as { worker: { threadId: number } }).worker; const originalThreadId = workerThread.threadId;
      assert.ok(originalThreadId > 0);
      const query = { rootId, rootRevision: 1, instanceId, kinds: ['mod-check' as const] };
      await assert.rejects(client.readModTargets(query), { code: 'TIMEOUT' });
      const trace = (await readFile(path.join(metadata, 'b02-trace.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { active: boolean; gets: number });
      assert.deepEqual(trace[0], { active: true, gets: 3 }, 'deadline must stop before fetching the fourth task');
      assert.equal(workerThread.threadId, originalThreadId);
      assert.equal(rows(), beforeRows); assert.deepEqual(await files(), beforeFiles);
      assert.equal((await client.readInstallation())?.data.rootId, rootId);
      const restored = await client.readModTargets(query); assert.equal(restored.items.length, 6);
      assert.equal(workerThread.threadId, originalThreadId);
      assert.deepEqual(new Set(restored.items.map(item => item.task.taskId)), new Set(jobs.map(job => job.taskId)));
      assert.equal(rows(), beforeRows); assert.deepEqual(await files(), beforeFiles);
      t.diagnostic(`same worker thread=${originalThreadId}; SQL rows sha256=${createHash('sha256').update(beforeRows).digest('hex')}; raw file sha256=${beforeFiles.map(file => createHash('sha256').update(file).digest('hex')).join(',')}`);
    } finally { db.close(); }
  } finally { await client.close(); }
});

test('RecordStore preserves the exact budget error and unrelated storage errors', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-target-recordstore-')); const store = await RecordStore.open(directory);
  try {
    await store.recover();
    const accepted = await store.acceptTask(rootId, randomUUID(), 'mod-check', 'a'.repeat(64));
    const marker = new WorkerError('TIMEOUT'); let checks = 0;
    await assert.rejects(store.readModTargetAdmissions(rootId, ['mod-check'], () => { if (++checks === 4) throw marker; }), error => error === marker);
    assert.deepEqual(await store.getTask(rootId, accepted.taskId), accepted);
    assert.equal((await store.readModTargetAdmissions(rootId, ['mod-check'])).length, 1);
    await assert.rejects(store.readModTargetAdmissions('invalid-owner', ['mod-check'], () => {}), { code: 'INVALID_RECORD' });
  } finally { await store.close(); }
});

test('budget callback preserves both 1000-item domains and refuses either 1001st item', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, owner_id TEXT, kind TEXT, execution TEXT); CREATE TABLE requests (owner_id TEXT, request_id TEXT, kind TEXT, payload_digest TEXT, task_id TEXT)');
  const table = new TaskTable(db); const kinds = ['mod-check', 'mod-install'] as const;
  const taskInsert = db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?)'); const requestInsert = db.prepare('INSERT INTO requests VALUES (?, ?, ?, ?, ?)');
  const add = (kind: typeof kinds[number]): string => { const taskId = randomUUID(); taskInsert.run(taskId, rootId, kind, JSON.stringify(createExecution()));
    requestInsert.run(rootId, randomUUID(), kind, 'a'.repeat(64), taskId); return taskId; };
  try {
    for (const kind of kinds) for (let n = 0; n < 1000; n++) add(kind);
    let checks = 0; assert.equal(table.modTargetAdmissions(rootId, kinds, () => { checks++; }).length, 2000); assert.ok(checks >= 4000);
    for (const kind of kinds) {
      const extra = add(kind); assert.throws(() => table.modTargetAdmissions(rootId, kinds, () => {}), { code: 'NEEDS_RECOVERY' });
      db.prepare('DELETE FROM requests WHERE task_id=?').run(extra); db.prepare('DELETE FROM tasks WHERE id=?').run(extra);
    }
    assert.equal(table.modTargetAdmissions(rootId, kinds, () => {}).length, 2000);
  } finally { db.close(); }
});
