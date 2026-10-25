import test from 'node:test';
import assert from 'node:assert/strict';
import { isGamePayload, isGameData, isGameResult, isSessionSnapshot, gameFailure } from '../src/shared/contracts/game.js';
import type { GameDispatcher } from '../src/shared/contracts/game.js';
import { handleGame } from '../src/ipc/game.js';
import { isInstanceData, isTaskSnapshot } from '../src/shared/contracts/instances.js';
import { parseGameSessions } from '../src/services/storage/game-sessions.js';

const id = '00000000-0000-4000-8000-000000000001';
const session = { sessionId: id, instanceId: id, state: 'running', revision: 2, startedAt: '2026-10-25T00:00:00.000Z' };
test('game/session payloads and public outputs exclude executable, path, credentials and PID capabilities', () => {
  const launch = { instanceId: id, accountId: id, expectedRevision: 1 };
  assert.ok(isGamePayload(launch, 'game:launch')); assert.ok(isGamePayload({ sessionId: id, mode: 'force', confirmed: true }, 'game:stop'));
  for (const key of ['executable', 'args', 'cwd', 'token', 'rootId']) assert.equal(isGamePayload({ ...launch, [key]: 'private' }, 'game:launch'), false);
  assert.equal(isGamePayload({ ...launch, expectedRevision: 0 }, 'game:launch'), false);
  assert.equal(isGamePayload({ sessionId: id, mode: 'force' }, 'game:stop'), false);
  assert.equal(isGamePayload({ sessionId: id, mode: 'kill-tree', confirmed: true }, 'game:stop'), false);
  for (const limit of [0, 101, 1.5]) assert.equal(isGamePayload({ limit }, 'sessions:list'), false);
  assert.equal(isGamePayload({ limit: 1, cursor: undefined }, 'sessions:list'), false);
  assert.ok(isSessionSnapshot(session));
  for (const change of [{ pid: 123 }, { path: 'private' }, { revision: 0 }, { state: 'preparing' }, { exitCode: 0 }, { startedAt: 'invalid' }]) assert.equal(isSessionSnapshot({ ...session, ...change }), false);
  assert.ok(isGameData({ ...session, state: 'exited', exitCode: 0 }, 'sessions:get'));
  assert.equal(isGameData({ items: [session, session] }, 'sessions:list'), false);
});
test('game handler never starts effects for an invalid request id/sender/envelope and validates output', async () => {
  let effects = 0; const dispatch: GameDispatcher = (async () => { effects++; return { taskId: id }; }) as GameDispatcher;
  const valid = { contractVersion: 1, requestId: id, payload: { instanceId: id, accountId: id, expectedRevision: 1 } };
  for (const value of [{ ...valid, requestId: 'invalid' }, { ...valid, payload: { ...valid.payload, path: 'x' } }, { ...valid, extra: 'x' }]) {
    const result = await handleGame('game:launch', value, true, id, dispatch); assert.ok(!result.ok); assert.equal(result.error.code, 'INVALID_ARGUMENT');
  }
  assert.equal((await handleGame('game:launch', valid, false, id, dispatch)).ok, false); assert.equal(effects, 0);
  assert.ok((await handleGame('game:launch', valid, true, id, dispatch)).ok); assert.equal(effects, 1);
  const leak = (async () => ({ taskId: id, pid: 123 })) as unknown as GameDispatcher;
  assert.equal((await handleGame('game:launch', valid, true, id, leak)).ok, false);
  assert.ok(isGameResult(gameFailure(id, 'INSTANCE_BUSY', id), id, 'game:launch'));
});
test('launch/stop task results are discriminated from install results and require completed state', () => {
  const snapshot = { taskId: id, kind: 'launch', state: 'running', stage: 'preparing', revision: 2, bytesDone: 0 };
  assert.ok(isTaskSnapshot(snapshot)); assert.equal(isTaskSnapshot({ ...snapshot, stage: 'downloading' }), false);
  assert.equal(isInstanceData({ snapshot, result: { sessionId: id } }, 'tasks:get'), false);
  const completed = { ...snapshot, state: 'completed', stage: 'completed' };
  assert.ok(isInstanceData({ snapshot: completed, result: { sessionId: id } }, 'tasks:get'));
  assert.equal(isInstanceData({ snapshot: completed, result: { instanceId: id } }, 'tasks:get'), false);
  assert.equal(isInstanceData({ snapshot: { ...completed, kind: 'stop' }, result: { sessionId: id } }, 'tasks:get'), false);
  assert.ok(isInstanceData({ snapshot: { ...completed, kind: 'stop' }, result: { sessionId: id, stopped: true, exitCode: 0 } }, 'tasks:get'));
});
test('private session records enforce task/session ownership associations and reject ambiguous process facts', () => {
  const record = { rootId: id, taskId: id, snapshot: session, spawned: true, stopTaskIds: [] };
  assert.equal(parseGameSessions({ items: [record] }).items.length, 1);
  for (const invalid of [{ ...record, pid: 1 }, { ...record, snapshot: { ...session, sessionId: '00000000-0000-4000-8000-000000000002' } },
    { ...record, spawned: false }, { ...record, stopTaskIds: [id] }, { ...record, errors: [{ taskId: id, code: 'raw-private-error' }] },
    { ...record, errors: [{ taskId: '00000000-0000-4000-8000-000000000002', code: 'LAUNCH_FAILED' }] }]) assert.throws(() => parseGameSessions({ items: [invalid] }));
});
