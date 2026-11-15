import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRequestTaskCancellation } from '../src/ui/task-controls.js';
import type { TaskSnapshot } from '../src/shared/contracts/instances.js';

const snapshot: TaskSnapshot = { taskId: '00000000-0000-4000-8000-000000000001', kind: 'install', state: 'running', stage: 'downloading', revision: 1, bytesDone: 0 };
test('cancellation is absent after the commit boundary and during failure cleanup', () => {
  for (const state of ['committing', 'cancelling', 'cancelled', 'completed', 'failing', 'failed', 'needsRecovery'] as const) {
    assert.equal(canRequestTaskCancellation({ ...snapshot, state }, 'confirmed'), false, state);
  }
  for (const state of ['queued', 'running', 'verifying', 'pausing', 'paused'] as const) {
    assert.equal(canRequestTaskCancellation({ ...snapshot, state }, 'confirmed'), true, state);
  }
});
test('an unavailable observation never turns old execution state into permission to cancel', () => {
  for (const connection of ['unconfirmed', 'connecting', 'rechecking', 'unavailable'] as const) {
    assert.equal(canRequestTaskCancellation(snapshot, connection), false, connection);
  }
});
