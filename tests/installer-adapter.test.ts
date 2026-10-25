import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InstallerAdapter } from '../src/ipc/installer-adapter.js';
import { InstallerError } from '../src/services/install/installer.js';
import type { InstallerService } from '../src/services/install/installer.js';
import { WorkerError } from '../src/services/workers/protocol.js';
import { isInstanceData, isTaskChangedEvent } from '../src/shared/contracts/instances.js';
import type { TaskChangedEvent } from '../src/shared/contracts/instances.js';
import type { InstanceSummary } from '../src/services/storage/instance-records.js';
import { createExecution } from '../src/core/task/machine.js';

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const root = id(1); const request = id(2);
type Service = Pick<InstallerService, 'create' | 'list' | 'task' | 'cancel'>;
type View = Awaited<ReturnType<Service['task']>>;
function fixture(count = 1): { service: Service; views: Map<string, View>; summaries: InstanceSummary[]; calls: { creates: number; cancels: number; task: number }; adapter: InstallerAdapter } {
  const views = new Map<string, View>(); const summaries: InstanceSummary[] = [];
  for (let i = 0; i < count; i++) {
    const taskId = id(10 + i); const summary: InstanceSummary = { instanceId: id(100 + i), rootId: root, taskId, displayName: `原版 ${i}`, mcVersionId: '1.20.1', isolation: 'on', state: 'installing', revision: 1 };
    summaries.push(summary); views.set(taskId, { task: { taskId, ownerId: root, kind: 'install', execution: { ...createExecution(), state: 'running', revision: 2 } }, stage: 'running', instance: summary });
  }
  const calls = { creates: 0, cancels: 0, task: 0 };
  const service: Service = {
    async create(requestId, input) { assert.equal(requestId, request); assert.equal(input.rootId, root); calls.creates++; return { taskId: id(10) }; },
    async list(rootId) { assert.equal(rootId, root); return [...summaries]; },
    async task(rootId, taskId) { assert.equal(rootId, root); calls.task++; const view = views.get(taskId); if (!view) throw new InstallerError('INSTANCE_NOT_FOUND'); return view; },
    async cancel(rootId, taskId) { assert.equal(rootId, root); calls.cancels++; const view = views.get(taskId)!; view.task.execution = { ...view.task.execution, state: 'cancelling', revision: view.task.execution.revision + 1 }; },
  };
  const adapter = new InstallerAdapter(service, { async readInstallation() { return { schemaVersion: 1, revision: 1, data: { rootId: root, dataDirectory: 'D:\\private-root' } }; } });
  return { service, views, summaries, calls, adapter };
}
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) { if (Date.now() > deadline) throw new Error('TEST_EVENT_TIMEOUT'); await new Promise<void>(resolve => setTimeout(resolve, 10)); }
}

test('installer adapter enforces registered root scope and exposes only public summary/task fields', async () => {
  const f = fixture(); const dispatch = f.adapter.dispatcher(1, () => {});
  try {
    await assert.rejects(dispatch('instances:list', { rootId: id(9), limit: 10 }, request), { code: 'OUT_OF_SCOPE' });
    await assert.rejects(dispatch('instances:create', { rootId: id(9), mcVersionId: '1.20.1', displayName: 'test', isolation: 'on' }, request), { code: 'OUT_OF_SCOPE' });
    assert.equal(f.calls.creates, 0);
    const list = await dispatch('instances:list', { rootId: root, limit: 10 }, request); assert.ok(isInstanceData(list, 'instances:list'));
    assert.deepEqual(Object.keys(list.items[0]!).sort(), ['displayName', 'instanceId', 'isolation', 'mcVersionId', 'revision', 'state']);
    const task = await dispatch('tasks:get', { taskId: id(10) }, request); assert.ok(isInstanceData(task, 'tasks:get')); assert.equal(task.snapshot.stage, 'downloading');
    const upper = await dispatch('tasks:get', { taskId: id(10).toUpperCase() }, request); assert.equal(upper.snapshot.taskId, id(10).toUpperCase());
    assert.equal(JSON.stringify({ list, task }).includes('private-root'), false); assert.equal(JSON.stringify(task).includes('ownerId'), false);
    assert.deepEqual(await dispatch('instances:create', { rootId: root, mcVersionId: '1.20.1', displayName: 'test', isolation: 'inherit' }, request), { taskId: id(10) });
  } finally { f.adapter.close(); }
});

test('installer adapter pagination tokens are opaque, bounded to sender/channel/filter, and hold stable snapshots', async () => {
  const f = fixture(3); const dispatch = f.adapter.dispatcher(1, () => {}); const other = f.adapter.dispatcher(2, () => {});
  try {
    const first = await dispatch('instances:list', { rootId: root, limit: 1 }, request); assert.ok(first.nextCursor); assert.equal(first.items[0]?.instanceId, id(100));
    await assert.rejects(other('instances:list', { rootId: root, limit: 1, cursor: first.nextCursor }, request), { code: 'OUT_OF_SCOPE' });
    await assert.rejects(dispatch('tasks:list', { limit: 1, cursor: first.nextCursor }, request), { code: 'CURSOR_EXPIRED' });
    await assert.rejects(dispatch('instances:list', { rootId: root, limit: 1, cursor: 'fake-offset-1' }, request), { code: 'CURSOR_EXPIRED' });
    f.summaries.reverse(); const second = await dispatch('instances:list', { rootId: root, limit: 1, cursor: first.nextCursor }, request);
    assert.equal(second.items[0]?.instanceId, id(101)); assert.ok(second.nextCursor);
    const third = await dispatch('instances:list', { rootId: root, limit: 1, cursor: second.nextCursor }, request); assert.equal(third.items[0]?.instanceId, id(102)); assert.equal(third.nextCursor, undefined);
    const tasks = await dispatch('tasks:list', { limit: 1, state: 'running' }, request); assert.ok(tasks.nextCursor);
    await assert.rejects(dispatch('tasks:list', { limit: 1, state: 'completed', cursor: tasks.nextCursor }, request), { code: 'CURSOR_EXPIRED' });
  } finally { f.adapter.close(); }
});

test('installer task lists enforce owner/kind and completed results contain only the corresponding instance ID', async () => {
  const f = fixture(2); const dispatch = f.adapter.dispatcher(1, () => {});
  try {
    const view = f.views.get(id(10))!; view.task.execution = { ...view.task.execution, state: 'completed', revision: 3 }; view.stage = 'unrecognized-private-stage';
    const result = await dispatch('tasks:get', { taskId: id(10) }, request); assert.equal(result.snapshot.stage, 'completed'); assert.deepEqual(result.result, { instanceId: id(100) });
    const filtered = await dispatch('tasks:list', { limit: 10, state: 'completed' }, request); assert.equal(filtered.items.length, 1);
    view.task.ownerId = id(99); await assert.rejects(dispatch('tasks:get', { taskId: id(10) }, request), { code: 'TASK_NOT_OWNED' });
    view.task.ownerId = root; view.task.kind = 'launch'; await assert.rejects(dispatch('tasks:get', { taskId: id(10) }, request), { code: 'TASK_NOT_FOUND' });
    await assert.rejects(dispatch('tasks:get', { taskId: id(999) }, request), { code: 'TASK_NOT_FOUND' });
  } finally { f.adapter.close(); }
});

test('installer controls call only durable cancel and return actual persisted state', async () => {
  const f = fixture(); const dispatch = f.adapter.dispatcher(1, () => {});
  try {
    await assert.rejects(dispatch('tasks:control', { taskId: id(10), action: 'pause' }, request), { code: 'INVALID_TASK_STATE' });
    await assert.rejects(dispatch('tasks:control', { taskId: id(10), action: 'resume' }, request), { code: 'INVALID_TASK_STATE' });
    assert.equal(f.calls.cancels, 0);
    assert.deepEqual(await dispatch('tasks:control', { taskId: id(10), action: 'cancel' }, request), { taskId: id(10), accepted: true, state: 'cancelling' });
    assert.equal(f.calls.cancels, 1);
  } finally { f.adapter.close(); }
});

test('installer adapter maps known failures and rejects raw exception text at its boundary', async () => {
  const f = fixture(); const dispatch = f.adapter.dispatcher(1, () => {});
  try {
    f.service.create = async () => { throw new InstallerError('NAME_CONFLICT'); };
    await assert.rejects(dispatch('instances:create', { rootId: root, mcVersionId: '1.20.1', displayName: 'name', isolation: 'on' }, request), { code: 'NAME_CONFLICT' });
    f.service.task = async () => { throw new WorkerError('NEEDS_RECOVERY'); };
    await assert.rejects(dispatch('tasks:get', { taskId: id(10) }, request), { code: 'NEEDS_RECOVERY' });
    f.service.task = async () => { throw new Error('private-path/token'); };
    await assert.rejects(dispatch('tasks:get', { taskId: id(10) }, request), error => { assert.ok(error instanceof Error); assert.equal(error.message, 'UNAVAILABLE'); return true; });
    const missing = new InstallerAdapter(f.service, { async readInstallation() { return undefined; } });
    try { await assert.rejects(missing.dispatcher(1, () => {})('tasks:list', { limit: 10 }, request), { code: 'ROOT_UNAVAILABLE' }); }
    finally { missing.close(); }
  } finally { f.adapter.close(); }
});

test('installer subscriptions provide atomic seq-zero snapshots and strictly ordered bounded full updates', async () => {
  const f = fixture(); const events: TaskChangedEvent[] = []; const dispatch = f.adapter.dispatcher(1, event => events.push(event));
  try {
    await assert.rejects(dispatch('tasks:subscribe', { taskId: id(10), afterSeq: 1 }, request), { code: 'CURSOR_EXPIRED' });
    const subscribed = await dispatch('tasks:subscribe', { taskId: id(10), afterSeq: 0 }, request); assert.equal(subscribed.seq, 0); assert.equal(subscribed.snapshot.revision, 2); assert.equal(events.length, 0);
    const view = f.views.get(id(10))!; view.task.execution = { ...view.task.execution, revision: 7, bytesDone: 5, bytesTotal: 10 }; view.stage = 'downloading';
    await until(() => events.length === 1); assert.equal(events[0]?.seq, 1); assert.equal(events[0]?.payload.bytesDone, 5); assert.ok(isTaskChangedEvent(events[0]));
    await new Promise<void>(resolve => setTimeout(resolve, 140)); assert.equal(events.length, 1);
    view.stage = 'materializing'; await until(() => events.length === 2); assert.equal(events[1]?.seq, 2); assert.equal(events[1]?.revision, 7);
    view.task.execution = { ...view.task.execution, state: 'failed', revision: 8 }; view.stage = 'failed';
    await until(() => events.length === 3); assert.equal(events[2]?.payload.error?.code, 'INSTALL_FAILED'); assert.ok(isTaskChangedEvent(events[2]));
  } finally { f.adapter.close(); }
});

test('installer subscription ownership, repeated unsubscribe and sender removal never cancel installation', async () => {
  const f = fixture(); const dispatch = f.adapter.dispatcher(1, () => {}); const other = f.adapter.dispatcher(2, () => {});
  try {
    const sub = await dispatch('tasks:subscribe', { taskId: id(10) }, request);
    await assert.rejects(other('events:unsubscribe', { subscriptionId: sub.subscriptionId.toUpperCase() }, request), { code: 'SUBSCRIPTION_NOT_OWNED' });
    assert.deepEqual(await dispatch('events:unsubscribe', { subscriptionId: sub.subscriptionId }, request), { removed: true });
    assert.deepEqual(await dispatch('events:unsubscribe', { subscriptionId: sub.subscriptionId }, request), { removed: false });
    await assert.rejects(other('events:unsubscribe', { subscriptionId: sub.subscriptionId }, request), { code: 'SUBSCRIPTION_NOT_OWNED' });
    await dispatch('tasks:subscribe', { taskId: id(10) }, request); f.adapter.removeSender(1);
    await assert.rejects(dispatch('tasks:get', { taskId: id(10) }, request), { code: 'INVALID_SENDER' }); assert.equal(f.calls.cancels, 0);
  } finally { f.adapter.close(); }
});

test('installer send callback failure removes only its subscription even if it throws a recognized service error', async () => {
  const f = fixture(); let sends = 0;
  const dispatch = f.adapter.dispatcher(1, () => { sends++; throw new InstallerError('INSTALL_FAILED'); });
  try {
    const sub = await dispatch('tasks:subscribe', { taskId: id(10) }, request); f.views.get(id(10))!.task.execution.revision++;
    await until(() => sends === 1); assert.deepEqual(await dispatch('events:unsubscribe', { subscriptionId: sub.subscriptionId }, request), { removed: false }); assert.equal(f.calls.cancels, 0);
  } finally { f.adapter.close(); }
});

test('installer poll iterations never overlap and close suppresses an already pending response', async () => {
  const f = fixture(); const events: TaskChangedEvent[] = []; const dispatch = f.adapter.dispatcher(1, event => events.push(event));
  const original = f.service.task; let release: (() => void) | undefined; let inFlight = 0; let maximum = 0;
  try {
    await dispatch('tasks:subscribe', { taskId: id(10) }, request);
    f.service.task = async (...args) => {
      inFlight++; maximum = Math.max(maximum, inFlight); await new Promise<void>(resolve => { release = resolve; }); inFlight--; return original(...args);
    };
    await until(() => inFlight === 1); await new Promise<void>(resolve => setTimeout(resolve, 220)); assert.equal(maximum, 1);
    f.views.get(id(10))!.task.execution.revision++; f.adapter.close(); release!(); await new Promise<void>(resolve => setTimeout(resolve, 140)); assert.equal(events.length, 0); assert.equal(inFlight, 0);
    await assert.rejects(dispatch('tasks:get', { taskId: id(10) }, request), { code: 'UNAVAILABLE' });
  } finally { release?.(); f.adapter.close(); }
});

test('installer admission counts pending subscriptions and enforces per-sender and global budgets', async () => {
  const f = fixture(); const dispatch = f.adapter.dispatcher(1, () => {});
  try {
    for (let sender = 1; sender <= 4; sender++) {
      const own = sender === 1 ? dispatch : f.adapter.dispatcher(sender, () => {});
      await Promise.all(Array.from({ length: 64 }, () => own('tasks:subscribe', { taskId: id(10) }, request)));
      await assert.rejects(own('tasks:subscribe', { taskId: id(10) }, request), { code: 'UNAVAILABLE' });
    }
    await assert.rejects(f.adapter.dispatcher(5, () => {})('tasks:subscribe', { taskId: id(10) }, request), { code: 'UNAVAILABLE' });
    f.adapter.removeSender(1); assert.ok(await f.adapter.dispatcher(5, () => {})('tasks:subscribe', { taskId: id(10) }, request)); assert.equal(f.calls.cancels, 0);
  } finally { f.adapter.close(); }
});

test('installer pending subscription is discarded if its window disappears during snapshot acquisition', async () => {
  const f = fixture(); let release: (() => void) | undefined; const original = f.service.task;
  f.service.task = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
  const dispatch = f.adapter.dispatcher(1, () => {});
  try {
    const pending = dispatch('tasks:subscribe', { taskId: id(10) }, request); const rejected = assert.rejects(pending, { code: 'INVALID_SENDER' });
    await until(() => release !== undefined); f.adapter.removeSender(1); release!(); await rejected; assert.equal(f.calls.cancels, 0);
  } finally { release?.(); f.adapter.close(); }
});
