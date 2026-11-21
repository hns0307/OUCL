import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { DistributionExecutionAdapter } from '../src/ipc/distribution-execution.js';
import { DistributionExecutionOwners } from '../src/ipc/distribution-execution-owners.js';
import type { DistributionExecutionResult } from '../src/shared/contracts/distribution-execution.js';

const channel = 'distribution:cancelExecutionPreparation';
const input = () => ({ contractVersion: 1 as const, requestId: randomUUID(), payload: { prepareRequestId: randomUUID() } });
function code(result: DistributionExecutionResult): string { assert.equal(result.ok, false); return result.ok ? '' : result.error.code; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

test('owners reject untrusted/invalid/closed senders before creating any backend generation', async () => {
  let created = 0; const owners = new DistributionExecutionOwners(() => { created++; return new DistributionExecutionAdapter(); });
  for (const sender of [0, -1, 1.5]) assert.equal(code(await owners.handle(sender, channel, input(), () => true, randomUUID())), 'INVALID_SENDER');
  assert.equal(code(await owners.handle(1, channel, input(), () => false, randomUUID())), 'INVALID_SENDER');
  assert.equal(created, 0);
  assert.equal(code(await owners.handle(1, channel, input(), () => true, randomUUID())), 'SOURCE_UNAVAILABLE');
  assert.equal(created, 1); await owners.close();
  assert.equal(code(await owners.handle(2, channel, input(), () => true, randomUUID())), 'INVALID_SENDER'); assert.equal(created, 1);
});

test('retired generation cannot admit late replies and shutdown waits for retired plus live settlement', async () => {
  const gates = [deferred(), deferred()]; let created = 0; const closed: number[] = []; const signals: AbortSignal[] = [];
  const owners = new DistributionExecutionOwners(() => {
    const index = created++;
    return new DistributionExecutionAdapter({ available: () => true,
      dispatch: async (_channel, request, signal) => { signals[index] = signal; await gates[index]!.promise; return { contractVersion: 1, requestId: request.requestId, ok: true, data: { cancelled: true } }; },
      revoke: () => {}, close: async () => { closed.push(index); } });
  });
  let trusted = true;
  const old = owners.handle(1, channel, input(), () => trusted, randomUUID()); await setImmediate();
  trusted = false; owners.revoke(1); trusted = true;
  const current = owners.handle(1, channel, input(), () => trusted, randomUUID()); await setImmediate();
  assert.equal(created, 2); assert.equal(signals[0]?.aborted, true);
  let settled = false; const closing = owners.close(); assert.equal(closing, owners.close()); void closing.then(() => { settled = true; });
  await setImmediate(); assert.equal(signals[1]?.aborted, true); assert.equal(settled, false); assert.deepEqual(closed, []);
  gates[1]!.resolve(); assert.equal(code(await current), 'INVALID_SENDER'); await setImmediate(); assert.equal(settled, false);
  gates[0]!.resolve(); assert.equal(code(await old), 'INVALID_SENDER'); await closing;
  assert.deepEqual(closed.sort(), [0, 1]);
});

test('retired close errors are remembered after settlement without retaining every finished promise', async () => {
  let closes = 0;
  const owners = new DistributionExecutionOwners(() => new DistributionExecutionAdapter({ available: () => true,
    dispatch: async (_channel, request) => ({ contractVersion: 1, requestId: request.requestId, ok: true, data: { cancelled: true } }),
    revoke: () => {}, close: async () => { closes++; throw new Error('private metadata path'); } }));
  for (let i = 0; i < 3; i++) {
    assert.equal((await owners.handle(1, channel, input(), () => true, randomUUID())).ok, true);
    owners.revoke(1); await setImmediate();
  }
  assert.equal(closes, 3);
  const closing = owners.close(); await assert.rejects(closing, { message: 'UNAVAILABLE' }); assert.equal(closing, owners.close());
});

test('factory failures stay redacted and repeated completed revocations close each generation once', async () => {
  const failed = new DistributionExecutionOwners(() => { throw new Error('C:/private'); });
  assert.equal(code(await failed.handle(1, channel, input(), () => true, randomUUID())), 'UNAVAILABLE'); await failed.close();
  let closes = 0; const owners = new DistributionExecutionOwners(() => new DistributionExecutionAdapter({ available: () => true,
    dispatch: async (_channel, request) => ({ contractVersion: 1, requestId: request.requestId, ok: true, data: { cancelled: true } }),
    revoke: () => {}, close: async () => { closes++; } }));
  for (let i = 0; i < 20; i++) {
    await owners.handle(1, channel, input(), () => true, randomUUID()); owners.revoke(1); owners.revoke(1); await setImmediate();
  }
  await owners.close(); assert.equal(closes, 20);
});
