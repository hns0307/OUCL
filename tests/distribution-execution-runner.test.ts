import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DistributionExecutionRunner } from '../src/services/distribution/runner.js';
import { DistributionTaskSettlementService } from '../src/services/distribution/settlement.js';
import type { DistributionSettlementPorts } from '../src/services/distribution/settlement.js';
import { DistributionTransactionError } from '../src/services/distribution/transaction-record.js';
import { admittedExecutionFixture } from './helpers/distribution-admitted-execution-fixture.js';
import { localJar } from './helpers/distribution-local-domain-fixture.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
function gate() {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
  return { enter, release, entered, settled };
}
async function fixture(update?: DistributionSettlementPorts['updateTask']) {
  const v = await admittedExecutionFixture();
  try {
    let executions = 0; let settlements = 0; let updates = 0; let loseExecutionReply = false; let throwAfterCancel = false;
    const settlement = new DistributionTaskSettlementService(v.plan.rootId, { admissions: v.f.store.admissions,
      readProjections: root => v.client.readDistributionTaskProjections(root), journals: v.f.store.journals, receipts: v.f.store.receipts,
      updateTask: (...args) => { updates++; return update ? update(...args) : v.client.update(...args); } });
    const runners = new Set<DistributionExecutionRunner>();
    const runner = () => {
      const value = new DistributionExecutionRunner(v.plan.rootId, { admissions: v.f.store.admissions,
        readProjections: root => v.client.readDistributionTaskProjections(root),
        coordinator: { executeAdmitted: async (...args) => { executions++; const result = await v.coordinator.executeAdmitted(...args);
          if (loseExecutionReply) throw new Error('SYNTHETIC_J_COMPLETED_RESPONSE_LOSS'); return result; }, cancel: id => {
            const cancellation = v.coordinator.cancel(id);
            if (throwAfterCancel) { void cancellation.catch(() => {}); throw new Error('SYNTHETIC_SYNC_CANCEL_WRAPPER_FAILURE'); }
            return cancellation;
          } },
        settlement: { settle: (...args) => { settlements++; return settlement.settle(...args); } } }); runners.add(value); return value;
    };
    return { v, runner, loseExecutionReply: () => { loseExecutionReply = true; }, throwAfterCancellation: () => { throwAfterCancel = true; }, counts: () => ({ executions, settlements, updates }), close: async () => {
      await Promise.all([...runners].map(value => value.close())); await settlement.close(); await v.close();
    } };
  } catch (error) { await v.close(); throw error; }
}
async function noFiles(f: Awaited<ReturnType<typeof fixture>>) {
  assert.equal(await f.v.f.store.journals.read(f.v.plan.txId), undefined); assert.equal(await f.v.f.store.receipts.read(f.v.plan.instanceId), undefined);
  await assert.rejects(readFile(path.join(f.v.f.gameDir, 'mods', 'managed.jar')), { code: 'ENOENT' });
  assert.equal(f.v.counts().adapters, 0);
}

test('real runner directly completes J→K, wrong task does not poison identity, historical new receipt never re-enters J', WINDOWS, async () => {
  const f = await fixture(); const runner = f.runner();
  try {
    await assert.rejects(runner.run(f.v.plan.txId, randomUUID()), { code: 'NEEDS_RECOVERY' });
    f.loseExecutionReply();
    const done = await runner.run(f.v.plan.txId, f.v.accepted.taskId); assert.equal(done.execution.state, 'completed');
    assert.equal(f.counts().executions, 1); assert.equal(f.v.counts().claims, 1); assert.equal(f.counts().updates, 1);
    assert.deepEqual(await readFile(path.join(f.v.f.gameDir, 'mods', 'managed.jar')), f.v.artifact.bytes);
    const artifact = await f.v.f.artifact(localJar('runner_later'), 'runner_later'); const next = f.v.f.plan([f.v.f.add(artifact, 'later.jar')]);
    await f.v.f.accept(next); await (await f.v.f.transaction()).commit(next);
    assert.equal((await f.v.f.store.receipts.read(f.v.plan.instanceId))?.revision, 2);
    assert.deepEqual(await f.runner().run(f.v.plan.txId, f.v.accepted.taskId), done);
    assert.equal(f.counts().executions, 1); assert.equal(f.counts().updates, 1);
  } finally { await f.close(); }
});

test('K actual CAS remains inside the root slot: different job stays out, cancel too late, close drains same-ID callers', WINDOWS, async () => {
  const held = gate(); const owner: { client?: Awaited<ReturnType<typeof admittedExecutionFixture>>['client'] } = {};
  const f = await fixture(async (...args) => { assert.ok(owner.client); const value = await owner.client.update(...args); held.enter(); await held.settled; return value; }); owner.client = f.v.client;
  const runner = f.runner();
  try {
    const one = runner.run(f.v.plan.txId, f.v.accepted.taskId); await held.entered;
    const same = runner.run(f.v.plan.txId, f.v.accepted.taskId);
    await assert.rejects(runner.run(randomUUID(), randomUUID()), { code: 'INSTANCE_BUSY' });
    await assert.rejects(runner.cancel(f.v.plan.txId), { code: 'CANCEL_TOO_LATE' });
    assert.equal(f.counts().executions, 1); assert.equal((await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId))?.execution.state, 'completed');
    let closed = false; const closing = runner.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
    held.release(); const a = await one; const b = await same; await closing;
    assert.deepEqual(a, b); assert.notEqual(a, b); assert.equal(f.counts().updates, 1);
    // Runner close owns no shared service lifetime: coordinator metadata remains usable.
    assert.equal((await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId))?.execution.state, 'completed');
  } finally { held.release(); await f.close(); }
});

test('real post-publication cancellation rolls native bytes back, settles failed, and preserves original typed cancellation', WINDOWS, async () => {
  const f = await fixture(); const runner = f.runner(); const held = gate(); const original = f.v.f.ports.readContext; let blocked = false;
  f.v.f.ports.readContext = async (...args) => {
    const journal = await f.v.f.store.journals.read(f.v.plan.txId);
    if (!blocked && journal?.data.phase === 'applying' && journal.data.pending === null && journal.data.files.every(file => file.stage === 'published')) {
      blocked = true; held.enter(); await held.settled;
    }
    return original(...args);
  };
  try {
    const work = runner.run(f.v.plan.txId, f.v.accepted.taskId);
    const rejected = assert.rejects(work, error => error instanceof DistributionTransactionError && error.code === 'CANCELLED');
    await held.entered; assert.deepEqual(await readFile(path.join(f.v.f.gameDir, 'mods', 'managed.jar')), f.v.artifact.bytes);
    await runner.cancel(f.v.plan.txId); held.release(); await rejected;
    assert.equal((await f.v.f.store.journals.read(f.v.plan.txId))?.data.phase, 'rolledBack');
    assert.equal((await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId))?.execution.state, 'failed');
    assert.equal(await f.v.f.store.receipts.read(f.v.plan.instanceId), undefined);
    await assert.rejects(readFile(path.join(f.v.f.gameDir, 'mods', 'managed.jar')), { code: 'ENOENT' });
  } finally { held.release(); f.v.f.ports.readContext = original; await f.close(); }
});

test('unknown actual claim acknowledgement stays running without files; later runner is K-only and never retries J', WINDOWS, async () => {
  const f = await fixture();
  try {
    f.v.loseClaimAck(); await assert.rejects(f.runner().run(f.v.plan.txId, f.v.accepted.taskId), { code: 'NEEDS_RECOVERY' });
    assert.equal((await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId))?.execution.state, 'running'); await noFiles(f);
    await assert.rejects(f.runner().run(f.v.plan.txId, f.v.accepted.taskId), { code: 'NEEDS_RECOVERY' });
    assert.equal(f.counts().executions, 1); assert.equal(f.v.counts().claims, 1); assert.equal(f.counts().updates, 0); await noFiles(f);
  } finally { await f.close(); }
});

test('preclaim busy target preserves the original typed error and leaves the task queued', WINDOWS, async () => {
  const f = await fixture();
  try {
    f.v.setIdle(false);
    await assert.rejects(f.runner().run(f.v.plan.txId, f.v.accepted.taskId), error => error instanceof DistributionTransactionError && error.code === 'INSTANCE_BUSY');
    assert.equal((await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId))?.execution.state, 'queued');
    assert.equal(f.v.counts().claims, 0); assert.equal(f.counts().updates, 0); await noFiles(f);
  } finally { await f.close(); }
});

test('close during held J validation drains actual cancellation and keeps shared stores open', WINDOWS, async () => {
  const f = await fixture(); const runner = f.runner(); const held = f.v.f.blockContext();
  try {
    const work = runner.run(f.v.plan.txId, f.v.accepted.taskId); const rejected = assert.rejects(work, { code: 'CANCELLED' }); await held.entered;
    f.throwAfterCancellation();
    let closed = false; const closing = runner.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
    held.release(); await rejected; await closing;
    assert.equal((await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId))?.execution.state, 'queued');
    assert.equal(f.v.counts().claims, 0); await noFiles(f);
  } finally { held.release(); await f.close(); }
});
