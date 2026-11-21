import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { useLauncher } from '../src/ui/launcher-state.js';
import type { LauncherBridge } from '../src/shared/contracts/handshake.js';
import type { TaskSnapshot } from '../src/shared/contracts/instances.js';
import { instanceFailure } from '../src/shared/contracts/instances.js';
const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const task = (n: number, revision = 1): TaskSnapshot => ({ taskId: id(n), kind: 'download', state: 'running', stage: 'downloading', revision, bytesDone: 0 });
let fixtureNumber = 0;
async function flush(): Promise<void> { for (let n = 0; n < 30; n++) await Promise.resolve(); }
async function complete(t: TestContext, pending: Promise<void>): Promise<void> {
  let done = false; void pending.then(() => { done = true; }, () => { done = true; });
  for (let n = 0; n < 100 && !done; n++) { t.mock.timers.tick(500); await flush(); }
  assert.equal(done, true, 'bounded renderer read did not settle'); await pending;
}
function fixture(t: TestContext) {
  fixtureNumber++; t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000000000 + fixtureNumber * 1000000 });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'); const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const bridge: Pick<LauncherBridge, 'listTasks' | 'getTask' | 'listInstances' | 'listInstancesV2'> = {
    listTasks: async query => ({ contractVersion: 1, requestId: id(99), ok: true,
      data: { items: !query.state || query.state === 'running' ? [task(useLauncher.getState().rootId === id(1) ? 10 : 20)] : [] } }),
    listInstances: async query => ({ contractVersion: 1, requestId: id(99), ok: true, data: { items: [{ instanceId: query.rootId,
      displayName: query.rootId, mcVersionId: '1.20.1', isolation: 'on', state: 'ready', revision: 1 }] } }),
    listInstancesV2: async () => ({ contractVersion: 2, requestId: id(99), ok: true, data: { items: [] } }),
    getTask: async taskId => ({ contractVersion: 1, requestId: id(99), ok: true, data: { snapshot: { ...task(10, 5), taskId } } }),
  };
  Object.defineProperty(globalThis, 'window', { value: { oucl: bridge }, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: { hidden: false }, configurable: true });
  useLauncher.getState().setRoot(undefined); useLauncher.getState().setRoot(id(1));
  t.after(() => {
    useLauncher.getState().setRoot(undefined);
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
  });
  return bridge;
}

test('renderer store exposes complete active and instance collections without losing selection', async t => {
  fixture(t); await complete(t, useLauncher.getState().refreshGame());
  const state = useLauncher.getState(); assert.equal(state.tasksComplete, true); assert.equal(state.instancesComplete, true);
  assert.equal(state.instanceId, id(1)); assert.equal(state.gameListBusy, false); assert.equal(state.tasks[0]?.taskId, id(10));
});
test('root B can refresh while root A is in flight; late A cannot refill B', async t => {
  const bridge = fixture(t); const original = bridge.listTasks; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); let blocked = false;
  bridge.listTasks = async query => {
    if (useLauncher.getState().rootId === id(1) && !blocked) {
      blocked = true; await gate; return { contractVersion: 1, requestId: id(99), ok: true, data: { items: [task(10)] } };
    }
    return original(query);
  };
  const old = useLauncher.getState().refreshGame(); await flush(); t.mock.timers.tick(500); await flush(); assert.equal(blocked, true);
  useLauncher.getState().setRoot(id(2)); const next = useLauncher.getState().refreshGame(); await complete(t, next);
  release(); await complete(t, old);
  assert.equal(useLauncher.getState().rootId, id(2)); assert.equal(useLauncher.getState().instanceId, id(2));
  assert.equal(useLauncher.getState().tasks.some(value => value.taskId === id(10)), false);
});
test('A to B to A generation does not accept an old same-root response', async t => {
  const bridge = fixture(t); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const original = bridge.listTasks; let first = true;
  bridge.listTasks = async query => {
    if (first) { first = false; await gate; return { contractVersion: 1, requestId: id(99), ok: true, data: { items: [task(999)] } }; }
    return original(query);
  };
  const old = useLauncher.getState().refreshGame(); await flush(); t.mock.timers.tick(500); await flush();
  useLauncher.getState().setRoot(id(2)); useLauncher.getState().setRoot(id(1));
  await complete(t, useLauncher.getState().refreshGame()); release(); await complete(t, old);
  assert.equal(useLauncher.getState().tasks.some(value => value.taskId === id(999)), false);
});
test('original-task query is deduplicated and never treats a failed read as safe business retry', async t => {
  const bridge = fixture(t); let reads = 0;
  bridge.getTask = async () => { reads++; return instanceFailure<'tasks:get'>(id(99), 'TASK_NOT_FOUND', id(99)); };
  const first = useLauncher.getState().queryTask(id(10)); const duplicate = useLauncher.getState().queryTask(id(10));
  await complete(t, Promise.all([first, duplicate]).then(() => {}));
  assert.equal(reads, 1); assert.equal(useLauncher.getState().tasks.length, 0); assert.equal(useLauncher.getState().taskQueryErrors[id(10)], 'unavailable');
});
test('concurrent task confirmation cannot be overwritten by an older list snapshot', async t => {
  fixture(t); const listed = useLauncher.getState().refreshGame(); const queried = useLauncher.getState().queryTask(id(10));
  await complete(t, Promise.all([listed, queried]).then(() => {}));
  assert.equal(useLauncher.getState().tasks.find(value => value.taskId === id(10))?.revision, 5);
});


test('explicit history browsing is retained until a deliberate list refresh', async t => {
  const bridge = fixture(t); const original = bridge.listTasks;
  bridge.listTasks = async query => query.state ? original(query) : ({ contractVersion: 1, requestId: id(99), ok: true, data: {
    items: Array.from({ length: 100 }, (_, n) => ({ ...task(1000 + Number(query.cursor ?? 0) + n), state: 'completed' as const, stage: 'completed' as const })),
    nextCursor: query.cursor ? '200' : '100',
  } });
  await complete(t, useLauncher.getState().refreshGame());
  await complete(t, useLauncher.getState().loadMoreGame(true));
  assert.equal(useLauncher.getState().historyBrowsing, true);
  assert.ok(useLauncher.getState().tasks.some(value => value.taskId === id(1199)));
  await complete(t, useLauncher.getState().refreshGame()); assert.equal(useLauncher.getState().historyBrowsing, false);
});
