import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ModPlanService } from '../src/services/mods/plans.js';
import { modPlanDigest, modPlanInputDigest } from '../src/services/mods/plan-identity.js';
import { assertModPlanTransition, modPlanRecordId, parseStoredModPlan } from '../src/services/storage/mod-plans.js';
import type { StoredModPlan } from '../src/services/storage/mod-plans.js';
import { RecordStore } from '../src/services/storage/records.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { parseReply, parseStorageRequest, WorkerError } from '../src/services/workers/protocol.js';
import { ModContractError } from '../src/shared/contracts/mods.js';
import type { ModInstallPlan, ModPayloads } from '../src/shared/contracts/mods.js';
import { handleMods, modDispatcher } from '../src/ipc/mods.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';
import { modConfirmationDigest } from '../src/services/mods/plan-identity.js';
import { controlTask } from '../src/core/task/machine.js';

const entry = process.env.OUCL_MOD_PLAN_BUNDLED_WORKER === '1'
  ? new URL('../../dist/workers/entry.cjs', import.meta.url) : new URL('../src/services/workers/entry.js', import.meta.url);
const rootId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000000002';
const input: ModPayloads['mods:plan'] = { instanceId, expectedRevision: 1,
  root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: 'a'.repeat(40) }, selections: {} };
function preview(): ModInstallPlan {
  const body: Omit<ModInstallPlan, 'planId'> = { formatVersion: 1, instanceId, instanceRevision: 1,
    fingerprint: 'b'.repeat(64), minecraft: '1.20.1', loader: 'fabric', rootVersionId: 'RootVer1', state: 'ready', attempts: 2,
    totalDownloadBytes: 7, items: [
      { projectId: 'Depends1', versionId: 'DepVers1', filename: 'dependency.jar', fileId: 'c'.repeat(40), sha512: 'd'.repeat(128), size: 7,
        disposition: 'download', requiredBy: ['RootProj'] },
      { projectId: 'RootProj', versionId: 'RootVer1', filename: 'root.jar', fileId: 'a'.repeat(40), sha512: 'e'.repeat(128), size: 17,
        disposition: 'library', requiredBy: [] }], issues: [] };
  return { ...body, planId: modPlanDigest(body) };
}
function stored(requestId = randomUUID()): StoredModPlan {
  return { formatVersion: 1, rootId, requestId, payloadDigest: modPlanInputDigest(input), input: structuredClone(input), plan: preview(), status: 'preview' };
}
async function fixture() {
  const base = await mkdtemp(path.resolve('.test-build/mod-plans-'));
  const directory = path.join(base, 'metadata'); const games = path.join(base, 'games'); await mkdir(directory); await mkdir(games);
  const storage = await StorageClient.open(entry, directory); await storage.createInstallation({ rootId, dataDirectory: games });
  return { base, directory, storage };
}
const unavailablePlanner = { plan: async (): Promise<never> => { throw new Error('SHOULD_NOT_REPEAT_METADATA'); } };
const inspection = { start: async () => ({ taskId: randomUUID() }), report: async () => ({ report: null, errorCode: null }) };

test('durable confirmation wins cancellation, joins retries and is discoverable after worker restart', async () => {
  const f = await fixture(); const data = stored();
  let taskId: string;
  try {
    await f.storage.writeInstance(instanceId, 0, modReadyInstance(rootId, instanceId));
    await f.storage.writeModPlan(data.requestId, 0, data);
    const first = await f.storage.acceptModConfirmation(data.requestId.toUpperCase(), data.plan.planId, true); taskId = first.taskId;
    assert.equal(first.kind, 'mod-install');
    assert.equal((await f.storage.acceptModConfirmation(data.requestId, data.plan.planId, true)).taskId, taskId);
    await assert.rejects(f.storage.writeModPlan(data.requestId, 1, { ...data, status: 'cancelled' }), { code: 'CANCEL_TOO_LATE' });
    const service = new ModPlanService(f.storage, unavailablePlanner);
    try { await assert.rejects(service.cancel(data.requestId, data.plan.planId), { code: 'CANCEL_TOO_LATE' }); }
    finally { await service.close(); }
    const current = await f.storage.update(rootId, taskId, first.execution.revision, controlTask(first.execution, 'start').execution);
    assert.equal(current.execution.state, 'running');
  } finally { await f.storage.close(); }
  const reopened = await StorageClient.open(entry, f.directory);
  try {
    const rows = await reopened.readModConfirmations(); assert.equal(rows.length, 1);
    assert.equal(rows[0]!.planRequestId, data.requestId); assert.equal(rows[0]!.task.taskId, taskId);
    assert.equal(rows[0]!.payloadDigest, modConfirmationDigest(data.requestId, data.plan.planId));
    assert.equal(rows[0]!.task.execution.state, 'needsRecovery');
    assert.equal((await reopened.acceptModConfirmation(data.requestId, data.plan.planId, true)).taskId, taskId);
    assert.equal((await reopened.readModPlan(data.requestId))!.data.status, 'preview');
  } finally { await reopened.close(); }
});

test('cancel wins confirmation and rejected admission never creates an orphan task', async () => {
  const f = await fixture(); const data = stored();
  try {
    await f.storage.writeInstance(instanceId, 0, modReadyInstance(rootId, instanceId));
    await f.storage.writeModPlan(data.requestId, 0, data);
    // Deliberately queue both messages: the storage worker serializes their decision point.
    const cancelled = f.storage.writeModPlan(data.requestId, 1, { ...data, status: 'cancelled' });
    const admission = f.storage.acceptModConfirmation(data.requestId, data.plan.planId, true);
    await cancelled; await assert.rejects(admission, { code: 'CANCELLED' });
    assert.deepEqual(await f.storage.readModConfirmations(), []);
  } finally { await f.storage.close(); }
});

test('admission rejects stale, foreign, unknown and substituted previews before allocating tasks', async () => {
  const f = await fixture();
  try {
    const data = stored(); await f.storage.writeModPlan(data.requestId, 0, data);
    await assert.rejects(f.storage.acceptModConfirmation(data.requestId, data.plan.planId, true), { code: 'REVISION_CONFLICT' });
    await f.storage.writeInstance(instanceId, 0, modReadyInstance(rootId, instanceId));
    await assert.rejects(f.storage.acceptModConfirmation(data.requestId, '0'.repeat(64), true), { code: 'REVISION_CONFLICT' });
    const foreign = { ...stored(), rootId: randomUUID() }; await f.storage.writeModPlan(foreign.requestId, 0, foreign);
    await assert.rejects(f.storage.acceptModConfirmation(foreign.requestId, foreign.plan.planId, true), { code: 'REVISION_CONFLICT' });
    const body = { ...preview(), state: 'unknown' as const }; body.planId = modPlanDigest(body);
    const unknown = { ...stored(), plan: body }; await f.storage.writeModPlan(unknown.requestId, 0, unknown);
    await assert.rejects(f.storage.acceptModConfirmation(unknown.requestId, unknown.plan.planId, true), { code: 'INVALID_RECORD' });
    assert.deepEqual(await f.storage.readModConfirmations(), []);
  } finally { await f.storage.close(); }
});

test('confirmation bridge rejects false confirmation, extra fields and generic acceptance bypass', () => {
  const command = { kind: 'mod-confirm:accept', planRequestId: randomUUID(), planId: 'a'.repeat(64), confirmed: true };
  for (const bad of [{ ...command, confirmed: false }, { ...command, path: 'private' }, { ...command, planRequestId: '../escape' },
    { kind: 'accept', ownerId: rootId, requestId: randomUUID(), taskKind: 'mod-install', payloadDigest: 'a'.repeat(64) }]) {
    assert.throws(() => parseStorageRequest({ version: 1, id: randomUUID(), command: bad }));
  }
  const reply = { version: 1, kind: 'response', id: randomUUID(), ok: true };
  assert.throws(() => parseReply({ ...reply, modConfirmations: new Array(1001).fill({}) }));
  assert.throws(() => parseReply({ ...reply, modConfirmations: [{ planRequestId: randomUUID(), payloadDigest: 'a'.repeat(64), task: {} }] }));
});

test('saved plan schema binds request, target and content digests, and rejects mutable evidence', () => {
  const data = stored(); assert.deepEqual(parseStoredModPlan(data), data);
  assert.throws(() => modPlanRecordId('../private'), { code: 'INVALID_RECORD' });
  assert.equal(modPlanRecordId(data.requestId.toUpperCase()), modPlanRecordId(data.requestId));
  for (const bad of [{ ...data, formatVersion: 2 }, { ...data, path: 'private' }, { ...data, status: 'confirmed' },
    { ...data, payloadDigest: '0'.repeat(64) }, { ...data, plan: { ...data.plan, minecraft: '1.21.1' } },
    { ...data, input: { ...input, expectedRevision: 2 } }]) assert.throws(() => parseStoredModPlan(bad), { code: 'INVALID_RECORD' });
  const incorrectTotal = { ...preview(), totalDownloadBytes: 8 }; incorrectTotal.planId = modPlanDigest(incorrectTotal);
  assert.throws(() => parseStoredModPlan({ ...data, plan: incorrectTotal }), { code: 'INVALID_RECORD' });
  const wrongRoot = { ...preview(), items: preview().items.slice(0, 1) }; wrongRoot.planId = modPlanDigest(wrongRoot);
  assert.throws(() => parseStoredModPlan({ ...data, plan: wrongRoot }), { code: 'INVALID_RECORD' });
  assert.throws(() => assertModPlanTransition(data, { ...data, input: { ...input, expectedRevision: 2 } }), { code: 'INVALID_RECORD' });
  assertModPlanTransition(data, { ...data, status: 'cancelled' });
  assert.throws(() => assertModPlanTransition({ ...data, status: 'cancelled' }, data), { code: 'INVALID_RECORD' });
});

test('private plan bridge rejects paths, mismatched request identities and forged status revisions', () => {
  const data = stored(); const id = randomUUID();
  const command = { kind: 'mod-plan:set', requestId: data.requestId, expectedRevision: 0, data };
  assert.equal(parseStorageRequest({ version: 1, id, command }).command.kind, 'mod-plan:set');
  for (const bad of [{ ...command, path: 'private' }, { ...command, requestId: randomUUID() },
    { ...command, expectedRevision: 1 }, { ...command, expectedRevision: 0, data: { ...data, status: 'cancelled' } }]) {
    assert.throws(() => parseStorageRequest({ version: 1, id, command: bad }));
  }
  assert.throws(() => parseReply({ version: 1, kind: 'response', id, ok: true,
    modPlan: { schemaVersion: 1, revision: 2, data } }), { code: 'INVALID_MESSAGE' });
});

test('real plan worker persists immutable previews, enforces CAS, and retains cancelled records across restart', async () => {
  const f = await fixture(); const data = stored();
  try {
    assert.equal((await f.storage.writeModPlan(data.requestId, 0, data)).revision, 1);
    await assert.rejects(f.storage.writeModPlan(data.requestId, 0, data), { code: 'REVISION_CONFLICT' });
    const substituted = { ...data.plan, minecraft: '1.21.1' }; substituted.planId = modPlanDigest(substituted);
    await assert.rejects(f.storage.writeModPlan(data.requestId, 1, { ...data, plan: substituted, status: 'cancelled' }), { code: 'INVALID_RECORD' });
    assert.equal((await f.storage.writeModPlan(data.requestId, 1, { ...data, status: 'cancelled' })).revision, 2);
    await assert.rejects(f.storage.writeModPlan(data.requestId, 0, data), { code: 'INVALID_RECORD' });
    assert.equal(await f.storage.readModPlan(randomUUID()), undefined);
  } finally { await f.storage.close(); }
  const reopened = await StorageClient.open(entry, f.directory);
  try { assert.deepEqual((await reopened.readModPlan(data.requestId))?.data, { ...data, status: 'cancelled' }); }
  finally { await reopened.close(); }
});

test('unknown saved plan formats stop writes and preserve original JSON byte for byte', async () => {
  const f = await fixture(); await f.storage.close(); const data = stored(); const recordId = modPlanRecordId(data.requestId);
  const store = await RecordStore.open(f.directory);
  try { await store.recover(); await store.write(recordId, 0, { ...data, formatVersion: 2, future: 'preserve' }, value => value); }
  finally { await store.close(); }
  const file = path.join(f.directory, `${recordId}.json`); const before = await readFile(file);
  const storage = await StorageClient.open(entry, f.directory);
  try {
    await assert.rejects(storage.readModPlan(data.requestId), { code: 'INVALID_RECORD' });
    await assert.rejects(storage.writeModPlan(data.requestId, 1, { ...data, status: 'cancelled' }), { code: 'INVALID_RECORD' });
  } finally { await storage.close(); }
  assert.deepEqual(await readFile(file), before);
});

test('plan retries and a real storage restart return the same saved evidence without repeating metadata work', async () => {
  const f = await fixture(); let calls = 0; const requestId = randomUUID();
  const service = new ModPlanService(f.storage, { plan: async () => { calls++; return preview(); } });
  try {
    const first = await service.create(requestId, input);
    first.items[0]!.filename = 'caller-change.jar';
    assert.equal((await service.create(requestId.toUpperCase(), structuredClone(input))).items[0]?.filename, 'dependency.jar');
    assert.equal(calls, 1);
    await assert.rejects(service.create(requestId, { ...input, expectedRevision: 2 }), { code: 'REVISION_CONFLICT' });
  } finally { await service.close(); await f.storage.close(); }
  const storage = await StorageClient.open(entry, f.directory); const reopened = new ModPlanService(storage, unavailablePlanner);
  try {
    assert.deepEqual(await reopened.get(requestId), { status: 'preview', plan: preview() });
    assert.deepEqual(await reopened.create(requestId, input), preview());
    await assert.rejects(reopened.get(randomUUID()), { code: 'NOT_FOUND' });
  } finally { await reopened.close(); await storage.close(); }
});

test('same in-flight plan joins with independent outputs; other requests are bounded and inputs are snapshotted', async () => {
  const f = await fixture(); let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
  const submitted = structuredClone(input); submitted.selections = { Depends1: 'DepVers1', RootProj: 'RootVer1' };
  let calls = 0;
  const service = new ModPlanService(f.storage, { plan: async selected => {
    calls++; entered(); await gate; assert.equal(selected.expectedRevision, 1); return preview();
  } });
  try {
    const requestId = randomUUID(); const first = service.create(requestId, submitted);
    submitted.expectedRevision = 99;
    const second = service.create(requestId, { ...input, selections: { RootProj: 'RootVer1', Depends1: 'DepVers1' } });
    await started; await assert.rejects(service.create(randomUUID(), input), { code: 'SCAN_BUSY' });
    await assert.rejects(service.create(requestId, input), { code: 'REVISION_CONFLICT' }); release();
    const [left, right] = await Promise.all([first, second]); assert.equal(calls, 1);
    left.items[0]!.filename = 'changed.jar'; assert.equal(right.items[0]?.filename, 'dependency.jar');
  } finally { release(); await service.close(); await f.storage.close(); }
});

test('cancellation is durable, checks exact plan identity and never reactivates the same request', async () => {
  const f = await fixture(); const requestId = randomUUID(); const service = new ModPlanService(f.storage, { plan: async () => preview() });
  try {
    const plan = await service.create(requestId, input);
    await assert.rejects(service.cancel(requestId, '0'.repeat(64)), { code: 'REVISION_CONFLICT' });
    const [first, second] = await Promise.all([service.cancel(requestId, plan.planId), service.cancel(requestId, plan.planId)]);
    assert.deepEqual(first, second); assert.equal(first.status, 'cancelled');
    assert.equal((await f.storage.readModPlan(requestId))?.revision, 2);
    await assert.rejects(service.create(requestId, input), { code: 'CANCELLED' });
    assert.deepEqual(await service.cancel(requestId, plan.planId), first);
    assert.deepEqual(await service.get(requestId), first);
    assert.equal((await service.create(randomUUID(), input)).state, 'ready');
  } finally { await service.close(); await f.storage.close(); }
});

test('lost write acknowledgement reconciles only exactly committed plan evidence', async () => {
  const f = await fixture(); let failBeforeCommit = false;
  const repository = { readInstallation: () => f.storage.readInstallation(), readModPlan: (id: string) => f.storage.readModPlan(id),
    writeModPlan: async (id: string, revision: number, data: StoredModPlan) => {
      if (failBeforeCommit) throw new WorkerError('TIMEOUT');
      await f.storage.writeModPlan(id, revision, data); throw new WorkerError('TIMEOUT');
    } };
  const service = new ModPlanService(repository, { plan: async () => preview() });
  try {
    const requestId = randomUUID(); const plan = await service.create(requestId, input);
    assert.equal((await service.cancel(requestId, plan.planId)).status, 'cancelled');
    failBeforeCommit = true; const missing = randomUUID();
    await assert.rejects(service.create(missing, input), { code: 'NEEDS_RECOVERY' });
    assert.equal(await f.storage.readModPlan(missing), undefined);
  } finally { await service.close(); await f.storage.close(); }
});

test('closing joins a cancellation already being persisted and rejects later operations', async () => {
  const f = await fixture(); let entered!: () => void; let release!: () => void;
  const writing = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const repository = { readInstallation: () => f.storage.readInstallation(), readModPlan: (id: string) => f.storage.readModPlan(id),
    writeModPlan: async (id: string, revision: number, data: StoredModPlan) => {
      if (revision === 1) { entered(); await gate; } return f.storage.writeModPlan(id, revision, data);
    } };
  const service = new ModPlanService(repository, { plan: async () => preview() });
  try {
    const id = randomUUID(); const plan = await service.create(id, input); const cancelled = service.cancel(id, plan.planId); await writing;
    let stopped = false; const stopping = service.close().then(() => { stopped = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(stopped, false);
    release(); assert.equal((await cancelled).status, 'cancelled'); await stopping;
    await assert.rejects(service.create(randomUUID(), input), { code: 'UNAVAILABLE' });
    await assert.rejects(service.get(id), { code: 'UNAVAILABLE' });
    await assert.rejects(service.cancel(id, plan.planId), { code: 'UNAVAILABLE' });
  } finally { release(); await service.close(); await f.storage.close(); }
});

test('closing an active metadata preview aborts and joins it without publishing a plan', async () => {
  const f = await fixture(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const service = new ModPlanService(f.storage, { plan: async (_input, signal) => {
    entered(); await new Promise<void>(resolve => { if (signal?.aborted) resolve(); else signal?.addEventListener('abort', () => { resolve(); }, { once: true }); });
    throw new ModContractError('CANCELLED');
  } });
  const id = randomUUID(); const creating = service.create(id, input); const failed = assert.rejects(creating, { code: 'CANCELLED' });
  try { await started; await service.close(); await failed; assert.equal(await f.storage.readModPlan(id), undefined); }
  finally { await service.close(); await f.storage.close(); }
});

test('public saved-plan operations validate correlation, redact private records and refuse untrusted cancellation', async () => {
  const f = await fixture(); const plans = new ModPlanService(f.storage, { plan: async () => preview() });
  const dispatch = modDispatcher(inspection, undefined, plans); const requestId = randomUUID(); const trace = randomUUID();
  try {
    const result = await handleMods('mods:plan', { contractVersion: 1, requestId, payload: input }, true, trace, dispatch); assert.ok(result.ok);
    const envelope = { contractVersion: 1, requestId: randomUUID(), payload: { planRequestId: requestId } };
    const saved = await handleMods('mods:planState', envelope, true, trace, dispatch); assert.ok(saved.ok);
    assert.equal(saved.data.status, 'preview'); assert.equal(JSON.stringify(saved).includes('payloadDigest'), false);
    assert.equal(JSON.stringify(saved).includes(f.directory), false);
    const cancel = { ...envelope, payload: { planRequestId: requestId, planId: result.data.plan.planId } };
    const untrusted = await handleMods('mods:cancelPlan', cancel, false, trace, dispatch);
    assert.ok(!untrusted.ok); assert.equal(untrusted.error.code, 'INVALID_SENDER');
    const invalid = await handleMods('mods:planState', { ...envelope, payload: { planRequestId: '../private' } }, true, trace, dispatch);
    assert.ok(!invalid.ok); assert.equal(invalid.error.code, 'INVALID_ARGUMENT');
    const cancelled = await handleMods('mods:cancelPlan', cancel, true, trace, dispatch);
    assert.ok(cancelled.ok); assert.equal(cancelled.data.status, 'cancelled');
  } finally { await plans.close(); await f.storage.close(); }
});
