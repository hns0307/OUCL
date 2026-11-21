import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DistributionAdmissionReconciler } from '../src/services/distribution/reconciliation.js';
import { reconciliationFixture } from './helpers/distribution-reconciliation-fixture.js';

const windows = { skip: process.platform !== 'win32' };
test('real authority and worker reconcile a fixed task identity exactly once', windows, async () => {
  const f = await reconciliationFixture(); const reconciler = new DistributionAdmissionReconciler(f.rootId, f.ports);
  try {
    const record = await f.store.admissions.admit(f.intent());
    assert.deepEqual(await reconciler.reconcile(), { rootId: f.rootId, inspected: 1, projected: 1 });
    const rows = await f.client.readDistributionTaskProjections(f.rootId);
    assert.equal(rows.length, 1); assert.equal(rows[0]!.task.taskId, record.taskId);
    assert.equal(rows[0]!.payloadDigest, record.inputDigest); assert.equal(rows[0]!.task.execution.state, 'queued');
    assert.equal((await f.store.admissions.readByProposal(record.proposalId))?.phase, 'projected');
    assert.deepEqual(await reconciler.reconcile(), { rootId: f.rootId, inspected: 1, projected: 0 });
    assert.deepEqual(await f.client.readDistributionTaskProjections(f.rootId), rows);
  } finally { await reconciler.close(); await f.close(); }
});

for (const lost of ['project', 'mark'] as const) test(`actual ${lost} commit with lost acknowledgement recovers the same task`, windows, async () => {
  const f = await reconciliationFixture(); let injected = 0;
  const reconciler = new DistributionAdmissionReconciler(f.rootId, { ...f.ports,
    project: async (...args) => { const result = await f.ports.project(...args); if (lost === 'project' && injected++ === 0) throw new Error('lost project acknowledgement'); return result; },
    admissions: { listAll: () => f.store.admissions.listAll(), readByProposal: id => f.store.admissions.readByProposal(id), markProjected: async (...args) => {
      const result = await f.store.admissions.markProjected(...args); if (lost === 'mark' && injected++ === 0) throw new Error('lost mark acknowledgement'); return result;
    } },
  });
  try {
    const record = await f.store.admissions.admit(f.intent());
    assert.equal((await reconciler.reconcile()).projected, 1); assert.equal(injected, 1);
    await reconciler.reconcile(); const rows = await f.client.readDistributionTaskProjections(f.rootId);
    assert.equal(rows.length, 1); assert.equal(rows[0]!.task.taskId, record.taskId);
    assert.equal((await f.store.admissions.readByProposal(record.proposalId))?.revision, 2);
  } finally { await reconciler.close(); await f.close(); }
});

for (const scenario of ['orphan', 'digest', 'task-id', 'projected-missing'] as const) test(`refuses ${scenario} without reconstructing a queued task`, windows, async () => {
  const f = await reconciliationFixture(); const reconciler = new DistributionAdmissionReconciler(f.rootId, f.ports);
  try {
    if (scenario === 'orphan') await f.ports.project(f.rootId, randomUUID(), 'b'.repeat(64), randomUUID());
    else {
      const record = await f.store.admissions.admit(f.intent());
      if (scenario === 'projected-missing') await f.store.admissions.markProjected(record.proposalId, record.taskId);
      else await f.ports.project(f.rootId, record.proposalId, scenario === 'digest' ? 'b'.repeat(64) : record.inputDigest,
        scenario === 'task-id' ? randomUUID() : record.taskId);
    }
    const before = await f.client.readDistributionTaskProjections(f.rootId);
    await assert.rejects(reconciler.reconcile(), { code: 'NEEDS_RECOVERY' });
    assert.deepEqual(await f.client.readDistributionTaskProjections(f.rootId), before);
  } finally { await reconciler.close(); await f.close(); }
});

test('unconfirmed proposals and another root never create a task; worker enforces expected root', windows, async () => {
  const f = await reconciliationFixture(); const reconciler = new DistributionAdmissionReconciler(f.rootId, f.ports);
  try {
    f.intent(); assert.equal((await reconciler.reconcile()).inspected, 0);
    const otherRoot = randomUUID(); await f.store.admissions.admit(f.intent(otherRoot));
    assert.deepEqual(await reconciler.reconcile(), { rootId: f.rootId, inspected: 0, projected: 0 });
    assert.deepEqual(await f.client.readDistributionTaskProjections(f.rootId), []);
    await assert.rejects(f.client.readDistributionTaskProjections(otherRoot), { code: 'NEEDS_RECOVERY' });
    await assert.rejects(f.client.projectDistributionTask(otherRoot, randomUUID(), 'a'.repeat(64), randomUUID()), { code: 'NEEDS_RECOVERY' });
  } finally { await reconciler.close(); await f.close(); }
});

test('close drains a held actual commit and rejects subsequent reconciliation', windows, async () => {
  const f = await reconciliationFixture(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const reconciler = new DistributionAdmissionReconciler(f.rootId, { ...f.ports,
    project: async (...args) => { const value = await f.ports.project(...args); enter(); await gate; return value; } });
  try {
    await f.store.admissions.admit(f.intent()); const running = reconciler.reconcile(); await entered;
    let closed = false; const closing = reconciler.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
    await assert.rejects(reconciler.reconcile(), { code: 'CLOSED' }); release();
    assert.equal((await running).projected, 1); await closing; assert.equal(closed, true);
    assert.equal((await f.client.readDistributionTaskProjections(f.rootId)).length, 1);
  } finally { release(); await reconciler.close(); await f.close(); }
});

test('final audit rejects admissions added after the startup snapshot', windows, async () => {
  const f = await reconciliationFixture(); let added = false;
  const reconciler = new DistributionAdmissionReconciler(f.rootId, { ...f.ports, project: async (...args) => {
    const task = await f.ports.project(...args); if (!added) { added = true; await f.store.admissions.admit(f.intent()); } return task;
  } });
  try {
    await f.store.admissions.admit(f.intent());
    await assert.rejects(reconciler.reconcile(), { code: 'NEEDS_RECOVERY' });
    assert.equal((await f.store.admissions.listAll()).length, 2);
    assert.equal((await f.client.readDistributionTaskProjections(f.rootId)).length, 1);
  } finally { await reconciler.close(); await f.close(); }
});
