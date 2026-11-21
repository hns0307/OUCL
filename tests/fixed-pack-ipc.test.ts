import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedPackPreview } from '../src/core/packs/fixed-preview.js';
import { handleFixedPack } from '../src/ipc/packs.js';
import { isPackResult } from '../src/shared/contracts/packs.js';
import { FixedPackCoordinator } from '../src/services/packs/coordinator.js';

const ID = '00000000-0000-4000-8000-000000000001';
const TRACE = '00000000-0000-4000-8000-000000000002';
const request = { contractVersion: 1, requestId: ID, payload: {} };
const data = { state: 'preview' as const, preview: fixedPackPreview(889) };
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
};
test('sender, envelope and exact payload checked before selection', async () => {
  let calls = 0; const run = async () => { calls++; return data; };
  for (const [input, trusted, code] of [[request, false, 'INVALID_SENDER'], [{ ...request, contractVersion: 2 }, true, 'UNSUPPORTED_CONTRACT'],
    [{ ...request, payload: { file: 'unsafe' } }, true, 'INVALID_ARGUMENT']] as const) {
    const result = await handleFixedPack(input, trusted, TRACE, run); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, code);
  }
  assert.equal(calls, 0);
});
test('result validates only exact fixed facts and maps redacted failures', async () => {
  const result = await handleFixedPack(request, true, TRACE, async () => data); assert.equal(result.ok, true); assert.ok(isPackResult(result, ID));
  const forged = { contractVersion: 1, requestId: ID, ok: true, data: { ...data, preview: { ...data.preview, status: 'ready' } } };
  assert.equal(isPackResult(forged, ID), false);
  const failed = await handleFixedPack(request, true, TRACE, async () => { throw new Error('INVALID_SAMPLE'); });
  assert.equal(failed.ok, false); if (!failed.ok) assert.equal(failed.error.code, 'FIXED_SAMPLE_MISMATCH');
});
test('same request joins chooser; another request cannot open a second chooser', async () => {
  const choice = deferred<string | undefined>(); let calls = 0;
  const service = new FixedPackCoordinator(async () => fixedPackPreview(889));
  const select = (): Promise<string | undefined> => { calls++; return choice.promise; };
  const first = service.inspect(1, ID, () => true, select); const second = service.inspect(1, ID, () => true, select);
  await assert.rejects(service.inspect(1, TRACE, () => true, select), /UNAVAILABLE/);
  choice.resolve(undefined); assert.deepEqual(await first, { state: 'cancelled' }); assert.deepEqual(await second, { state: 'cancelled' }); assert.equal(calls, 1);
});
test('sender destruction waits for chooser and discards late selected path', async () => {
  const choice = deferred<string | undefined>(); let invoked = false;
  const service = new FixedPackCoordinator(async () => { invoked = true; return fixedPackPreview(889); });
  const pending = service.inspect(1, ID, () => true, () => choice.promise); service.removeSender(1);
  await assert.rejects(service.inspect(1, TRACE, () => true, async () => undefined), /UNAVAILABLE/);
  choice.resolve('private'); await assert.rejects(pending, /INVALID_SENDER/); assert.equal(invoked, false);
});
test('worker concurrency is global and destruction drains the active worker', async () => {
  const started = deferred<void>(); const finish = deferred<void>(); let wasAborted = false;
  const service = new FixedPackCoordinator(async (_file, signal) => { started.resolve(); await finish.promise; wasAborted = signal.aborted; return fixedPackPreview(889); });
  const pending = service.inspect(1, ID, () => true, async () => 'first'); await started.promise;
  await assert.rejects(service.inspect(2, TRACE, () => true, async () => 'second'), /UNAVAILABLE/);
  service.removeSender(1); finish.resolve(); await assert.rejects(pending, /INVALID_SENDER/); assert.equal(wasAborted, true);
});
