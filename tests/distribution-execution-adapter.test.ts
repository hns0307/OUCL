import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { DistributionExecutionAdapter } from '../src/ipc/distribution-execution.js';
import type { DistributionExecutionPort } from '../src/ipc/distribution-execution.js';
import { DISTRIBUTION_EXECUTION_CHANNELS, distributionExecutionFailure, isDistributionExecutionResult } from '../src/shared/contracts/distribution-execution.js';
import type { DistributionExecutionChannel, DistributionExecutionPayloads, DistributionExecutionRequest, DistributionExecutionResult } from '../src/shared/contracts/distribution-execution.js';

const binding = { rootId: randomUUID(), instanceId: randomUUID(), sourceId: 'fixture', packageId: 'pack', packageVersion: 'v1' };
const prepareId = randomUUID(); const proposalId = randomUUID(); const taskId = randomUUID();
const payloads: DistributionExecutionPayloads = {
  'distribution:prepareExecution': binding,
  'distribution:executionPreparation': { prepareRequestId: prepareId },
  'distribution:cancelExecutionPreparation': { prepareRequestId: prepareId },
  'distribution:confirmExecution': { proposalId, instanceRevision: 1, sequence: 1 },
  'distribution:recoverExecution': { taskId },
};
function request(channel: DistributionExecutionChannel = 'distribution:cancelExecutionPreparation'): DistributionExecutionRequest {
  return { contractVersion: 1, requestId: randomUUID(), payload: structuredClone(payloads[channel]) };
}
function success(channel: DistributionExecutionChannel, value: DistributionExecutionRequest): unknown {
  const snapshot = { taskId, kind: 'distribution-install', state: 'queued', stage: 'queued', revision: 1, bytesDone: 0 };
  const data = channel === 'distribution:prepareExecution' || channel === 'distribution:executionPreparation'
    ? { prepareRequestId: channel === 'distribution:prepareExecution' ? value.requestId : prepareId, state: 'pending', proposal: null, error: null }
    : channel === 'distribution:confirmExecution' ? { taskId, proposalId, snapshot }
      : channel === 'distribution:recoverExecution' ? { taskId, recoveryRequestId: value.requestId, snapshot } : { cancelled: true };
  return { contractVersion: 1, requestId: value.requestId, ok: true, data };
}
function code(value: DistributionExecutionResult): string { assert.equal(value.ok, false); return value.ok ? '' : value.error.code; }
function deferred() {
  let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}
function port(dispatch: DistributionExecutionPort['dispatch']): DistributionExecutionPort {
  return { available: () => true, dispatch, revoke: () => {}, close: async () => {} };
}

test('unconfigured or unavailable execution rejects all five channels before any backend dispatch', async () => {
  let effects = 0;
  for (const adapter of [new DistributionExecutionAdapter(), new DistributionExecutionAdapter({ ...port(async () => { effects++; throw new Error('target IO'); }), available: () => false })]) {
    for (const channel of DISTRIBUTION_EXECUTION_CHANNELS) {
      const input = request(channel); const result = await adapter.handle(channel, input, () => true, randomUUID());
      assert.equal(code(result), 'SOURCE_UNAVAILABLE'); assert.equal(isDistributionExecutionResult(result, input, channel), true);
    }
    await adapter.close();
  }
  assert.equal(effects, 0);
});

test('request and sender validation reject future versions, extras, channels and malformed IDs without dispatch', async () => {
  let calls = 0; const adapter = new DistributionExecutionAdapter(port(async () => { calls++; return {}; }));
  const input = request();
  assert.equal(code(await adapter.handle('distribution:cancelExecutionPreparation', input, () => false, randomUUID())), 'INVALID_SENDER');
  assert.equal(code(await adapter.handle('distribution:cancelExecutionPreparation', input, () => { throw new Error('sender'); }, randomUUID())), 'INVALID_SENDER');
  assert.equal(code(await adapter.handle('distribution:cancelExecutionPreparation', { ...input, contractVersion: 2 }, () => true, randomUUID())), 'UNSUPPORTED_CONTRACT');
  for (const invalid of [{ ...input, extra: 1 }, { ...input, requestId: input.requestId.toUpperCase() }, { ...input, payload: { ...input.payload, path: 'C:/secret' } }]) {
    assert.equal(code(await adapter.handle('distribution:cancelExecutionPreparation', invalid, () => true, randomUUID())), 'INVALID_ARGUMENT');
  }
  assert.equal(code(await adapter.handle('distribution:unknown' as DistributionExecutionChannel, input, () => true, randomUUID())), 'INVALID_ARGUMENT');
  assert.equal(calls, 0); await adapter.close();
});

test('strict complete response envelopes and business identities are checked on every channel', async () => {
  for (const channel of DISTRIBUTION_EXECUTION_CHANNELS) {
    const input = request(channel);
    const adapter = new DistributionExecutionAdapter(port(async (actual, value) => success(actual, value)));
    assert.equal((await adapter.handle(channel, input, () => true, randomUUID())).ok, true); await adapter.close();
    for (const response of [
      { contractVersion: 1, requestId: randomUUID(), ok: true, data: { cancelled: true } },
      { ...success(channel, input) as object, privatePath: 'C:/secret' },
      { contractVersion: 1, requestId: input.requestId, ok: true, data: { prepareRequestId: randomUUID(), state: 'pending', proposal: null, error: null } },
    ]) {
      const invalid = new DistributionExecutionAdapter(port(async () => response));
      assert.equal(code(await invalid.handle(channel, input, () => true, randomUUID())), 'UNAVAILABLE'); await invalid.close();
    }
  }
  const input = request('distribution:prepareExecution');
  const wrongBinding = new DistributionExecutionAdapter(port(async () => ({ contractVersion: 1, requestId: input.requestId, ok: true,
    data: { prepareRequestId: input.requestId, state: 'ready', error: null, proposal: { ...binding, rootId: randomUUID(), proposalId,
      sequence: 1, instanceRevision: 1, expiresAt: 999999, changes: [], conflicts: [] } } })));
  assert.equal(code(await wrongBinding.handle('distribution:prepareExecution', input, () => true, randomUUID())), 'UNAVAILABLE'); await wrongBinding.close();
});

test('active duplicates share the exact promise and sorted flat payload digest rejects changed identities', async () => {
  const gate = deferred(); let calls = 0;
  const adapter = new DistributionExecutionAdapter(port(async (channel, input) => { calls++; await gate.promise; return success(channel, input); }));
  const input = request('distribution:confirmExecution');
  const first = adapter.handle('distribution:confirmExecution', input, () => true, randomUUID());
  const duplicate = adapter.handle('distribution:confirmExecution', { ...input, payload: { sequence: 1, instanceRevision: 1, proposalId } }, () => true, randomUUID());
  assert.equal(first, duplicate);
  const conflict = await adapter.handle('distribution:confirmExecution', { ...input, payload: { proposalId, instanceRevision: 2, sequence: 1 } }, () => true, randomUUID());
  assert.equal(code(conflict), 'REQUEST_CONFLICT');
  assert.equal(code(await adapter.handle('distribution:recoverExecution', { ...input, payload: { taskId } }, () => true, randomUUID())), 'REQUEST_CONFLICT');
  gate.resolve(); assert.equal((await first).ok, true); assert.equal(calls, 1); await adapter.close();
});

test('completed IDs retain digest only and redispatch exact retries without transport pretending durable authorization', async () => {
  let calls = 0; const adapter = new DistributionExecutionAdapter(port(async (channel, input) => { calls++; return success(channel, input); }));
  const input = request();
  const first = await adapter.handle('distribution:cancelExecutionPreparation', input, () => true, randomUUID());
  if (first.ok && 'cancelled' in first.data) first.data.cancelled = false;
  const retry = await adapter.handle('distribution:cancelExecutionPreparation', input, () => true, randomUUID());
  assert.equal(retry.ok && 'cancelled' in retry.data && retry.data.cancelled, true); assert.equal(calls, 2);
  assert.equal(code(await adapter.handle('distribution:cancelExecutionPreparation', { ...input, payload: { prepareRequestId: randomUUID() } }, () => true, randomUUID())), 'REQUEST_CONFLICT');
  await adapter.close();
});

test('active quota16 and seen quota1024 reject new identities without evicting old digests', async () => {
  const gate = deferred(); let calls = 0;
  const adapter = new DistributionExecutionAdapter(port(async (channel, input) => { calls++; await gate.promise; return success(channel, input); }));
  const inputs = Array.from({ length: 16 }, () => request());
  const jobs = inputs.map(input => adapter.handle('distribution:cancelExecutionPreparation', input, () => true, randomUUID()));
  assert.equal(code(await adapter.handle('distribution:cancelExecutionPreparation', request(), () => true, randomUUID())), 'CAPACITY_EXCEEDED');
  gate.resolve(); await Promise.all(jobs); assert.equal(calls, 16); await adapter.close();
  const complete = new DistributionExecutionAdapter(port(async (channel, input) => success(channel, input)));
  const first = request();
  assert.equal((await complete.handle('distribution:cancelExecutionPreparation', first, () => true, randomUUID())).ok, true);
  for (let i = 1; i < 1024; i++) assert.equal((await complete.handle('distribution:cancelExecutionPreparation', request(), () => true, randomUUID())).ok, true);
  assert.equal(code(await complete.handle('distribution:cancelExecutionPreparation', request(), () => true, randomUUID())), 'CAPACITY_EXCEEDED');
  assert.equal((await complete.handle('distribution:cancelExecutionPreparation', first, () => true, randomUUID())).ok, true);
  assert.equal(code(await complete.handle('distribution:cancelExecutionPreparation', { ...first, payload: { prepareRequestId: randomUUID() } }, () => true, randomUUID())), 'REQUEST_CONFLICT');
  await complete.close();
});

test('sender revocation rejects late success or throw even if the same closure becomes trusted again', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(); let trusted = true; let signal: AbortSignal | undefined; let revokes = 0;
    const adapter = new DistributionExecutionAdapter({ ...port(async (channel, input, value) => { signal = value; await gate.promise; if (reject) throw new Error('C:/private'); return success(channel, input); }), revoke: () => { revokes++; } });
    const job = adapter.handle('distribution:cancelExecutionPreparation', request(), () => trusted, randomUUID());
    await setImmediate(); trusted = false; adapter.dispose(); trusted = true;
    assert.equal(signal?.aborted, true); assert.equal(revokes, 1);
    gate.resolve(); assert.equal(code(await job), 'INVALID_SENDER');
    assert.equal(code(await adapter.handle('distribution:cancelExecutionPreparation', request(), () => true, randomUUID())), 'INVALID_SENDER');
    await adapter.close(); assert.equal(revokes, 1);
  }
  const gate = deferred(); let trusted = true;
  const adapter = new DistributionExecutionAdapter(port(async (channel, input) => { await gate.promise; return success(channel, input); }));
  const job = adapter.handle('distribution:cancelExecutionPreparation', request(), () => trusted, randomUUID());
  await setImmediate(); trusted = false; gate.resolve(); assert.equal(code(await job), 'INVALID_SENDER'); await adapter.close();
});

test('close aborts immediately but waits for noncooperative real promise settlement before port close', async () => {
  const gate = deferred(); let closed = false; let settled = false; let signal: AbortSignal | undefined;
  const adapter = new DistributionExecutionAdapter({ ...port(async (channel, input, value) => { signal = value; await gate.promise; return success(channel, input); }), close: async () => { closed = true; } });
  const job = adapter.handle('distribution:cancelExecutionPreparation', request(), () => true, randomUUID()); await setImmediate();
  const closing = adapter.close(); assert.equal(closing, adapter.close()); void closing.then(() => { settled = true; });
  await setImmediate(); assert.equal(signal?.aborted, true); assert.equal(closed, false); assert.equal(settled, false);
  gate.resolve(); assert.equal(code(await job), 'INVALID_SENDER'); await closing; assert.equal(closed, true);
});

test('upstream errors are redacted while exact public error envelopes preserve commit-too-late semantics', async () => {
  const input = request('distribution:confirmExecution'); const trace = randomUUID();
  const accepted = new DistributionExecutionAdapter(port(async () => distributionExecutionFailure(input.requestId, 'CANCEL_TOO_LATE', trace)));
  assert.equal(code(await accepted.handle('distribution:confirmExecution', input, () => true, randomUUID())), 'CANCEL_TOO_LATE'); await accepted.close();
  const failed = new DistributionExecutionAdapter(port(async () => { throw new Error('secret C:/private token'); }));
  const result = await failed.handle('distribution:confirmExecution', input, () => true, randomUUID());
  assert.equal(code(result), 'UNAVAILABLE'); assert.equal(JSON.stringify(result).includes('secret'), false); await failed.close();
  const closeFails = new DistributionExecutionAdapter({ ...port(async () => ({})), revoke: () => { throw new Error('secret'); }, close: async () => { throw new Error('secret'); } });
  const closing = closeFails.close(); await assert.rejects(closing, { message: 'UNAVAILABLE' }); assert.equal(closing, closeFails.close());
});
