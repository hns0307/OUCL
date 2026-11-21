import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { instanceFailure } from '../src/shared/contracts/instances.js';
import { isTargetRequest, isTargetResult, targetFilter } from '../src/shared/contracts/task-targets.js';
import type { TargetRequest } from '../src/shared/contracts/task-targets.js';

test('target contract requires exact bounded inputs and normalizes filter identity', () => {
  const request: TargetRequest = { contractVersion: 1, requestId: randomUUID(), payload: { instanceId: randomUUID(), kinds: ['mod-check', 'mod-install'], limit: 100 } };
  assert.equal(isTargetRequest(request), true);
  for (const patch of [{ path: 'x' }, { limit: 0 }, { limit: 101 }, { kinds: [] }, { kinds: ['mod-check', 'mod-check'] }, { cursor: 'bad' }])
    assert.equal(isTargetRequest({ ...request, payload: { ...request.payload, ...patch } }), false);
  assert.equal(targetFilter(request.payload), targetFilter({ ...request.payload, instanceId: request.payload.instanceId.toUpperCase(), kinds: ['mod-install', 'mod-check'] }));
});

test('target response validates request correlation, ownership, uniqueness and fixed errors', () => {
  const request: TargetRequest = { contractVersion: 1, requestId: randomUUID(), payload: { instanceId: randomUUID(), kinds: ['mod-check'], limit: 1 } };
  const row = { instanceId: request.payload.instanceId, instanceRevision: 1,
    task: { taskId: randomUUID(), kind: 'mod-check', state: 'running', stage: 'preparing', revision: 2, bytesDone: 0 } };
  const valid = { contractVersion: 1, requestId: request.requestId, ok: true, data: { items: [row] } };
  assert.equal(isTargetResult(valid, request), true);
  assert.equal(isTargetResult({ ...valid, requestId: randomUUID() }, request), false);
  assert.equal(isTargetResult({ ...valid, data: { items: [{ ...row, instanceId: randomUUID() }] } }, request), false);
  assert.equal(isTargetResult({ ...valid, data: { items: [row, row] } }, request), false);
  assert.equal(isTargetResult({ ...valid, data: { items: [], nextCursor: randomUUID() } }, request), false);
  assert.equal(isTargetResult(instanceFailure(request.requestId, 'NEEDS_RECOVERY', randomUUID()), request), true);
  assert.equal(isTargetResult(instanceFailure(request.requestId, 'TASK_NOT_FOUND', randomUUID()), request), false);
});
