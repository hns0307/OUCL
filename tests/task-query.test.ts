import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_TASK_STATES, TaskQuerySession, TaskReadBudget } from '../src/ui/task-query.js';
import type { InstanceBridge, InstanceSummary, TaskSnapshot } from '../src/shared/contracts/instances.js';
import { instanceFailure } from '../src/shared/contracts/instances.js';
const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const task = (n: number, state: TaskSnapshot['state'] = 'running', revision = 1): TaskSnapshot => ({ taskId: id(n), kind: 'mod-check', state, stage: state === 'completed' || state === 'failed' || state === 'needsRecovery' ? state : 'preparing', revision, bytesDone: 0 });
function fixture(tasks: TaskSnapshot[], count = 1) {
  const calls: { state: string | undefined; cursor: string | undefined }[] = [];
  const reads: string[] = [];
  const instances: InstanceSummary[] = Array.from({ length: count }, (_, n) => ({ instanceId: id(10000 + n), displayName: `Test${n}`, mcVersionId: '1.20.1', isolation: 'on', state: 'ready', revision: 1 }));
  const bridge: Pick<InstanceBridge, 'listTasks' | 'listInstances' | 'getTask'> = {
    listTasks: async query => {
      calls.push({ state: query.state, cursor: query.cursor });
      const rows = tasks.filter(row => !query.state || query.state === row.state); const start = Number(query.cursor ?? 0);
      return { contractVersion: 1, requestId: id(99), ok: true, data: { items: rows.slice(start, start + query.limit), ...(start + query.limit < rows.length ? { nextCursor: String(start + query.limit) } : {}) } };
    },
    listInstances: async query => {
      const start = Number(query.cursor ?? 0); return { contractVersion: 1, requestId: id(99), ok: true,
        data: { items: instances.slice(start, start + query.limit), ...(start + query.limit < instances.length ? { nextCursor: String(start + query.limit) } : {}) } };
    },
    getTask: async taskId => { reads.push(taskId); const found = tasks.find(row => row.taskId === taskId);
      return found ? { contractVersion: 1, requestId: id(99), ok: true, data: { snapshot: found } } : instanceFailure<'tasks:get'>(id(99), 'TASK_NOT_FOUND', id(99)); },
  };
  return { bridge, calls, reads };
}

test('U04 all active states beyond 100 completed installs are found with existing state filters', async () => {
  const history = Array.from({ length: 100 }, (_, n) => ({ ...task(n + 1, 'completed'), kind: 'install' as const }));
  const activities = ACTIVE_TASK_STATES.map((state, n) => task(n + 101, state));
  const f = fixture([...history, ...activities, task(999, 'needsRecovery')]);
  const session = new TaskQuerySession(f.bridge, id(800)); const view = await session.load(() => true);
  for (const active of activities) assert.ok(view.tasks.some(row => row.taskId === active.taskId));
  assert.equal(view.tasks.filter(row => row.state === 'needsRecovery').length, 1);
  assert.equal(view.tasksComplete, true); assert.equal(view.historyComplete, true);
  assert.equal(f.calls.length, 2, 'small complete snapshot avoids repeated domain scans');
});
test('instance 101 remains selectable after following its own cursor', async () => {
  const f = fixture([], 101); const view = await new TaskQuerySession(f.bridge, id(800)).load(() => true);
  assert.equal(view.instances.length, 101); assert.equal(view.instancesComplete, true);
});
test('40 calls bound a large two-state query; explicit continuation follows cursors without replaying writes', async () => {
  const rows = Array.from({ length: 6000 }, (_, n) => task(n + 1, n < 3000 ? 'queued' : 'running'));
  const f = fixture(rows); const session = new TaskQuerySession(f.bridge, id(800));
  const first = await session.load(() => true); assert.equal(first.tasksComplete, false); assert.ok(f.calls.length <= 39);
  const count = first.tasks.length; const second = await session.load(() => true); assert.ok(second.tasks.length > count);
  assert.ok(f.calls.some(call => call.cursor !== undefined));
});
test('ten second elapsed budget stops before another query and keeps an incomplete marker', async () => {
  let now = 0, calls = 0; const original = Date.now;
  Date.now = () => now;
  try {
    const f = fixture(Array.from({ length: 301 }, (_, n) => task(n + 1))); const base = f.bridge.listTasks;
    f.bridge.listTasks = async query => { calls++; now += 6000; return base(query); };
    const view = await new TaskQuerySession(f.bridge, id(800)).load(() => true);
    assert.equal(calls, 2); assert.equal(view.tasksComplete, false);
  } finally { Date.now = original; }
});
test('cursor expiry discards its old snapshot, restarts once, and does not spin on repeated expiry', async () => {
  const f = fixture(Array.from({ length: 301 }, (_, n) => task(n + 1, 'completed'))); let calls = 0;
  const base = f.bridge.listTasks;
  f.bridge.listTasks = async query => {
    if (query.state !== 'running') return base(query); calls++;
    if (calls === 1) return { contractVersion: 1, requestId: id(99), ok: true, data: { items: [task(9999)], nextCursor: 'expired' } };
    return instanceFailure<'tasks:list'>(id(99), 'CURSOR_EXPIRED', id(99));
  };
  const session = new TaskQuerySession(f.bridge, id(800)); const view = await session.load(() => true);
  assert.equal(calls, 3); assert.equal(view.tasks.some(row => row.taskId === id(9999)), false); assert.equal(view.tasksComplete, false);
  await session.load(() => true); assert.equal(calls, 3);
});
test('known active task absent from filters is read by original ID and may become terminal', async () => {
  const f = fixture([task(1, 'failed', 2)]); const view = await new TaskQuerySession(f.bridge, id(800), [task(1)]).load(() => true);
  assert.deepEqual(f.reads, [id(1)]); assert.equal(view.tasks.find(row => row.taskId === id(1))?.state, 'failed'); assert.equal(view.tasksComplete, true);
});
test('missing known task keeps last facts and marks the collection incomplete', async () => {
  const f = fixture([]); const view = await new TaskQuerySession(f.bridge, id(800), [task(1)]).load(() => true);
  assert.equal(view.tasks[0]?.state, 'running'); assert.equal(view.tasksComplete, false); assert.deepEqual(f.reads, [id(1)]);
});
test('state migration merges by task identity and retains the highest revision', async () => {
  const f = fixture([task(1, 'running', 3), task(1, 'queued', 2)]); const view = await new TaskQuerySession(f.bridge, id(800)).load(() => true);
  assert.equal(view.tasks.length, 1); assert.equal(view.tasks[0]?.revision, 3);
});
test('same revision contradictions require original task confirmation', async () => {
  const f = fixture([task(1, 'running', 2)]); f.bridge.getTask = async () => ({ contractVersion: 1, requestId: id(99), ok: true, data: { snapshot: task(1, 'queued', 2) } });
  const view = await new TaskQuerySession(f.bridge, id(800), [task(1, 'queued', 2)]).load(() => true);
  assert.equal(view.tasks[0]?.state, 'queued'); assert.equal(view.tasksComplete, true);
});
test('history has an explicit continuation independent of completed active scans', async () => {
  const f = fixture(Array.from({ length: 301 }, (_, n) => task(n + 1, 'completed'))); const session = new TaskQuerySession(f.bridge, id(800));
  const first = await session.load(() => true); assert.equal(first.tasks.length, 200); assert.equal(first.historyComplete, false);
  const second = await session.load(() => true, true); assert.equal(second.tasks.length, 300);
  const third = await session.load(() => true, true); assert.equal(third.tasks.length, 301); assert.equal(third.historyComplete, true);
});
test('invalidated root session stops admitting further queries', async () => {
  const f = fixture([task(1)]); let valid = true;
  const base = f.bridge.listTasks; f.bridge.listTasks = async query => { valid = false; return base(query); };
  await new TaskQuerySession(f.bridge, id(800)).load(() => valid); assert.equal(f.calls.length, 1);
});
async function flush(): Promise<void> { for (let n = 0; n < 20; n++) await Promise.resolve(); }
async function advance(t: TestContext, milliseconds: number): Promise<void> { for (let n = 0; n < milliseconds; n += 500) { t.mock.timers.tick(500); await flush(); } }
test('shared list/detail budget admits at most two concurrent calls and two starts per second', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 }); const budget = new TaskReadBudget();
  const releases: (() => void)[] = []; const starts: number[] = []; let active = 0, peak = 0;
  const jobs = Array.from({ length: 8 }, () => budget.run(async () => {
    starts.push(Date.now()); active++; peak = Math.max(peak, active); await new Promise<void>(resolve => { releases.push(resolve); }); active--; return 1;
  }));
  await flush(); await advance(t, 5000); assert.equal(starts.length, 2); assert.equal(peak, 2);
  for (let round = 0; round < 8; round++) { releases.splice(0).forEach(release => { release(); }); await flush(); await advance(t, 1000); }
  assert.equal((await Promise.all(jobs)).length, 8);
  for (const start of starts) assert.ok(starts.filter(time => time >= start && time < start + 1000).length <= 2);
});
test('queued read from an old root is abandoned before invocation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 }); const budget = new TaskReadBudget(); let valid = true, invoked = false;
  await budget.run(async () => 1);
  const pending = budget.run(async () => { invoked = true; return 2; }, () => valid); valid = false;
  await advance(t, 1000); assert.equal(await pending, undefined); assert.equal(invoked, false);
});




test('long history fallback queries every active state and recovery before a second filtered page', async () => {
  const rows = [...Array.from({ length: 301 }, (_, n) => task(n + 1, 'completed')),
    ...ACTIVE_TASK_STATES.map((state, n) => task(1000 + n, state)), task(2000, 'needsRecovery')];
  const f = fixture(rows); const view = await new TaskQuerySession(f.bridge, id(800)).load(() => true);
  assert.deepEqual(f.calls.filter(call => call.state).slice(0, 9).map(call => call.state), [...ACTIVE_TASK_STATES, 'needsRecovery']);
  for (const state of ACTIVE_TASK_STATES) assert.ok(view.tasks.some(row => row.state === state));
  assert.equal(view.tasksComplete, true); assert.equal(view.historyComplete, false);
});

test('small complete snapshot confirms known active identities without another per-task scan', async () => {
  const f = fixture([task(1, 'running', 2)]); const view = await new TaskQuerySession(f.bridge, id(800), [task(1)]).load(() => true);
  assert.equal(view.tasksComplete, true); assert.equal(view.tasks[0]?.revision, 2); assert.equal(f.reads.length, 0);
});

test('expired history cursor restarts within the same explicit batch and exposes a restart hint', async () => {
  const f = fixture(Array.from({ length: 301 }, (_, n) => task(n + 1, 'completed')));
  const original = f.bridge.listTasks; let expired = false;
  f.bridge.listTasks = async query => {
    if (!query.state && query.cursor === '200' && !expired) { expired = true; return instanceFailure<'tasks:list'>(id(99), 'CURSOR_EXPIRED', id(99)); }
    return original(query);
  };
  const session = new TaskQuerySession(f.bridge, id(800)); await session.load(() => true);
  const restarted = await session.load(() => true, true);
  assert.equal(restarted.error, undefined); assert.equal(restarted.historyRestarted, true);
  assert.equal(restarted.tasks.filter(row => row.state === 'completed').length, 100);
  const continued = await session.load(() => true, true); assert.equal(continued.tasks.filter(row => row.state === 'completed').length, 200);
});
