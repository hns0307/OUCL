import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { TaskObserverPool } from '../src/ui/task-observer.js';
import type { TaskObservation } from '../src/ui/task-observer.js';
import { instanceFailure } from '../src/shared/contracts/instances.js';
import type { InstanceBridge, InstanceCode, InstanceResult, TaskSnapshot } from '../src/shared/contracts/instances.js';

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const initial = (n = 1): TaskSnapshot => ({ taskId: id(n), kind: 'install', state: 'running', stage: 'downloading', revision: 1, bytesDone: 0 });
async function flush(): Promise<void> { for (let n = 0; n < 12; n++) await Promise.resolve(); }
async function advance(t: TestContext, milliseconds: number): Promise<void> {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 500) { t.mock.timers.tick(Math.min(500, milliseconds - elapsed)); await flush(); }
}
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const state: { snapshot: TaskSnapshot; error: InstanceCode | undefined; subscribeError: boolean; rejectSubscription: boolean;
    read: Promise<InstanceResult<'tasks:get'>> | undefined; subscriptions: number; reads: number; disposals: number;
    event: ((snapshot: TaskSnapshot) => void) | undefined; calls: number[] } = {
    snapshot: initial(), error: undefined, subscribeError: false, rejectSubscription: false, read: undefined,
    subscriptions: 0, reads: 0, disposals: 0, event: undefined, calls: [],
  };
  const bridge: Pick<InstanceBridge, 'getTask' | 'subscribeTask'> = {
    getTask: async taskId => {
      state.reads++; state.calls.push(Date.now());
      if (state.read) return state.read;
      return state.error ? instanceFailure<'tasks:get'>(id(99), state.error, id(99))
        : { contractVersion: 1, requestId: id(99), ok: true, data: { snapshot: { ...state.snapshot, taskId } } };
    },
    subscribeTask: async (taskId, listener) => {
      state.subscriptions++; state.calls.push(Date.now());
      if (state.rejectSubscription) throw new Error('unexpected bridge rejection');
      let disposed = false;
      const dispose = (): void => { if (!disposed) { disposed = true; state.disposals++; } };
      if (state.subscribeError) return { result: instanceFailure<'tasks:subscribe'>(id(99), 'UNAVAILABLE', id(99)), dispose };
      state.event = listener; const snapshot = { ...state.snapshot, taskId }; listener(snapshot);
      return { result: { contractVersion: 1, requestId: id(99), ok: true,
        data: { subscriptionId: id(100 + state.subscriptions), snapshot, seq: 0 } }, dispose };
    },
  };
  const pool = new TaskObserverPool(bridge); t.after(() => { pool.close(); });
  const updates: TaskObservation[] = [];
  const handle = pool.observe(state.snapshot, value => { updates.push(value); });
  return { pool, state, updates, handle, latest: (): TaskObservation => updates.at(-1)! };
}

test('silent but healthy subscription is confirmed by a bounded original-task read', async t => {
  const f = fixture(t); await advance(t, 500);
  assert.equal(f.latest().connection, 'confirmed'); assert.equal(f.state.subscriptions, 1);
  await advance(t, 14500); assert.equal(f.state.reads, 0);
  await advance(t, 500); assert.equal(f.state.reads, 1); assert.equal(f.latest().lastConfirmedAt, 115500);
  assert.equal(f.latest().snapshot.state, 'running');
});
test('U07 missing backend task stops observation without changing the last business state', async t => {
  const f = fixture(t); await advance(t, 500); f.state.error = 'TASK_NOT_FOUND';
  await advance(t, 15000);
  assert.equal(f.latest().connection, 'unavailable'); assert.equal(f.latest().code, 'TASK_NOT_FOUND');
  assert.equal(f.latest().snapshot.state, 'running'); assert.equal(f.state.disposals, 1);
  const count = f.state.reads; await advance(t, 60000); assert.equal(f.state.reads, count);
});
for (const rejecting of [false, true]) test(`subscription ${rejecting ? 'reject' : 'error result'} uses bounded read fallback`, async t => {
  const f = fixture(t); f.state.subscribeError = !rejecting; f.state.rejectSubscription = rejecting;
  await advance(t, 500); assert.equal(f.latest().connection, 'unconfirmed');
  await advance(t, 2000); assert.equal(f.latest().connection, 'confirmed'); assert.equal(f.latest().code, undefined);
  assert.equal(f.state.reads, 1); assert.equal(f.state.subscriptions, 1);
});
test('four consecutive failures stop automatic polling; explicit reconnect reads the original task', async t => {
  const f = fixture(t); f.state.subscribeError = true; f.state.error = 'UNAVAILABLE';
  await advance(t, 23000); assert.equal(f.latest().connection, 'unavailable'); assert.equal(f.state.reads, 3);
  await advance(t, 60000); assert.equal(f.state.reads, 3);
  f.state.subscribeError = false; f.state.error = undefined; f.handle.reconnect(); await advance(t, 500);
  assert.equal(f.latest().connection, 'confirmed'); assert.equal(f.state.subscriptions, 2);
});
test('recovery of observation clears only connection errors and preserves a terminal business error', async t => {
  const f = fixture(t); f.handle.dispose();
  const failure = instanceFailure(id(99), 'INSTALL_FAILED', id(99)); assert.equal(failure.ok, false);
  f.state.snapshot = { ...initial(), state: 'failed', stage: 'failed', error: failure.error };
  f.state.error = 'TASK_STORE_UNAVAILABLE';
  const updates: TaskObservation[] = []; f.pool.observe(f.state.snapshot, value => { updates.push(value); });
  await advance(t, 500); assert.equal(updates.at(-1)?.code, 'TASK_STORE_UNAVAILABLE');
  f.state.error = undefined; await advance(t, 2000);
  assert.equal(updates.at(-1)?.connection, 'confirmed'); assert.equal(updates.at(-1)?.code, undefined);
  assert.deepEqual(updates.at(-1)?.snapshot.error, failure.error);
  const reads = f.state.reads; await advance(t, 60000); assert.equal(f.state.reads, reads);
});
test('late health read never overwrites newer subscription revision', async t => {
  const f = fixture(t); await advance(t, 500);
  let release!: (result: InstanceResult<'tasks:get'>) => void;
  f.state.read = new Promise(resolve => { release = resolve; }); await advance(t, 15000);
  f.state.event?.({ ...initial(), revision: 3, bytesDone: 20 });
  release({ contractVersion: 1, requestId: id(99), ok: true, data: { snapshot: { ...initial(), revision: 2 } } }); await flush();
  assert.equal(f.latest().snapshot.revision, 3); assert.equal(f.latest().snapshot.bytesDone, 20);
});
test('multiple cards share one observer; last disposal blocks late reads and removes the subscription', async t => {
  const f = fixture(t); const updates: TaskObservation[] = []; const second = f.pool.observe(initial(), value => { updates.push(value); });
  await advance(t, 500); assert.equal(f.state.subscriptions, 1); f.handle.dispose(); assert.equal(f.state.disposals, 0);
  let release!: (result: InstanceResult<'tasks:get'>) => void;
  f.state.read = new Promise(resolve => { release = resolve; }); await advance(t, 15000); second.dispose();
  const count = updates.length; release({ contractVersion: 1, requestId: id(99), ok: true, data: { snapshot: { ...initial(), revision: 2 } } }); await flush();
  assert.equal(updates.length, count); assert.equal(f.state.disposals, 1);
});
test('100 cards admit at most eight details with no more than two starts per second', async t => {
  const f = fixture(t); for (let n = 2; n <= 100; n++) f.pool.observe(initial(n), () => {});
  await advance(t, 10000); assert.equal(f.state.subscriptions, 8);
  for (const start of f.state.calls) assert.ok(f.state.calls.filter(time => time >= start && time < start + 1000).length <= 2);
});
test('hidden page admits no work; old-root closure blocks late subscription and disposes it', async t => {
  const f = fixture(t); f.pool.setVisible(false); await advance(t, 20000); assert.equal(f.state.subscriptions, 0);
  f.pool.setVisible(true); await advance(t, 500); assert.equal(f.state.subscriptions, 1);
  f.pool.setVisible(false); assert.equal(f.state.disposals, 1); await advance(t, 20000); assert.equal(f.state.reads, 0);
  f.pool.setVisible(true); await advance(t, 500); assert.equal(f.state.subscriptions, 2);
  const count = f.updates.length; f.pool.close(); f.state.event?.({ ...initial(), revision: 3 }); assert.equal(f.updates.length, count);
});
test('closing during subscribe disposes its late receipt without callback delivery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let disposed = 0, deliveries = 0;
  const pool = new TaskObserverPool({ getTask: async () => { throw new Error('unexpected get'); }, subscribeTask: async (_id, listener) => {
    await gate; listener(initial()); return { dispose: () => { disposed++; }, result: { contractVersion: 1, requestId: id(99), ok: true,
      data: { subscriptionId: id(100), snapshot: initial(), seq: 0 } } };
  } });
  pool.observe(initial(), () => { deliveries++; }); await advance(t, 500); pool.close(); const count = deliveries;
  release(); await flush(); assert.equal(disposed, 1); assert.equal(deliveries, count);
});

test('explicit query promotes a waiting detail and releases the evicted observer', async t => {
  const f = fixture(t);
  for (let n = 2; n <= 8; n++) f.pool.observe(initial(n), () => {});
  const updates: TaskObservation[] = []; const waiting = f.pool.observe(initial(9), value => { updates.push(value); });
  await advance(t, 5000); assert.equal(f.state.subscriptions, 8); assert.equal(updates.at(-1)?.connection, 'unconfirmed');
  waiting.reconnect(); await advance(t, 500);
  assert.equal(updates.at(-1)?.connection, 'confirmed'); assert.equal(f.state.subscriptions, 9); assert.equal(f.state.disposals, 1);
});
test('slow subscriptions never exceed two concurrent bridge calls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let active = 0, peak = 0; const releases: (() => void)[] = [];
  const pool = new TaskObserverPool({ getTask: async () => { throw new Error('unexpected read'); }, subscribeTask: async taskId => {
    active++; peak = Math.max(peak, active); await new Promise<void>(resolve => { releases.push(resolve); }); active--;
    return { dispose: () => {}, result: { contractVersion: 1, requestId: id(99), ok: true,
      data: { subscriptionId: id(100), snapshot: { ...initial(), taskId }, seq: 0 } } };
  } });
  for (let n = 1; n <= 100; n++) pool.observe(initial(n), () => {});
  await advance(t, 20000); assert.equal(peak, 2); assert.equal(releases.length, 2);
  pool.close(); releases.forEach(release => { release(); }); await flush(); assert.equal(active, 0);
});
test('wrong task in a health response is never delivered as this task', async t => {
  const f = fixture(t); await advance(t, 500);
  f.state.read = Promise.resolve({ contractVersion: 1, requestId: id(99), ok: true, data: { snapshot: initial(999) } });
  await advance(t, 15000); assert.equal(f.latest().connection, 'unconfirmed');
  assert.equal(f.latest().snapshot.taskId, initial().taskId); assert.equal(f.latest().code, 'UNAVAILABLE');
});

test('confirmed terminal task stays confirmed across hiding and can still be explicitly queried', async t => {
  const f = fixture(t); f.handle.dispose(); f.state.snapshot = { ...initial(), state: 'completed', stage: 'completed' };
  const updates: TaskObservation[] = []; const handle = f.pool.observe(f.state.snapshot, value => { updates.push(value); });
  await advance(t, 500); assert.equal(f.state.reads, 1); assert.equal(updates.at(-1)?.connection, 'confirmed');
  f.pool.setVisible(false); await advance(t, 1000); f.pool.setVisible(true); await advance(t, 1000);
  assert.equal(updates.at(-1)?.connection, 'confirmed'); assert.equal(f.state.reads, 1);
  handle.reconnect(); await advance(t, 500); assert.equal(f.state.reads, 2); assert.equal(updates.at(-1)?.connection, 'confirmed');
});

test('explicit terminal query is not starved by eight active details', async t => {
  const f = fixture(t); for (let n = 2; n <= 8; n++) f.pool.observe(initial(n), () => {});
  const updates: TaskObservation[] = []; const final = { ...initial(9), state: 'completed', stage: 'completed' } as const;
  const handle = f.pool.observe(final, value => { updates.push(value); }); await advance(t, 5000);
  assert.equal(f.state.reads, 0); f.state.snapshot = final; handle.reconnect(); await advance(t, 500);
  assert.equal(f.state.reads, 1); assert.equal(updates.at(-1)?.connection, 'confirmed');
});
