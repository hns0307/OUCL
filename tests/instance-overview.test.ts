import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InstanceOverviewReader, overviewIsolation, overviewSession, overviewTaskRows } from '../src/ui/instance-overview.js';
import type { OverviewTasks } from '../src/ui/instance-overview.js';
import type { TargetBridge, TargetResult, TargetRow } from '../src/shared/contracts/task-targets.js';
import type { SessionSnapshot } from '../src/shared/contracts/game.js';
const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const row = (n: number, revision = 1): TargetRow => ({ instanceId: id(n), instanceRevision: 1,
  task: { taskId: id(n + 100), kind: 'mod-install', state: 'running', stage: 'preparing', bytesDone: 0, revision } });
const result = (rows: TargetRow[]): TargetResult => ({ contractVersion: 1, requestId: id(900), ok: true, data: { items: rows } });
function deferred() {
  let resolve!: (value: TargetResult) => void;
  const promise = new Promise<TargetResult>(done => { resolve = done; });
  return { promise, resolve };
}

test('changing instance ignores a late old reply and does not control any task', async () => {
  const old = deferred(), next = deferred(); const seen: OverviewTasks[] = [];
  const bridge: TargetBridge = { listInstanceTaskTargets: query => query.instanceId === id(1) ? old.promise : next.promise };
  const a = new InstanceOverviewReader(id(1), bridge, value => { seen.push(value); });
  const first = a.refresh(); a.close();
  const b = new InstanceOverviewReader(id(2), bridge, value => { seen.push(value); }); const second = b.refresh();
  next.resolve(result([row(2)])); await second; old.resolve(result([row(1)])); await first;
  assert.deepEqual(seen.at(-1)?.rows.map(value => value.instanceId), [id(2)]);
  assert.equal(seen.filter(value => value.connection === 'confirmed').length, 1);
});

test('refresh responses cannot regress to an older request', async () => {
  const old = deferred(), next = deferred(); let call = 0; const seen: OverviewTasks[] = [];
  const reader = new InstanceOverviewReader(id(1), { listInstanceTaskTargets: () => ++call === 1 ? old.promise : next.promise }, value => { seen.push(value); });
  const first = reader.refresh(), second = reader.refresh();
  next.resolve(result([row(1, 4)])); await second; old.resolve(result([row(1, 1)])); await first;
  assert.equal(seen.at(-1)?.rows[0]?.task.revision, 4);
});

test('query failures change observation status without fabricating failed execution', async () => {
  const seen: OverviewTasks[] = [];
  await new InstanceOverviewReader(id(1), { listInstanceTaskTargets: async () => { throw new Error('network'); } }, value => { seen.push(value); }).refresh();
  assert.equal(seen.at(-1)?.connection, 'unavailable'); assert.deepEqual(seen.at(-1)?.rows, []);
  assert.equal(seen.at(-1)?.partial, true);
});

test('target queries remain bounded and indicate additional pages rather than claiming completeness', async () => {
  let query: unknown; const seen: OverviewTasks[] = [];
  await new InstanceOverviewReader(id(1), { listInstanceTaskTargets: async input => {
    query = input; return { contractVersion: 1, requestId: id(900), ok: true, data: { items: [row(1)], nextCursor: id(500) } };
  } }, value => { seen.push(value); }).refresh();
  assert.deepEqual(query, { instanceId: id(1), kinds: ['mod-check', 'mod-install'], limit: 20 });
  assert.equal(seen.at(-1)?.partial, true);
});

test('an injected reply for another instance is not admitted', async () => {
  const seen: OverviewTasks[] = [];
  await new InstanceOverviewReader(id(1), { listInstanceTaskTargets: async () => result([row(2)]) }, value => { seen.push(value); }).refresh();
  assert.equal(seen.at(-1)?.connection, 'unavailable'); assert.deepEqual(seen.at(-1)?.rows, []);
});

test('global snapshots only advance proven identities and never add unrelated tasks', () => {
  const original = row(1); const newer = { ...original.task, revision: 3, state: 'completed' as const, stage: 'completed' as const };
  const values = overviewTaskRows([original], [newer, row(2).task]);
  assert.equal(values.length, 1); assert.equal(values[0]?.task.state, 'completed');
  assert.equal(overviewTaskRows(values, [original.task])[0]?.task.revision, 3);
  assert.equal(original.task.revision, 1);
});

test('current session selection excludes other instances and prioritizes real ongoing facts', () => {
  const session = (n: number, instanceId: string, state: SessionSnapshot['state'], startedAt: string): SessionSnapshot => ({ sessionId: id(n), instanceId, state, startedAt, revision: 1 });
  const rows = [session(1, id(5), 'running', '2026-11-15T10:00:00Z'), session(2, id(6), 'running', '2026-11-15T12:00:00Z'), session(3, id(5), 'exited', '2026-11-15T11:00:00Z')];
  assert.equal(overviewSession(id(5), rows)?.sessionId, id(1)); assert.equal(overviewSession(id(8), rows), undefined);
});

test('inherited isolation stays explicitly unresolved', () => {
  const instance = { instanceId: id(1), displayName: 'A', mcVersionId: '1.20.1', isolation: 'inherit' as const, state: 'ready' as const, revision: 1 };
  assert.equal(overviewIsolation(instance), 'overviewIsolationInherit');
  assert.equal(overviewIsolation({ ...instance, isolation: 'off' }), 'uiShared');
});
