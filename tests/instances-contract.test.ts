import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleInstances } from '../src/ipc/instances.js';
import { instanceFailure, InstanceContractError, isInstanceData, isInstanceError, isInstancePayload, isInstanceRequest, isInstanceResult,
  isInstanceSummary, isTaskChangedEvent, isTaskSnapshot } from '../src/shared/contracts/instances.js';
import type { InstanceChannel, InstanceCode, InstanceDispatcher, InstancePayloads, TaskSnapshot } from '../src/shared/contracts/instances.js';

const id = '00000000-0000-4000-8000-000000000001';
const trace = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const snapshot: TaskSnapshot = { taskId: id, kind: 'install', state: 'running', stage: 'downloading', revision: 2, bytesDone: 3, bytesTotal: 8 };
const summary = { instanceId: id, displayName: '测试实例', mcVersionId: '1.20.1', isolation: 'on', state: 'ready', revision: 1 };
const request = (payload: unknown): unknown => ({ contractVersion: 1, requestId: id, payload });
const payloads: InstancePayloads = {
  'instances:list': { rootId: id, limit: 100, cursor: 'opaque' },
  'instances:create': { rootId: id, mcVersionId: '1.20.1', displayName: '我的游戏', isolation: 'inherit' },
  'tasks:list': { limit: 10, state: 'needsRecovery' }, 'tasks:get': { taskId: id },
  'tasks:control': { taskId: id, action: 'cancel' }, 'tasks:subscribe': { taskId: id, afterSeq: 0 },
  'events:unsubscribe': { subscriptionId: id },
};
function dispatcher(value: unknown): InstanceDispatcher {
  // Deliberately untrusted adapter output exercises the handler's runtime boundary.
  return (async () => value) as InstanceDispatcher;
}

test('instance/task requests enforce each exact candidate payload and v1 envelope', () => {
  for (const channel of Object.keys(payloads) as InstanceChannel[]) {
    const payload = payloads[channel]; assert.ok(isInstancePayload(payload, channel)); assert.ok(isInstanceRequest(request(payload), channel));
    for (const invalid of [null, [], { ...payload, file: 'C:/private' }, { ...payload, ownerId: id }]) assert.equal(isInstancePayload(invalid, channel), false);
    assert.equal(isInstanceRequest({ contractVersion: 2, requestId: id, payload }, channel), false);
    assert.equal(isInstanceRequest({ contractVersion: 1, requestId: '../secret', payload }, channel), false);
    assert.equal(isInstanceRequest({ contractVersion: 1, requestId: id, payload, path: 'secret' }, channel), false);
  }
});

test('pagination, names, MC identities, UUIDs and actions remain bounded', () => {
  for (const invalid of [0, 101, 1.5, Infinity]) assert.equal(isInstancePayload({ limit: invalid }, 'tasks:list'), false);
  for (const cursor of ['', 'a'.repeat(513), 'private\npath', undefined]) assert.equal(isInstancePayload({ limit: 1, cursor }, 'tasks:list'), false);
  for (const state of ['unknown', 'ready', null]) assert.equal(isInstancePayload({ limit: 1, state }, 'tasks:list'), false);
  for (const displayName of ['', ' ', ' game', 'a'.repeat(81), 'a\nsecret']) assert.equal(isInstancePayload({ ...payloads['instances:create'], displayName }, 'instances:create'), false);
  for (const mcVersionId of ['../secret', 'C:\\secret', '.', '..', '/tmp/file', 'https://host']) assert.equal(isInstancePayload({ ...payloads['instances:create'], mcVersionId }, 'instances:create'), false);
  assert.ok(isInstancePayload({ ...payloads['instances:create'], mcVersionId: '1.14.3 - Combat Test' }, 'instances:create'));
  assert.ok(isInstancePayload({ taskId: id, action: 'pause' }, 'tasks:control'));
  assert.ok(isInstancePayload({ taskId: id, action: 'resume' }, 'tasks:control'));
  assert.equal(isInstancePayload({ taskId: id, action: 'retry' }, 'tasks:control'), false);
  assert.equal(isInstancePayload({ taskId: id, afterSeq: -1 }, 'tasks:subscribe'), false);
  assert.equal(isInstancePayload({ subscriptionId: '00000000-0000-0000-0000-000000000000' }, 'events:unsubscribe'), false);
});

test('public instance summaries exclude storage identity and paths', () => {
  assert.ok(isInstanceSummary(summary));
  for (const field of ['rootId', 'taskId', 'ownerId', 'directoryId', 'gameDir', 'path']) assert.equal(isInstanceSummary({ ...summary, [field]: id }), false);
  assert.equal(isInstanceSummary({ ...summary, revision: 0 }), false);
  assert.equal(isInstanceSummary({ ...summary, state: 'running' }), false);
  assert.ok(isInstanceData({ items: [summary], nextCursor: 'next' }, 'instances:list'));
  assert.equal(isInstanceData({ items: [summary, summary] }, 'instances:list'), false);
});

test('task snapshots validate progress, enumerations and exact error mapping', () => {
  assert.ok(isTaskSnapshot(snapshot));
  for (const change of [{ bytesDone: -1 }, { bytesDone: 9 }, { bytesTotal: undefined }, { bytesTotal: Infinity }, { revision: 0 },
    { kind: 'launch' }, { stage: 'executing-script' }, { state: 'ready' }, { ownerId: id }, { execution: {} }, { result: { instanceId: id } }]) {
    assert.equal(isTaskSnapshot({ ...snapshot, ...change }), false);
  }
  const error = instanceFailure(id, 'INSTALL_FAILED', trace); assert.equal(error.ok, false);
  if (!error.ok) {
    assert.ok(isTaskSnapshot({ ...snapshot, state: 'failed', stage: 'failed', error: error.error }));
    assert.equal(isTaskSnapshot({ ...snapshot, error: { ...error.error, details: 'secret' } }), false);
  }
  assert.equal(isInstanceData({ items: Array.from({ length: 101 }, () => snapshot) }, 'tasks:list'), false);
  assert.equal(isInstanceData({ items: [snapshot, snapshot] }, 'tasks:list'), false);
});

test('task results and events reject leaked fields, wrong identities and nonterminal result', () => {
  assert.ok(isInstanceData({ snapshot, seq: 0, subscriptionId: id }, 'tasks:subscribe'));
  assert.ok(isInstanceData({ snapshot: { ...snapshot, state: 'completed', stage: 'completed' }, result: { instanceId: id } }, 'tasks:get'));
  assert.equal(isInstanceData({ snapshot, result: { instanceId: id } }, 'tasks:get'), false);
  assert.equal(isInstanceData({ snapshot, result: { instanceId: id, path: 'private' } }, 'tasks:get'), false);
  assert.equal(isInstanceData({ snapshot, ownerId: id }, 'tasks:get'), false);
  assert.ok(isInstanceData({ removed: false }, 'events:unsubscribe'));
  const event = { contractVersion: 1, subscriptionId: id, seq: 1, taskId: id, revision: 2, kind: 'task:changed', payload: snapshot };
  assert.ok(isTaskChangedEvent(event));
  for (const change of [{ seq: 0 }, { seq: Number.MAX_SAFE_INTEGER + 1 }, { taskId: other }, { revision: 3 }, { path: 'secret' }, { kind: 'session:changed' }]) assert.equal(isTaskChangedEvent({ ...event, ...change }), false);
});

test('every domain error has fixed controlled public data', () => {
  const codes: InstanceCode[] = ['INVALID_ARGUMENT', 'UNSUPPORTED_CONTRACT', 'INVALID_SENDER', 'OUT_OF_SCOPE', 'TIMEOUT', 'UNAVAILABLE',
    'ROOT_UNAVAILABLE', 'VERSION_UNSUPPORTED', 'NAME_CONFLICT', 'DISK_FULL', 'PERMISSION_DENIED', 'TASK_STORE_UNAVAILABLE',
    'TASK_NOT_FOUND', 'TASK_NOT_OWNED', 'INVALID_TASK_STATE', 'CANCEL_TOO_LATE', 'CURSOR_EXPIRED', 'SUBSCRIPTION_NOT_OWNED', 'NEEDS_RECOVERY', 'INSTALL_FAILED'];
  for (const code of codes) {
    const failure = instanceFailure(id, code, trace); assert.ok(isInstanceResult(failure, id, 'tasks:get'));
    if (!failure.ok) {
      assert.ok(isInstanceError(failure.error));
      assert.equal(isInstanceError({ ...failure.error, messageKey: 'rawPrivateException' }), false);
      assert.equal(isInstanceError({ ...failure.error, retryable: !failure.error.retryable }), false);
      assert.equal(isInstanceError({ ...failure.error, stack: 'private' }), false);
    }
  }
});

test('handler checks sender before dispatch and returns correlated safe failures', async () => {
  let calls = 0; const dispatch: InstanceDispatcher = async (...args) => { calls++; return dispatcher({ snapshot })(...args); };
  for (const [input, trusted, code] of [[request({ taskId: id }), false, 'INVALID_SENDER'],
    [{ contractVersion: 2, requestId: id, payload: { taskId: id } }, true, 'UNSUPPORTED_CONTRACT'],
    [request({ taskId: id, file: 'secret' }), true, 'INVALID_ARGUMENT']] as const) {
    const result = await handleInstances('tasks:get', input, trusted, trace, dispatch); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, code);
    assert.ok(isInstanceResult(result, id, 'tasks:get')); assert.ok(!JSON.stringify(result).includes('secret'));
  }
  assert.equal(calls, 0);
});

test('handler validates adapter outputs and task correlation without leaking private results', async () => {
  const good = await handleInstances('tasks:get', request({ taskId: id }), true, trace, dispatcher({ snapshot }));
  assert.ok(good.ok); assert.ok(isInstanceResult(good, id, 'tasks:get'));
  for (const data of [{ snapshot, ownerId: id }, { snapshot: { ...snapshot, taskId: other } }, { snapshot: { ...snapshot, path: 'secret' } }]) {
    const result = await handleInstances('tasks:get', request({ taskId: id }), true, trace, dispatcher(data));
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'UNAVAILABLE');
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  assert.equal(isInstanceResult(good, trace, 'tasks:get'), false);
  assert.equal(isInstanceResult({ ...good, details: 'private' }, id, 'tasks:get'), false);
});

test('handler maps declared adapter failures and redacts arbitrary thrown values', async () => {
  for (const thrown of [new Error('PRIVATE_PATH'), 'PRIVATE_TOKEN', { code: 'TASK_NOT_FOUND', details: 'private' }]) {
    const dispatch: InstanceDispatcher = async () => { throw thrown; };
    const result = await handleInstances('tasks:get', request({ taskId: id }), true, trace, dispatch);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'UNAVAILABLE');
    assert.ok(!JSON.stringify(result).includes('PRIVATE')); assert.ok(!JSON.stringify(result).includes('private'));
  }
  const dispatch: InstanceDispatcher = async () => { throw new InstanceContractError('TASK_NOT_OWNED'); };
  const result = await handleInstances('tasks:get', request({ taskId: id }), true, trace, dispatch);
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'TASK_NOT_OWNED');
});
