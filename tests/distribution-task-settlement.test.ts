import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { DistributionTaskSettlementService } from '../src/services/distribution/settlement.js';
import type { DistributionSettlementPorts } from '../src/services/distribution/settlement.js';
import { DistributionTransactionService } from '../src/services/distribution/transaction.js';
import { loadWindowsDistributionFiles } from '../src/services/distribution/native-files.js';
import { admittedExecutionFixture } from './helpers/distribution-admitted-execution-fixture.js';
import { localJar, ROOT } from './helpers/distribution-local-domain-fixture.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
async function fixture(execute = true) {
  const v = await admittedExecutionFixture();
  try {
    if (execute) await v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId);
    let updates = 0;
    const ports: DistributionSettlementPorts = { admissions: v.f.store.admissions,
      readProjections: root => v.client.readDistributionTaskProjections(root), journals: v.f.store.journals, receipts: v.f.store.receipts,
      updateTask: (...args) => { updates++; return v.client.update(...args); } };
    const services = new Set<DistributionTaskSettlementService>();
    const service = (overrides: Partial<DistributionSettlementPorts> = {}, rootId = v.plan.rootId) => {
      const value = new DistributionTaskSettlementService(rootId, { ...ports, ...overrides }); services.add(value); return value;
    };
    return { v, ports, service, updates: () => updates, close: async () => { await Promise.all([...services].map(value => value.close())); await v.close(); } };
  } catch (error) { await v.close(); throw error; }
}

test('real native committed evidence settles the real running task once; repeat reads unchanged completed state', WINDOWS, async () => {
  const f = await fixture(); const service = f.service();
  try {
    const prior = await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId); assert.equal(prior?.execution.state, 'running');
    const done = await service.settle(f.v.plan.txId, f.v.accepted.taskId);
    assert.equal(done.execution.state, 'completed'); assert.equal(done.execution.attempt, 1); assert.equal(done.execution.revision, prior!.execution.revision + 1);
    assert.equal(f.updates(), 1); assert.deepEqual(await service.settle(f.v.plan.txId, f.v.accepted.taskId), done); assert.equal(f.updates(), 1);
    assert.deepEqual(await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId), done);
  } finally { await f.close(); }
});

test('real task CAS commit with lost acknowledgement reads back the exact expected tuple without writing again', WINDOWS, async () => {
  const f = await fixture(); let calls = 0;
  const service = f.service({ updateTask: async (...args) => { calls++; await f.ports.updateTask(...args); throw new Error('SYNTHETIC_TASK_CAS_ACK_LOSS'); } });
  try {
    const done = await service.settle(f.v.plan.txId, f.v.accepted.taskId); assert.equal(done.execution.state, 'completed'); assert.equal(calls, 1);
    assert.deepEqual(await service.settle(f.v.plan.txId, f.v.accepted.taskId), done); assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('real fresh claim and protected staged rollback settle failed without a committed receipt', WINDOWS, async () => {
  const f = await fixture(false);
  try {
    const admission = await f.v.f.store.admissions.readByProposal(f.v.plan.txId); assert.ok(admission);
    await f.v.client.claimDistributionTask(f.v.plan.rootId, admission.proposalId, admission.inputDigest, admission.taskId);
    const native = await loadWindowsDistributionFiles(path.join(ROOT, 'native-build', 'native'));
    const transaction = new DistributionTransactionService({ journals: f.v.f.store.journals, receipts: f.v.f.store.receipts,
      authorize: (plan, signal) => f.v.f.domain.validate(plan, signal), artifact: (plan, index, signal) => f.v.f.domain.artifact(plan, index, signal),
      readTarget: async () => ({ rootId: f.v.plan.rootId, instanceId: f.v.plan.instanceId, revision: 1, gameDir: f.v.f.gameDir }),
      isIdle: async () => true, createFiles: native, canRecover: async () => false,
      checkpoint: async point => { if (point === 'staged') throw new Error('SYNTHETIC_STAGED_ROLLBACK'); } });
    await assert.rejects(transaction.commitFreshBound(f.v.plan, admission.gameIdentity), { code: 'NEEDS_RECOVERY' });
    assert.equal((await f.v.f.store.journals.read(f.v.plan.txId))?.data.phase, 'rolledBack');
    const done = await f.service().settle(f.v.plan.txId, f.v.accepted.taskId); assert.equal(done.execution.state, 'failed');
    assert.equal(await f.v.f.store.receipts.read(f.v.plan.instanceId), undefined); assert.deepEqual(await readdir(path.join(f.v.f.gameDir, 'mods')), []);
  } finally { await f.close(); }
});

test('later real receipt does not invalidate the already-settled historical task or require current receipt reads', WINDOWS, async () => {
  const f = await fixture();
  try {
    const done = await f.service().settle(f.v.plan.txId, f.v.accepted.taskId);
    const artifact = await f.v.f.artifact(localJar('later_mod'), 'later_mod');
    const next = f.v.f.plan([f.v.f.add(artifact, 'later.jar')]); await f.v.f.accept(next);
    assert.equal((await (await f.v.f.transaction()).commit(next)).phase, 'committed');
    assert.equal((await f.v.f.store.receipts.read(f.v.plan.instanceId))?.revision, 2);
    const replay = f.service({ receipts: { read: async () => { assert.fail('Settled history must not read the newer current receipt'); } } });
    assert.deepEqual(await replay.settle(f.v.plan.txId, f.v.accepted.taskId), done); assert.equal(f.updates(), 1);
  } finally { await f.close(); }
});

test('wrong root/task/proposal bindings and pristine queued journal cannot be settled as terminal tasks', WINDOWS, async () => {
  const f = await fixture(false);
  try {
    await f.v.coordinator.confirm(f.v.plan.txId); const before = await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId); assert.equal(before?.execution.state, 'queued');
    for (const [service, proposalId, taskId] of [
      [f.service({}, randomUUID()), f.v.plan.txId, f.v.accepted.taskId],
      [f.service(), randomUUID(), f.v.accepted.taskId], [f.service(), f.v.plan.txId, randomUUID()],
      [f.service(), f.v.plan.txId, f.v.accepted.taskId],
    ] as const) await assert.rejects(service.settle(proposalId, taskId), { code: 'NEEDS_RECOVERY' });
    assert.equal(f.updates(), 0); assert.deepEqual(await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId), before);
  } finally { await f.close(); }
});

test('actual competing CAS cannot be overwritten or treated as the exact settlement acknowledgement', WINDOWS, async () => {
  const f = await fixture();
  const service = f.service({ updateTask: async (root, task, revision, execution) => {
    const prior = await f.v.client.get(root, task); assert.ok(prior);
    await f.v.client.update(root, task, revision, { ...prior.execution, state: 'needsRecovery', revision: revision + 1 });
    return f.ports.updateTask(root, task, revision, execution);
  } });
  try {
    await assert.rejects(service.settle(f.v.plan.txId, f.v.accepted.taskId), { code: 'NEEDS_RECOVERY' });
    assert.equal((await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId))?.execution.state, 'needsRecovery');
  } finally { await f.close(); }
});

test('close drains a held actual task CAS and refuses new settlement without abandoning committed state', WINDOWS, async () => {
  const f = await fixture(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const service = f.service({ updateTask: async (...args) => { const done = await f.ports.updateTask(...args); enter(); await gate; return done; } });
  try {
    const work = service.settle(f.v.plan.txId, f.v.accepted.taskId); await entered;
    assert.equal((await f.v.client.get(f.v.plan.rootId, f.v.accepted.taskId))?.execution.state, 'completed');
    let closed = false; const closing = service.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
    await assert.rejects(service.settle(f.v.plan.txId, f.v.accepted.taskId), { code: 'UNAVAILABLE' });
    release(); assert.equal((await work).execution.state, 'completed'); await closing; assert.equal(closed, true); assert.equal(f.updates(), 1);
  } finally { release(); await f.close(); }
});
