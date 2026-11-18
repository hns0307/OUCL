import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DistributionTaskViewProvider } from '../src/services/distribution/task-views.js';
import { DistributionTaskSettlementService } from '../src/services/distribution/settlement.js';
import { DistributionExecutionRunner } from '../src/services/distribution/runner.js';
import { admittedExecutionFixture } from './helpers/distribution-admitted-execution-fixture.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
type Ports = ConstructorParameters<typeof DistributionTaskViewProvider>[1];
function gate() {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
  return { enter, release, entered, settled };
}
async function fixture() {
  const v = await admittedExecutionFixture();
  try {
    await v.client.writeInstance(v.plan.instanceId, 0, modReadyInstance(v.plan.rootId, v.plan.instanceId));
    const storage: Ports['storage'] = { readInstallation: () => v.client.readInstallation(), readInstance: id => v.client.readInstance(id),
      get: (...args) => v.client.get(...args), findAccepted: (...args) => v.client.findAccepted(...args),
      readDistributionTaskProjections: root => v.client.readDistributionTaskProjections(root) };
    const ports: Ports = { ready: async () => {}, admissions: v.f.store.admissions, storage };
    const providers = new Set<DistributionTaskViewProvider>();
    const provider = (overrides: Partial<Ports> = {}) => { const value = new DistributionTaskViewProvider(v.plan.rootId, { ...ports, ...overrides }); providers.add(value); return value; };
    const settlement = new DistributionTaskSettlementService(v.plan.rootId, { admissions: v.f.store.admissions,
      readProjections: root => v.client.readDistributionTaskProjections(root), journals: v.f.store.journals, receipts: v.f.store.receipts,
      updateTask: (...args) => v.client.update(...args) });
    const runner = new DistributionExecutionRunner(v.plan.rootId, { admissions: v.f.store.admissions,
      readProjections: root => v.client.readDistributionTaskProjections(root), coordinator: v.coordinator, settlement });
    return { v, ports, provider, runner, close: async () => {
      await Promise.all([...providers].map(value => value.close())); await runner.close(); await settlement.close(); await v.close();
    } };
  } catch (error) { await v.close(); throw error; }
}

test('real registered root/instance queued views become completed after actual runner/native settlement', WINDOWS, async () => {
  const f = await fixture(); const provider = f.provider();
  try {
    const queued = await provider.get(f.v.accepted.taskId); assert.equal(queued?.snapshot.state, 'queued');
    assert.deepEqual(await provider.list(), [queued!.snapshot]);
    assert.deepEqual(await provider.targets(f.v.plan.instanceId), [{ instanceId: f.v.plan.instanceId, instanceRevision: 1, task: queued!.snapshot }]);
    await f.runner.run(f.v.plan.txId, f.v.accepted.taskId);
    const completed = await provider.get(f.v.accepted.taskId); assert.equal(completed?.snapshot.state, 'completed');
    assert.deepEqual(await provider.list(), [completed!.snapshot]);
    assert.equal((await provider.targets(f.v.plan.instanceId))[0]?.task.state, 'completed');
    assert.equal(await provider.get(randomUUID()), undefined);
  } finally { await f.close(); }
});

test('real orphan task and malicious accepted-request binding cannot pass point lookup', WINDOWS, async () => {
  const f = await fixture();
  try {
    const orphan = randomUUID(); await f.v.client.projectDistributionTask(f.v.plan.rootId, randomUUID(), 'a'.repeat(64), orphan);
    await assert.rejects(f.provider().get(orphan), { code: 'NEEDS_RECOVERY' });
    const db = new DatabaseSync(path.join(f.v.f.base, 'task-owner', 'tasks.sqlite'));
    try { db.exec('PRAGMA foreign_keys=OFF'); db.prepare('DELETE FROM tasks WHERE id=?').run(orphan); } finally { db.close(); }
    await assert.rejects(f.provider().get(orphan), { code: 'NEEDS_RECOVERY' });
    const provider = f.provider({ storage: { ...f.ports.storage, findAccepted: async (...args) => {
      const value = await f.ports.storage.findAccepted(...args); assert.ok(value); return { ...value, taskId: randomUUID() };
    } } });
    await assert.rejects(provider.get(f.v.accepted.taskId), { code: 'NEEDS_RECOVERY' });
    const mutable = await f.v.f.store.admissions.readByTask(f.v.accepted.taskId); assert.ok(mutable);
    mutable.phase = 'accepted'; mutable.revision = 1;
    const racing = f.provider({ admissions: { listAll: () => f.v.f.store.admissions.listAll(), readByTask: async () => mutable },
      storage: { ...f.ports.storage, get: async (...args) => { mutable.phase = 'projected'; mutable.revision = 2; return f.ports.storage.get(...args); } } });
    await assert.rejects(racing.get(f.v.accepted.taskId), { code: 'UNAVAILABLE' });
  } finally { await f.close(); }
});

test('list/targets audit the full inventory before selected-instance filtering', WINDOWS, async () => {
  const f = await fixture(); const provider = f.provider();
  try {
    const other = randomUUID(); await f.v.client.writeInstance(other, 0, modReadyInstance(f.v.plan.rootId, other));
    assert.deepEqual(await provider.targets(other), []);
    await f.v.client.projectDistributionTask(f.v.plan.rootId, randomUUID(), 'b'.repeat(64), randomUUID());
    await assert.rejects(provider.targets(other), { code: 'NEEDS_RECOVERY' });
    await assert.rejects(provider.list(), { code: 'NEEDS_RECOVERY' });
  } finally { await f.close(); }
});

test('genuinely accepted but not projected admission is unavailable rather than empty', WINDOWS, async () => {
  const f = await fixture();
  try {
    const mutable = await f.v.f.store.admissions.listAll(); mutable[0]!.phase = 'accepted'; mutable[0]!.revision = 1;
    const racing = f.provider({ admissions: { readByTask: id => f.v.f.store.admissions.readByTask(id), listAll: async () => mutable },
      storage: { ...f.ports.storage, readDistributionTaskProjections: root => {
        mutable[0]!.phase = 'projected'; mutable[0]!.revision = 2; return f.ports.storage.readDistributionTaskProjections(root);
      } } });
    await assert.rejects(racing.list(), { code: 'UNAVAILABLE' });
    const proposalId = randomUUID();
    await f.v.coordinator.prepare(proposalId, { rootId: f.v.plan.rootId, instanceId: f.v.plan.instanceId, sourceId: f.v.plan.sourceId,
      packageId: f.v.plan.packageId, packageVersion: f.v.plan.packageVersion });
    const material = await f.v.coordinator.ticket(proposalId);
    const record = await f.v.f.store.admissions.admit({ ...material, confirmRequestId: randomUUID() });
    assert.equal(record.phase, 'accepted'); const provider = f.provider();
    await assert.rejects(provider.get(record.taskId), { code: 'UNAVAILABLE' });
    await assert.rejects(provider.list(), { code: 'UNAVAILABLE' });
    await assert.rejects(provider.targets(f.v.plan.instanceId), { code: 'UNAVAILABLE' });
  } finally { await f.close(); }
});

test('startup barrier blocks metadata reads and failure remains unavailable', WINDOWS, async () => {
  const f = await fixture(); const held = gate(); let reads = 0;
  try {
    const storage = { ...f.ports.storage, readInstallation: () => { reads++; return f.ports.storage.readInstallation(); } };
    const provider = f.provider({ ready: async () => { held.enter(); await held.settled; }, storage });
    const work = provider.get(f.v.accepted.taskId); await held.entered;
    assert.equal(reads, 0); held.release(); assert.equal((await work)?.snapshot.state, 'queued'); assert.ok(reads > 0);
    reads = 0; const failed = f.provider({ ready: async () => { throw new Error('SYNTHETIC_STARTUP_RECONCILIATION_FAILURE'); }, storage });
    await assert.rejects(failed.list(), { code: 'UNAVAILABLE' }); assert.equal(reads, 0);
  } finally { held.release(); await f.close(); }
});

test('real instance revision change and injected root revision drift invalidate target scope', WINDOWS, async () => {
  const f = await fixture();
  try {
    const mismatched = f.provider({ storage: { ...f.ports.storage, readInstance: async id => {
      const value = await f.v.client.readInstance(id); assert.ok(value);
      return { ...value, data: { ...value.data, summary: { ...value.data.summary, revision: value.revision + 1 } } };
    } } });
    await assert.rejects(mismatched.targets(f.v.plan.instanceId), { code: 'NEEDS_RECOVERY' });
    let instances = 0;
    const provider = f.provider({ storage: { ...f.ports.storage, readInstance: async id => {
      const value = await f.v.client.readInstance(id); assert.ok(value);
      if (++instances === 1) await f.v.client.writeInstance(id, value.revision, { ...value.data, summary: { ...value.data.summary, revision: value.revision + 1 } });
      return value;
    } } });
    await assert.rejects(provider.targets(f.v.plan.instanceId), { code: 'OUT_OF_SCOPE' });
    let roots = 0;
    const changed = f.provider({ storage: { ...f.ports.storage, readInstallation: async () => {
      const value = await f.v.client.readInstallation(); assert.ok(value); return ++roots === 1 ? value : { ...value, revision: value.revision + 1 };
    } } });
    await assert.rejects(changed.targets(f.v.plan.instanceId), { code: 'ROOT_UNAVAILABLE' });
    assert.equal((await f.provider().get(f.v.accepted.taskId))?.snapshot.state, 'queued');
  } finally { await f.close(); }
});

test('concurrent point and inventory readers share work; close drains held actual read', WINDOWS, async () => {
  const f = await fixture(); const held = gate(); const inventoryGate = gate(); let gets = 0; let inventories = 0;
  try {
    const other = randomUUID(); await f.v.client.writeInstance(other, 0, modReadyInstance(f.v.plan.rootId, other));
    const provider = f.provider({ storage: { ...f.ports.storage, get: async (...args) => {
      const value = await f.ports.storage.get(...args); gets++; held.enter(); await held.settled; return value;
    } } });
    const one = provider.get(f.v.accepted.taskId); await held.entered; const two = provider.get(f.v.accepted.taskId);
    assert.equal(gets, 1); let closed = false; const closing = provider.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
    await assert.rejects(provider.get(f.v.accepted.taskId), { code: 'UNAVAILABLE' });
    held.release(); assert.deepEqual(await one, await two); await closing;
    const all = f.provider({ admissions: { readByTask: id => f.v.f.store.admissions.readByTask(id), listAll: async () => {
      inventories++; const rows = await f.v.f.store.admissions.listAll(); inventoryGate.enter(); await inventoryGate.settled; return rows;
    } } });
    const list = all.list(); await inventoryGate.entered; const targets = all.targets(f.v.plan.instanceId);
    const sameTargets = all.targets(f.v.plan.instanceId); const otherTargets = all.targets(other);
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(inventories, 1);
    await assert.rejects(all.targets(randomUUID()), { code: 'CAPACITY_EXCEEDED' });
    inventoryGate.release(); assert.equal((await list).length, 1); assert.equal((await targets).length, 1);
    assert.equal((await sameTargets).length, 1); assert.deepEqual(await otherTargets, []);
  } finally { held.release(); inventoryGate.release(); await f.close(); }
});
