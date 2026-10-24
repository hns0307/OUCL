import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyArtifact } from '../src/core/download/integrity.js';
import type { ExpectedArtifact, ObservedArtifact } from '../src/core/download/integrity.js';
import { applyWorkerEvent, controlTask, createExecution } from '../src/core/task/machine.js';
import type { Execution, WorkerEvent } from '../src/core/task/machine.js';
import { changeConsumer, scheduleTasks, transferDemand } from '../src/core/task/scheduling.js';
import type { Consumer, ScheduledTask } from '../src/core/task/scheduling.js';

const expected: ExpectedArtifact = { algorithm: 'sha1', digest: 'a'.repeat(40), size: 20, provenanceId: 'mojang:descriptor-1' };
const observed: ObservedArtifact = { sha1: 'a'.repeat(40), sha256: 'b'.repeat(64), size: 20 };
const start = (): Execution => controlTask(createExecution(), 'start').execution;
function send(execution: Execution, kind: Exclude<WorkerEvent['kind'], 'progress'>): Execution {
  return applyWorkerEvent(execution, { kind, attempt: execution.attempt, sequence: execution.lastSequence + 1 }).execution;
}

test('integrity requires trusted expected digest and size, never just size or local SHA256', () => {
  assert.deepEqual(verifyArtifact(expected, observed), { ok: true, objectDigest: observed.sha256, provenanceId: expected.provenanceId });
  assert.deepEqual(verifyArtifact({ ...expected, digest: expected.digest.toUpperCase() }, observed), verifyArtifact(expected, observed));
  assert.deepEqual(verifyArtifact({ ...expected, algorithm: 'sha256', digest: 'B'.repeat(64) }, observed), verifyArtifact(expected, observed));
  assert.deepEqual(verifyArtifact(expected, { ...observed, sha1: 'c'.repeat(40) }), { ok: false, code: 'HASH_MISMATCH' });
  assert.deepEqual(verifyArtifact(expected, { ...observed, size: 19 }), { ok: false, code: 'SIZE_MISMATCH' });
  for (const change of [{ size: -1 }, { size: Infinity }, { digest: 'x'.repeat(40) }, { provenanceId: '' }, { provenanceId: '../path' }]) {
    assert.deepEqual(verifyArtifact({ ...expected, ...change }, observed), { ok: false, code: 'INVALID_INTEGRITY_FACTS' });
  }
  for (const change of [{ size: -1 }, { size: 0.5 }, { sha1: '' }, { sha256: 'x'.repeat(64) }]) {
    assert.deepEqual(verifyArtifact(expected, { ...observed, ...change }), { ok: false, code: 'INVALID_INTEGRITY_FACTS' });
  }
});

test('execution verifies before commit and never repeats terminal effects', () => {
  const initial = createExecution();
  assert.equal(initial.state, 'queued');
  const running = controlTask(initial, 'start');
  assert.deepEqual(running.effects, ['start']);
  assert.equal(running.execution.attempt, 1);
  const verifying = applyWorkerEvent(running.execution, { kind: 'transferred', attempt: 1, sequence: 1 });
  assert.equal(verifying.execution.state, 'verifying');
  assert.deepEqual(verifying.effects, ['verify']);
  const committing = applyWorkerEvent(verifying.execution, { kind: 'verified', attempt: 1, sequence: 2 });
  assert.deepEqual(committing.effects, ['commit']);
  assert.equal(controlTask(committing.execution, 'cancel').rejected, 'CANCEL_TOO_LATE');
  const completed = send(committing.execution, 'committed');
  assert.equal(completed.state, 'completed');
  assert.equal(controlTask(completed, 'cancel').rejected, 'CANCEL_TOO_LATE');
  for (const kind of ['transferred', 'verified', 'committed', 'cleaned', 'failed'] as const) {
    assert.equal(send(completed, kind), completed);
  }
});

test('progress is monotonic, bounded and ignores duplicate or out-of-order messages', () => {
  const running = start();
  const progress = applyWorkerEvent(running, { kind: 'progress', attempt: 1, sequence: 1, bytesDone: 5 }).execution;
  assert.equal(progress.bytesTotal, undefined);
  const known = applyWorkerEvent(progress, { kind: 'progress', attempt: 1, sequence: 2, bytesDone: 10, bytesTotal: 20 }).execution;
  assert.equal(known.bytesTotal, 20);
  const next = applyWorkerEvent(known, { kind: 'progress', attempt: 1, sequence: 3, bytesDone: 15 }).execution;
  assert.equal(next.bytesTotal, 20);
  for (const extra of [{ bytesDone: 9 }, { bytesDone: NaN }, { bytesDone: -1 }, { bytesDone: 21 },
    { bytesDone: 16, bytesTotal: 30 }, { bytesDone: 16, bytesTotal: Infinity }, { bytesDone: 16, bytesTotal: -1 }]) {
    assert.equal(applyWorkerEvent(next, { kind: 'progress', attempt: 1, sequence: 4, ...extra }).execution, next);
  }
  for (const sequence of [0, 2, 3, NaN, Infinity, 1.5]) {
    assert.equal(applyWorkerEvent(next, { kind: 'progress', attempt: 1, sequence, bytesDone: 20 }).execution, next);
  }
});

test('cancel waits for cleanup and defeats late transfer/verification/completion', () => {
  for (const before of [createExecution(), start(), send(start(), 'transferred'), controlTask(start(), 'pause').execution,
    controlTask(createExecution(), 'pause').execution]) {
    const cancelling = controlTask(before, 'cancel');
    assert.equal(cancelling.execution.state, 'cancelling');
    assert.deepEqual(cancelling.effects, ['cleanup']);
    for (const kind of ['transferred', 'verified', 'committed', 'paused'] as const) assert.equal(send(cancelling.execution, kind), cancelling.execution);
    assert.equal(controlTask(cancelling.execution, 'cancel').execution, cancelling.execution);
    const cancelled = send(cancelling.execution, 'cleaned');
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(controlTask(cancelled, 'cancel').execution, cancelled);
  }
});

test('pause/resume fences old attempts and resets per-attempt progress', () => {
  const pausing = controlTask(start(), 'pause');
  assert.equal(pausing.execution.state, 'pausing');
  assert.deepEqual(pausing.effects, ['pause']);
  assert.equal(controlTask(pausing.execution, 'pause').execution, pausing.execution);
  assert.equal(send(pausing.execution, 'transferred'), pausing.execution);
  const paused = send(pausing.execution, 'paused');
  assert.equal(controlTask(paused, 'pause').execution, paused);
  const resumed = controlTask(controlTask(paused, 'resume').execution, 'start').execution;
  assert.equal(resumed.attempt, 2);
  assert.equal(resumed.bytesDone, 0);
  assert.equal(applyWorkerEvent(resumed, { kind: 'committed', attempt: 1, sequence: 999 }).execution, resumed);
  assert.equal(controlTask(send(start(), 'transferred'), 'pause').rejected, 'INVALID_TASK_STATE');
  assert.equal(controlTask(start(), 'retry').rejected, 'INVALID_TASK_STATE');
});

test('failures require cleanup before retry; uncertain writes require recovery', () => {
  for (const execution of [start(), send(start(), 'transferred'), controlTask(start(), 'pause').execution]) {
    const failing = send(execution, 'failed');
    assert.equal(failing.state, 'failing');
    assert.equal(controlTask(failing, 'retry').rejected, 'INVALID_TASK_STATE');
    const failed = send(failing, 'cleaned');
    assert.equal(failed.state, 'failed');
    assert.equal(controlTask(failed, 'retry').execution.state, 'queued');
    assert.equal(controlTask(failed, 'cancel').execution.state, 'cancelling');
  }
  const committing = send(send(start(), 'transferred'), 'verified');
  for (const execution of [committing, controlTask(start(), 'cancel').execution, send(start(), 'failed')]) {
    const unknown = applyWorkerEvent(execution, { kind: 'failed', attempt: execution.attempt, sequence: execution.lastSequence + 1 });
    assert.equal(unknown.execution.state, 'needsRecovery');
    assert.deepEqual(unknown.effects, ['recover']);
    assert.equal(controlTask(unknown.execution, 'cancel').rejected, 'INVALID_TASK_STATE');
  }
  for (const state of ['running', 'verifying', 'committing', 'pausing', 'cancelling', 'failing'] as const) {
    assert.equal(controlTask({ ...start(), state }, 'interrupted').execution.state, 'needsRecovery');
  }
  const queued = createExecution();
  assert.equal(controlTask(queued, 'interrupted').execution, queued);
});

test('shared transfers obey demand from all installers independently', () => {
  let consumers: Consumer[] = [];
  consumers = changeConsumer(consumers, { kind: 'attach', id: 'A' });
  consumers = changeConsumer(consumers, { kind: 'attach', id: 'B' });
  assert.equal(changeConsumer(consumers, { kind: 'attach', id: 'A' }).length, 2);
  consumers = changeConsumer(consumers, { kind: 'pause', id: 'A' });
  assert.equal(transferDemand(consumers), 'run');
  consumers = changeConsumer(consumers, { kind: 'pause', id: 'B' });
  assert.equal(transferDemand(consumers), 'pause');
  consumers = changeConsumer(consumers, { kind: 'resume', id: 'A' });
  assert.equal(transferDemand(consumers), 'run');
  consumers = changeConsumer(consumers, { kind: 'detach', id: 'A' });
  assert.equal(transferDemand(consumers), 'pause');
  consumers = changeConsumer(consumers, { kind: 'resume', id: 'B' });
  assert.equal(transferDemand(consumers), 'run');
  consumers = changeConsumer(consumers, { kind: 'detach', id: 'B' });
  assert.equal(transferDemand(consumers), 'cancel');
  assert.throws(() => changeConsumer([], { kind: 'pause', id: 'missing' }), /CONSUMER_NOT_FOUND/);
  assert.throws(() => changeConsumer([], { kind: 'attach', id: '../x' }), /INVALID_CONSUMER/);
  assert.throws(() => changeConsumer(Array.from({ length: 1024 }, (_, i) => ({ id: String(i), state: 'active' })), { kind: 'attach', id: 'new' }), /CONSUMER_LIMIT/);
});

test('scheduler enforces shared concurrency budget and waits for all dependencies', () => {
  const tasks: ScheduledTask[] = [
    { id: 'base', state: 'completed', dependencies: [] },
    { id: 'active', state: 'active', dependencies: [] },
    { id: 'A', state: 'queued', dependencies: ['base'] },
    { id: 'B', state: 'queued', dependencies: [] },
    { id: 'missing', state: 'queued', dependencies: ['unknown'] },
    { id: 'cycle', state: 'queued', dependencies: ['cycle'] },
    { id: 'wait', state: 'queued', dependencies: ['active'] },
    { id: 'failed', state: 'failed', dependencies: [] },
    { id: 'blocked', state: 'queued', dependencies: ['failed'] }
  ];
  assert.deepEqual(scheduleTasks(tasks, 2), ['A']);
  assert.deepEqual(scheduleTasks(tasks, 3), ['A', 'B']);
  assert.deepEqual(scheduleTasks(tasks, 1), []);
  assert.deepEqual(scheduleTasks([...tasks, { id: 'other', state: 'active', dependencies: [] }], 1), []);
  assert.throws(() => scheduleTasks([...tasks, tasks[0]!], 2), /DUPLICATE_TASK/);
  for (const limit of [0, 33, NaN, 0.5]) assert.throws(() => scheduleTasks([], limit), /INVALID_SCHEDULE/);
  assert.throws(() => scheduleTasks(Array.from({ length: 10001 }, (_, i) => ({ id: String(i), state: 'queued', dependencies: [] })), 2), /INVALID_SCHEDULE/);
});
