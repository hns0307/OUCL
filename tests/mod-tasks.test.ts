import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { WorkerError } from '../src/services/workers/protocol.js';
import { ModTaskService } from '../src/services/mods/tasks.js';
import { ModInventoryError } from '../src/services/mods/inventory.js';
import type { ModInventory } from '../src/services/mods/inventory.js';
import type { ModInspectionService } from '../src/services/mods/inspection.js';
const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const rootId = '00000000-0000-4000-8000-000000000001'; const instanceId = '00000000-0000-4000-8000-000000000002';
const input = { instanceId, expectedRevision: 1 };
const inventory = (): ModInventory => ({ instanceId, revision: 1, fingerprint: 'a'.repeat(64), items: [], local: { state: 'satisfied', issues: [], providers: [] } });
const inspection: Pick<ModInspectionService, 'check'> = { check: async (_id, _revision, signal, progress) => {
  for (const stage of ['local', 'platform', 'rechecking', 'completed'] as const) { if (signal?.aborted) throw new ModInventoryError('CANCELLED'); await progress?.(stage); }
  return { inventory: inventory(), platform: { state: 'satisfied', files: [], issues: [] }, platformFailures: [] };
} };
async function fixture(): Promise<{ directory: string; storage: StorageClient }> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'oucl-mod-tasks-')); const directory = path.join(workspace, 'metadata');
  const games = path.join(workspace, 'games'); await mkdir(directory); await mkdir(games);
  const storage = await StorageClient.open(entry, directory);
  await storage.createInstallation({ rootId, dataDirectory: games });
  await storage.writeInstances(0, { items: [{ instanceId, rootId, taskId: randomUUID(), revision: 1, mcVersionId: '1.20.1', displayName: 'Test', isolation: 'on', state: 'ready' }] });
  return { directory, storage };
}
async function done(service: ModTaskService, taskId: string): Promise<string> {
  const deadline = Date.now() + 15000;
  for (;;) {
    const state = (await service.get(rootId, taskId))!.snapshot.state;
    if (['completed', 'failed', 'cancelled', 'needsRecovery'].includes(state)) return state;
    if (Date.now() > deadline) throw new Error('TEST_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 10));
  }
}
test('Mod tasks are durable/idempotent, immutable reports reconnect and completed work is not repeated', async () => {
  const { directory, storage } = await fixture(); let scans = 0;
  const service = new ModTaskService(storage, { scan: async () => { scans++; return inventory(); } }, inspection);
  const requestId = randomUUID(); let taskId!: string;
  try {
    await service.initialize(); const accepted = await service.start(requestId, 'list', input); taskId = accepted.taskId;
    assert.equal((await service.start(requestId, 'list', input)).taskId, taskId);
    await assert.rejects(service.start(requestId, 'check', input), { code: 'REVISION_CONFLICT' });
    assert.equal(await done(service, taskId), 'completed'); assert.equal(scans, 1);
    assert.equal((await service.report(taskId)).report!.mode, 'list');
    const checked = await service.start(randomUUID(), 'check', input); assert.equal(await done(service, checked.taskId), 'completed');
    assert.equal((await service.report(checked.taskId)).report!.mode, 'check');
    assert.ok((await service.list(rootId)).every(task => task.kind === 'mod-check'));
    assert.equal(await service.get(rootId, randomUUID()), undefined);
    await assert.rejects(service.cancel(rootId, taskId), { code: 'CANCEL_TOO_LATE' });
    await assert.rejects(service.report(randomUUID()), { code: 'TASK_NOT_FOUND' });
  } finally { await service.close(); await storage.close(); }
  const reopened = await StorageClient.open(entry, directory); const restored = new ModTaskService(reopened, { scan: async () => { throw new Error('UNEXPECTED_REPLAY'); } }, inspection);
  try {
    const revision = (await reopened.readModJobs())!.revision; await restored.initialize();
    assert.equal((await reopened.readModJobs())!.revision, revision); assert.equal((await restored.report(taskId)).report!.mode, 'list');
    assert.equal((await restored.start(requestId, 'list', input)).taskId, taskId);
  } finally { await restored.close(); await reopened.close(); }
});
test('Mod task cancellation joins the active read, enforces one scan and survives restart without replay', async () => {
  const { directory, storage } = await fixture(); let started!: () => void; let exited = false;
  const began = new Promise<void>(resolve => { started = resolve; });
  const service = new ModTaskService(storage, { scan: async (_id, _revision, signal) => {
    started(); try { return await new Promise<ModInventory>((_resolve, reject) => {
      signal!.addEventListener('abort', () => { setTimeout(() => { exited = true; reject(new ModInventoryError('CANCELLED')); }, 10); }, { once: true });
    }); } finally { exited = true; }
  } }, inspection);
  let taskId!: string;
  try {
    const task = await service.start(randomUUID(), 'list', input); taskId = task.taskId; await began;
    await assert.rejects(service.start(randomUUID(), 'check', input), { code: 'SCAN_BUSY' });
    await service.cancel(rootId, taskId); assert.equal(exited, true); assert.equal(await done(service, taskId), 'cancelled');
    await service.cancel(rootId, taskId); assert.deepEqual(await service.report(taskId), { report: null, errorCode: 'CANCELLED' });
  } finally { await service.close(); await storage.close(); }
  const reopened = await StorageClient.open(entry, directory); const restored = new ModTaskService(reopened, { scan: async () => { throw new Error('UNEXPECTED_REPLAY'); } }, inspection);
  try { await restored.initialize(); assert.equal((await restored.get(rootId, taskId))!.snapshot.state, 'cancelled'); }
  finally { await restored.close(); await reopened.close(); }
});
test('validation and read failures stay controlled and never publish a report', async () => {
  const { storage } = await fixture(); const service = new ModTaskService(storage, { scan: async () => { throw new ModInventoryError('FILES_CHANGED'); } }, inspection);
  try {
    await assert.rejects(service.start('invalid', 'list', input), { code: 'INVALID_ARGUMENT' });
    await assert.rejects(service.start(randomUUID(), 'list', { ...input, expectedRevision: 2 }), { code: 'REVISION_CONFLICT' });
    await assert.rejects(service.start(randomUUID(), 'list', { ...input, instanceId: randomUUID() }), { code: 'INVALID_ARGUMENT' });
    const task = await service.start(randomUUID(), 'list', input); assert.equal(await done(service, task.taskId), 'failed');
    assert.deepEqual(await service.report(task.taskId), { report: null, errorCode: 'FILES_CHANGED' });
    assert.equal(await storage.readModReport(task.taskId), undefined);
  } finally { await service.close(); await storage.close(); }
});
test('a lost report acknowledgement recovers the actual JSON commit without rescanning or overwriting it', async () => {
  const { directory, storage } = await fixture(); const write = storage.writeModReport.bind(storage);
  storage.writeModReport = async (id, data) => { await write(id, data); throw new WorkerError('TIMEOUT'); };
  const service = new ModTaskService(storage, { scan: async () => inventory() }, inspection); let taskId!: string;
  try {
    taskId = (await service.start(randomUUID(), 'check', input)).taskId;
    assert.equal(await done(service, taskId), 'needsRecovery'); assert.ok(await storage.readModReport(taskId));
  } finally { await service.close(); await storage.close(); }
  const reopened = await StorageClient.open(entry, directory); const restored = new ModTaskService(reopened, { scan: async () => { throw new Error('UNEXPECTED_REPLAY'); } }, inspection);
  try {
    const before = await reopened.readModReport(taskId); await restored.initialize();
    assert.equal((await restored.get(rootId, taskId))!.snapshot.state, 'completed'); assert.deepEqual(await reopened.readModReport(taskId), before);
  } finally { await restored.close(); await reopened.close(); }
});

test('failed task state waits for the durable reason instead of racing its report reader', async () => {
  const { storage } = await fixture(); const write = storage.writeModJobs.bind(storage);
  let publishing!: () => void; let release!: () => void;
  const began = new Promise<void>(resolve => { publishing = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  storage.writeModJobs = async (revision, data) => {
    if (data.items.some(item => item.stage === 'failed')) { publishing(); await gate; }
    return write(revision, data);
  };
  const service = new ModTaskService(storage, { scan: async () => { throw new ModInventoryError('FILES_CHANGED'); } }, inspection);
  try {
    const task = await service.start(randomUUID(), 'list', input); await began;
    assert.equal((await service.get(rootId, task.taskId))!.snapshot.state, 'failing'); release();
    assert.equal(await done(service, task.taskId), 'failed'); assert.equal((await service.report(task.taskId)).errorCode, 'FILES_CHANGED');
  } finally { release(); await service.close(); await storage.close(); }
});

test('a lost final task acknowledgement reconciles completed SQL and JSON without false recovery or duplicate reports', async () => {
  const { storage } = await fixture(); const update = storage.update.bind(storage);
  storage.update = async (root, id, revision, execution) => {
    const saved = await update(root, id, revision, execution);
    if (execution.state === 'completed') throw new WorkerError('TIMEOUT'); return saved;
  };
  const service = new ModTaskService(storage, { scan: async () => inventory() }, inspection);
  try {
    const task = await service.start(randomUUID(), 'check', input); assert.equal(await done(service, task.taskId), 'completed');
    assert.equal((await service.report(task.taskId)).report!.mode, 'check');
    assert.equal((await storage.readModReport(task.taskId))!.revision, 1);
  } finally { await service.close(); await storage.close(); }
});
