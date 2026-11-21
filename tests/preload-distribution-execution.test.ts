import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDistributionExecutionBridge } from '../src/ipc/preload-distribution-execution.js';
import { DISTRIBUTION_EXECUTION_CHANNELS, distributionExecutionFailure, isDistributionExecutionRequest } from '../src/shared/contracts/distribution-execution.js';
import type { DistributionExecutionBinding, DistributionExecutionChannel, DistributionExecutionRequest } from '../src/shared/contracts/distribution-execution.js';

const binding: DistributionExecutionBinding = { rootId: randomUUID(), instanceId: randomUUID(), sourceId: 'synthetic-source', packageId: 'synthetic-pack', packageVersion: '1' };
const proposalId = randomUUID(); const taskId = randomUUID();
const confirmation = { proposalId, instanceRevision: 1, sequence: 1 };
function success(channel: string, input: unknown) {
  assert.ok(DISTRIBUTION_EXECUTION_CHANNELS.includes(channel as DistributionExecutionChannel));
  assert.ok(isDistributionExecutionRequest(input, channel as DistributionExecutionChannel));
  const snapshot = { taskId, kind: 'distribution-install', state: 'queued', stage: 'queued', revision: 1, bytesDone: 0 };
  let data: unknown;
  switch (channel) {
    case 'distribution:prepareExecution': data = { prepareRequestId: input.requestId, state: 'ready', error: null,
      proposal: { ...binding, proposalId, instanceRevision: 1, sequence: 1, expiresAt: 1795000000000, changes: [], conflicts: [] } }; break;
    case 'distribution:executionPreparation': data = { prepareRequestId: (input.payload as { prepareRequestId: string }).prepareRequestId, state: 'pending', error: null, proposal: null }; break;
    case 'distribution:cancelExecutionPreparation': data = { cancelled: true }; break;
    case 'distribution:confirmExecution': data = { proposalId, taskId, snapshot }; break;
    case 'distribution:recoverExecution': data = { taskId, recoveryRequestId: input.requestId, snapshot }; break;
    default: assert.fail('Unexpected channel');
  }
  return { contractVersion: 1, requestId: input.requestId, ok: true, data };
}
function code(result: { ok: boolean; error?: { code: string } }, expected: string) { assert.equal(result.ok, false); assert.equal(result.error?.code, expected); }

test('five fixed methods send exact payloads and preserve caller identities', async () => {
  const calls: Array<{ channel: string; input: unknown }> = [];
  const bridge = createDistributionExecutionBridge({ invoke: async (channel, input) => { calls.push({ channel, input }); return success(channel, input); } });
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  assert.equal((await bridge.prepareDistributionExecution(ids[0]!, binding)).ok, true);
  assert.equal((await bridge.getDistributionExecutionPreparation(ids[0]!)).ok, true);
  assert.equal((await bridge.cancelDistributionExecutionPreparation(ids[0]!)).ok, true);
  assert.equal((await bridge.confirmDistributionExecution(ids[1]!, confirmation)).requestId, ids[1]);
  assert.equal((await bridge.recoverDistributionExecution(ids[2]!, taskId)).requestId, ids[2]);
  assert.deepEqual(calls.map(row => row.channel), DISTRIBUTION_EXECUTION_CHANNELS);
  const requests = calls.map(row => row.input as DistributionExecutionRequest);
  assert.deepEqual(requests[0]!.payload, binding); assert.deepEqual(requests[3]!.payload, confirmation);
  assert.deepEqual(requests[4]!.payload, { taskId });
  assert.notEqual(requests[1]!.requestId, ids[0]); assert.notEqual(requests[2]!.requestId, requests[1]!.requestId);
});

test('local invalid UUID, extra fields and unsafe identifiers never invoke', async () => {
  let calls = 0; const bridge = createDistributionExecutionBridge({ invoke: async () => { calls++; return null; } });
  const id = randomUUID();
  for (const result of [await bridge.prepareDistributionExecution(id.toUpperCase(), binding),
    await bridge.prepareDistributionExecution(id, { ...binding, sourceId: '../escape' }),
    await bridge.prepareDistributionExecution(id, { ...binding, extra: true } as DistributionExecutionBinding),
    await bridge.getDistributionExecutionPreparation('invalid'), await bridge.cancelDistributionExecutionPreparation('invalid'),
    await bridge.confirmDistributionExecution(id, { ...confirmation, sequence: 0 }), await bridge.recoverDistributionExecution(id, '../task')]) code(result, 'INVALID_ARGUMENT');
  assert.equal(calls, 0);
});

test('wrong envelope and business identities are redacted as unavailable', async () => {
  for (const scenario of ['request', 'root', 'prepare', 'proposal', 'task', 'recovery']) {
    const bridge = createDistributionExecutionBridge({ invoke: async (channel, input) => {
      const value = success(channel, input);
      if (scenario === 'request') return { ...value, requestId: randomUUID() };
      if (scenario === 'root') return { ...value, data: { prepareRequestId: (input as DistributionExecutionRequest).requestId, state: 'ready', error: null,
        proposal: { ...binding, rootId: randomUUID(), proposalId, sequence: 1, instanceRevision: 1, expiresAt: 1, changes: [], conflicts: [] } } };
      if (scenario === 'prepare') return { ...value, data: { prepareRequestId: randomUUID(), state: 'pending', proposal: null, error: null } };
      if (scenario === 'proposal') return { ...value, data: { ...(value.data as object), proposalId: randomUUID() } };
      if (scenario === 'task') return { ...value, data: { ...(value.data as object), taskId: randomUUID() } };
      return { ...value, data: { ...(value.data as object), recoveryRequestId: randomUUID() } };
    } });
    const result = scenario === 'proposal' ? await bridge.confirmDistributionExecution(randomUUID(), confirmation)
      : scenario === 'task' || scenario === 'recovery' ? await bridge.recoverDistributionExecution(randomUUID(), taskId)
        : await bridge.prepareDistributionExecution(randomUUID(), binding);
    code(result, 'UNAVAILABLE');
  }
});

test('rejects future versions, wrong task kind, unsafe paths, huge, cyclic and throwing outputs', async () => {
  for (const scenario of ['version', 'kind', 'path', 'huge', 'cycle', 'getter']) {
    const bridge = createDistributionExecutionBridge({ invoke: async (channel, input) => {
      const value = success(channel, input);
      if (scenario === 'version') return { ...value, contractVersion: 2 };
      if (scenario === 'kind') return { ...value, data: { taskId, proposalId, snapshot: { taskId, kind: 'install', state: 'queued', stage: 'queued', revision: 1, bytesDone: 0 } } };
      if (scenario === 'path') return { ...value, data: { prepareRequestId: (input as DistributionExecutionRequest).requestId, state: 'ready', error: null,
        proposal: { ...binding, proposalId, sequence: 1, instanceRevision: 1, expiresAt: 1, changes: [{ area: 'mods', path: '../escape.jar', kind: 'add' }], conflicts: [] } } };
      if (scenario === 'huge') return { ...value, secret: 'x'.repeat(1048577) };
      if (scenario === 'cycle') { const cyclic: { self?: unknown } = {}; cyclic.self = cyclic; return cyclic; }
      return { get ok(): boolean { throw new Error('C:/private/token'); } };
    } });
    const result = scenario === 'kind' ? await bridge.confirmDistributionExecution(randomUUID(), confirmation) : await bridge.prepareDistributionExecution(randomUUID(), binding);
    code(result, 'UNAVAILABLE'); assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('upstream fixed errors pass through while unknown codes and detail injection are rejected', async () => {
  for (const scenario of ['valid', 'unknown', 'detail']) {
    const bridge = createDistributionExecutionBridge({ invoke: async (_channel, input) => {
      const value = distributionExecutionFailure((input as DistributionExecutionRequest).requestId, 'SOURCE_UNAVAILABLE', randomUUID());
      assert.equal(value.ok, false); if (value.ok) return value;
      return scenario === 'valid' ? value : { ...value, error: { ...value.error, ...(scenario === 'unknown' ? { code: 'SECRET' } : { detail: 'C:/private' }) } };
    } });
    code(await bridge.prepareDistributionExecution(randomUUID(), binding), scenario === 'valid' ? 'SOURCE_UNAVAILABLE' : 'UNAVAILABLE');
  }
});

test('sync throws and async rejection expose no exception details', async () => {
  for (const invoke of [() => { throw new Error('C:/private/token'); }, async () => { throw new Error('C:/private/token'); }]) {
    const bridge = createDistributionExecutionBridge({ invoke }); const id = randomUUID();
    const result = await bridge.confirmDistributionExecution(id, confirmation); code(result, 'UNAVAILABLE');
    assert.equal(result.requestId, id); assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('timeout preserves identity without retries or cancel; late completion cannot replace returned result', async () => {
  let settle!: (value: unknown) => void; let captured: unknown; const calls: string[] = [];
  const bridge = createDistributionExecutionBridge({ invoke: (channel, input) => { calls.push(channel); captured = input; return new Promise(resolve => { settle = resolve; }); } }, 5);
  const id = randomUUID(); const result = await bridge.confirmDistributionExecution(id, confirmation);
  code(result, 'TIMEOUT'); assert.equal(result.requestId, id);
  settle(success('distribution:confirmExecution', captured)); await new Promise<void>(resolve => setImmediate(resolve));
  code(result, 'TIMEOUT'); assert.deepEqual(calls, ['distribution:confirmExecution']);
});

test('late rejection is handled; timeout override cannot relax production budget', async () => {
  let reject!: (error: Error) => void;
  const bridge = createDistributionExecutionBridge({ invoke: () => new Promise((_resolve, fail) => { reject = fail; }) }, 5);
  const id = randomUUID(); code(await bridge.recoverDistributionExecution(id, taskId), 'TIMEOUT');
  reject(new Error('late private failure')); await new Promise<void>(resolve => setImmediate(resolve));
  for (const timeout of [0, -1, 3001, 1.5, NaN]) assert.throws(() => createDistributionExecutionBridge({ invoke: async () => null }, timeout), RangeError);
});

test('input and result snapshots are detached from caller and transport references', async () => {
  let resolve!: (value: unknown) => void; let captured: unknown;
  const bridge = createDistributionExecutionBridge({ invoke: (_channel, input) => { captured = input; return new Promise(done => { resolve = done; }); } });
  const local = { ...binding }; const pending = bridge.prepareDistributionExecution(randomUUID(), local); local.sourceId = 'changed';
  assert.equal((captured as DistributionExecutionRequest<'distribution:prepareExecution'>).payload.sourceId, binding.sourceId);
  const original = success('distribution:prepareExecution', captured); resolve(original); const result = await pending;
  original.requestId = randomUUID(); assert.notEqual(result.requestId, original.requestId);
});
