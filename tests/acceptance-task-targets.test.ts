import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { TargetAdapter } from '../src/ipc/task-targets.js';
import { modPlanDigest, modPlanInputDigest } from '../src/services/mods/plan-identity.js';
import type { ModInstallPlan, ModPayloads } from '../src/shared/contracts/mods.js';
import type { StoredModPlan } from '../src/services/storage/mod-plans.js';
import type { RecordEnvelope } from '../src/services/storage/records.js';
import type { ModTaskService } from '../src/services/mods/tasks.js';
import type { ModInstallTaskService } from '../src/services/mods/install-tasks.js';
import type { TargetResult, TargetRow } from '../src/shared/contracts/task-targets.js';
import type { StoredTask } from '../src/services/storage/tasks.js';
import { createExecution } from '../src/core/task/machine.js';
import { instanceFailure } from '../src/shared/contracts/instances.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const rootId = '00000000-0000-4000-8000-000000000001';
const a = '00000000-0000-4000-8000-000000000002';
const b = '00000000-0000-4000-8000-000000000003';
const foreign = '00000000-0000-4000-8000-000000000004';
const query = { rootId, rootRevision: 1, instanceId: b, kinds: ['mod-install' as const] };
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
function request(cursor?: string) {
  return { contractVersion: 1 as const, requestId: randomUUID(), payload: { instanceId: b, kinds: ['mod-install' as const], limit: 100, ...(cursor ? { cursor } : {}) } };
}
function errorCode(result: TargetResult, expected: string): void {
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, expected);
}
function planFor(instanceId: string, requestId: string): StoredModPlan {
  const input: ModPayloads['mods:plan'] = { instanceId, expectedRevision: 1,
    root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: 'a'.repeat(40) }, selections: {} };
  const body: Omit<ModInstallPlan, 'planId'> = { formatVersion: 1, instanceId, instanceRevision: 1,
    fingerprint: 'b'.repeat(64), minecraft: '1.20.1', loader: 'fabric', rootVersionId: 'RootVer1', state: 'ready', attempts: 1,
    totalDownloadBytes: 0, items: [{ projectId: 'RootProj', versionId: 'RootVer1', filename: 'root.jar', fileId: 'a'.repeat(40),
      sha512: 'c'.repeat(128), size: 1, disposition: 'library', requiredBy: [] }], issues: [] };
  return { formatVersion: 1, rootId, requestId, payloadDigest: modPlanInputDigest(input), input,
    plan: { ...body, planId: modPlanDigest(body) }, status: 'preview' };
}
async function fixture() {
  await mkdir(path.resolve('tmp'), { recursive: true });
  const base = await mkdtemp(path.resolve('tmp', 'acceptance-targets-')); const metadata = path.join(base, 'metadata');
  const games = path.join(base, 'games'); await mkdir(metadata); await mkdir(games);
  const client = await StorageClient.open(entry, metadata);
  const plans: string[] = []; const tasks: string[] = [];
  try {
    await client.createInstallation({ rootId, dataDirectory: games });
    for (const instanceId of [a, b]) {
      await client.writeInstance(instanceId, 0, modReadyInstance(rootId, instanceId));
      const id = randomUUID(), plan = planFor(instanceId, id); plans.push(id);
      await client.writeModPlan(id, 0, plan); tasks.push((await client.acceptModConfirmation(id, plan.plan.planId, true)).taskId);
    }
    assert.deepEqual((await client.readModTargets(query)).items.map(item => item.task.taskId), [tasks[1]]);
  } finally { await client.close(); }
  return { metadata, plans, tasks };
}

test('acceptance real worker/SQLite: missing or externally changed A plan blocks the complete B install domain', async t => {
  for (const mode of ['missing', 'changed'] as const) await t.test(mode, async () => {
    const f = await fixture(), file = path.join(f.metadata, `mod-plan-${f.plans[0]}.json`);
    // Change after startup so this exercises read-time proof rather than startup recovery alone.
    const client = await StorageClient.open(entry, f.metadata);
    try {
      if (mode === 'missing') await unlink(file); else await writeFile(file, `${await readFile(file, 'utf8')} `);
      await assert.rejects(client.readModTargets(query), { code: 'NEEDS_RECOVERY' });
    } finally { await client.close(); }
  });
});

test('acceptance real worker/SQLite: journal-consistent future format, cross-root and mismatched confirmation evidence fail closed', async t => {
  const modes = ['future-envelope', 'future-plan', 'cross-root', 'request-mismatch', 'digest-mismatch', 'foreign-instance'] as const;
  for (const mode of modes) await t.test(mode, async () => {
    const f = await fixture(), recordId = mode === 'foreign-instance' ? `instance-${b}` : `mod-plan-${f.plans[0]}`;
    const file = path.join(f.metadata, `${recordId}.json`);
    const envelope = JSON.parse(await readFile(file, 'utf8')) as RecordEnvelope<StoredModPlan>;
    if (mode === 'future-envelope') (envelope as unknown as { schemaVersion: number }).schemaVersion = 2;
    else if (mode === 'future-plan') (envelope.data as unknown as { formatVersion: number }).formatVersion = 2;
    else if (mode === 'cross-root') envelope.data.rootId = foreign;
    else if (mode === 'request-mismatch') envelope.data.requestId = randomUUID();
    else if (mode === 'digest-mismatch') {
      envelope.data.plan.fingerprint = 'd'.repeat(64);
      envelope.data.plan.planId = modPlanDigest(envelope.data.plan);
    } else {
      const value = envelope as unknown as { data: { summary: { rootId: string } } }; value.data.summary.rootId = foreign;
    }
    // Deliberate test-only journal alignment reaches the domain/parser check past generic hash rejection.
    const bytes = JSON.stringify(envelope); await writeFile(file, bytes);
    const db = new DatabaseSync(path.join(f.metadata, 'tasks.sqlite'));
    try { assert.equal(db.prepare("UPDATE operations SET after_json=? WHERE record_id=? AND phase='COMMITTED'").run(bytes, recordId).changes, 1); }
    finally { db.close(); }
    if (mode === 'future-envelope') {
      await assert.rejects(StorageClient.open(entry, f.metadata), { code: 'NEEDS_RECOVERY' });
      return;
    }
    const client = await StorageClient.open(entry, f.metadata);
    try {
      const expected = mode.startsWith('future-') ? 'INVALID_RECORD' : mode === 'foreign-instance' ? 'TARGET_OUT_OF_SCOPE' : 'NEEDS_RECOVERY';
      await assert.rejects(client.readModTargets(query), { code: expected });
      assert.equal((await client.readInstallation())?.data.rootId, rootId);
      for (const id of f.tasks) assert.equal((await client.get(rootId, id))?.taskId, id);
    } finally { await client.close(); }
  });
});

test('acceptance real worker: controlled target-clock crossing 2000ms returns TIMEOUT and keeps worker alive', async t => {
  const f = await fixture(); const wrapper = path.join(f.metadata, 'target-clock.mjs');
  // Inject only the clock used by the production target reader; production source and IO remain unchanged.
  await writeFile(wrapper, `const originalNow=Date.now; let reads=0;
    Date.now=()=>{ if(new Error().stack?.includes('mod-targets.js')) return 100000+(++reads>=3?2001:0); return originalNow(); };
    await import(${JSON.stringify(entry.href)});`);
  const client = await StorageClient.open(new URL(`file:///${wrapper.replaceAll('\\', '/')}`), f.metadata);
  try {
    await assert.rejects(client.readModTargets(query), { code: 'TIMEOUT' });
    assert.equal((await client.readInstallation())?.data.rootId, rootId);
    t.diagnostic('Real worker + SQLite; deterministic injected target-reader Date.now, not wall-clock performance evidence.');
  } finally { await client.close(); }
});

function adapterFixture(count = 101, gate: Promise<void> = Promise.resolve()) {
  const tasks: StoredTask[] = Array.from({ length: count }, () => ({ taskId: randomUUID(), ownerId: rootId,
    kind: 'mod-install', execution: createExecution() }));
  let wait = true;
  const storage = { readInstallation: async () => ({ revision: 1, data: { rootId } }),
    readModTargets: async () => { if (wait) await gate; return { rootId, rootRevision: 1,
      items: tasks.map(task => ({ instanceId: b, instanceRevision: 1, task })) }; } } as unknown as StorageClient;
  const failure = instanceFailure(randomUUID(), 'TASK_STORE_UNAVAILABLE', randomUUID()); assert.ok(!failure.ok);
  const installs = { targetTaskView: (_root: string, task: StoredTask) => ({ snapshot: {
    taskId: task.taskId, kind: task.kind, state: 'needsRecovery', stage: 'needsRecovery', revision: Number.MAX_SAFE_INTEGER,
    bytesDone: Number.MAX_SAFE_INTEGER, bytesTotal: Number.MAX_SAFE_INTEGER, error: failure.error } }) } as unknown as ModInstallTaskService;
  return { adapter: new TargetAdapter(storage, {} as ModTaskService, installs), stopWaiting: () => { wait = false; } };
}

test('acceptance main adapter: real 2500ms deadline retains global pending slots and late replies do not publish snapshots', async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const { adapter, stopWaiting } = adapterFixture(101, gate);
  // Test-only visibility into resource counts; no mutation of production private state.
  const state = adapter as unknown as { snapshots: Map<string, unknown>; cursors: Map<string, unknown> };
  try {
    const start = performance.now(); const one = adapter.handle(request(), true, 1, randomUUID());
    const two = adapter.handle(request(), true, 2, randomUUID()); await tick();
    errorCode(await adapter.handle(request(), true, 3, randomUUID()), 'UNAVAILABLE');
    errorCode(await one, 'TIMEOUT'); errorCode(await two, 'TIMEOUT');
    const elapsed = performance.now() - start; assert.ok(elapsed >= 2400 && elapsed < 10000, `elapsed=${elapsed}`);
    errorCode(await adapter.handle(request(), true, 3, randomUUID()), 'UNAVAILABLE');
    assert.equal(state.snapshots.size, 0); assert.equal(state.cursors.size, 0);
    adapter.removeSender(1); release(); await tick(); await tick(); stopWaiting();
    assert.equal(state.snapshots.size, 0); assert.equal(state.cursors.size, 0);
    assert.ok((await adapter.handle(request(), true, 3, randomUUID())).ok);
    t.diagnostic(`main real-timer deadline observed ${Math.round(elapsed)}ms; storage/projection are controlled doubles`);
  } finally { release(); adapter.close(); }
});

test('acceptance main adapter: at most 16 bounded snapshots / 16MiB serialized payload and 256 cursor references', async t => {
  const { adapter } = adapterFixture(2000);
  const state = adapter as unknown as { snapshots: Map<string, { sender: number; rows: TargetRow[] }>; cursors: Map<string, unknown> };
  try {
    let firstCursor = '', latestCursor = '';
    for (let sender = 1; sender <= 16; sender++) {
      const result = await adapter.handle(request(), true, sender, randomUUID()); assert.ok(result.ok);
      if (sender === 1) firstCursor = result.data.nextCursor!;
      latestCursor = result.data.nextCursor!;
    }
    assert.equal(state.snapshots.size, 16);
    const payloadBytes = [...state.snapshots.values()].map(snapshot => Buffer.byteLength(JSON.stringify({ items: snapshot.rows,
      nextCursor: '00000000-0000-4000-8000-000000000000' })));
    assert.ok(payloadBytes.every(bytes => bytes <= 1024 ** 2));
    const total = payloadBytes.reduce((sum, bytes) => sum + bytes, 0); assert.ok(total <= 16 * 1024 ** 2);
    assert.ok((await adapter.handle(request(), true, 17, randomUUID())).ok); assert.equal(state.snapshots.size, 16);
    errorCode(await adapter.handle(request(firstCursor), true, 1, randomUUID()), 'CURSOR_EXPIRED');
    let repeatCursor = latestCursor;
    for (let n = 0; n < 260; n++) {
      const result = await adapter.handle(request(repeatCursor), true, 16, randomUUID()); assert.ok(result.ok);
      if (n % 32 === 0) repeatCursor = result.data.nextCursor!;
    }
    assert.equal(state.cursors.size, 256);
    errorCode(await adapter.handle(request(latestCursor), true, 16, randomUUID()), 'CURSOR_EXPIRED');
    t.diagnostic(`${total} serialized bytes across 16 x 2000-row snapshots; bound check, not JS heap measurement`);
  } finally { adapter.close(); }
});
