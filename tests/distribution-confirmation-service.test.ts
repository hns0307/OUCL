import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DistributionConfirmationPorts } from '../src/services/distribution/confirmation.js';
import { confirmationFixture } from './helpers/distribution-confirmation-fixture.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
type Fixture = Awaited<ReturnType<typeof confirmationFixture>>;
function admissionPorts(f: Fixture, overrides: Partial<DistributionConfirmationPorts['admissions']> = {}): DistributionConfirmationPorts['admissions'] {
  return { readByRequest: id => f.admissions.readByRequest(id), readByProposal: id => f.admissions.readByProposal(id),
    admit: input => f.admissions.admit(input), bindReceiptAlias: (...args) => f.admissions.bindReceiptAlias(...args), ...overrides };
}
async function metadataOnly(f: Fixture) {
  assert.equal(await f.domain.store.journals.read(f.plan.txId), undefined);
  assert.equal(await f.domain.store.receipts.read(f.plan.instanceId), undefined);
  assert.deepEqual(await readdir(path.join(f.domain.gameDir, 'mods')), []);
  await assert.rejects(readFile(path.join(f.domain.gameDir, 'oucl.session.lock')), { code: 'ENOENT' });
}
function gate() {
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
  return { enter, release, entered, settled };
}

test('real ticket admits and projects one queued task; old receipt aliases survive higher release and proposal TTL', WINDOWS, async () => {
  const f = await confirmationFixture(); const service = f.service();
  try {
    const id = randomUUID(); const first = await service.confirm(id, f.input);
    assert.equal(first.proposalId, f.plan.txId); assert.equal(first.snapshot.taskId, first.taskId);
    assert.equal(first.snapshot.kind, 'distribution-install'); assert.equal(first.snapshot.state, 'queued');
    assert.deepEqual(await service.confirm(id, f.input), first); assert.equal(f.counts().tickets, 1);
    const next = f.domain.plan([f.domain.add(f.artifact)]); await f.domain.accept(next); f.domain.advance(300000);
    const aliasId = randomUUID(); assert.deepEqual(await service.confirm(aliasId, f.input), first);
    assert.deepEqual(await service.confirm(id, f.input), first); assert.equal(f.counts().tickets, 1);
    assert.equal((await f.admissions.readByRequest(aliasId))?.taskId, first.taskId);
    assert.equal((await f.admissions.listAll()).length, 1);
    assert.equal((await f.client.readDistributionTaskProjections(f.plan.rootId)).length, 1);
    await metadataOnly(f); assert.ok(f.domain.counts().scans > 0);
  } finally { await f.close(); }
});

test('wrong root/revision/sequence and conflicting request identity refuse new admission', WINDOWS, async () => {
  const f = await confirmationFixture(); const service = f.service();
  try {
    await assert.rejects(service.confirm(randomUUID(), { ...f.input, instanceRevision: 2 }), { code: 'REQUEST_CONFLICT' });
    await assert.rejects(service.confirm(randomUUID(), { ...f.input, sequence: 2 }), { code: 'REQUEST_CONFLICT' });
    await assert.rejects(f.service({}, randomUUID()).confirm(randomUUID(), f.input), { code: 'REQUEST_CONFLICT' });
    assert.deepEqual(await f.admissions.listAll(), []);
    const id = randomUUID(); const first = await service.confirm(id, f.input);
    await assert.rejects(service.confirm(id, { ...f.input, proposalId: randomUUID() }), { code: 'REQUEST_CONFLICT' });
    await assert.rejects(service.confirm(id, { ...f.input, sequence: 2 }), { code: 'REQUEST_CONFLICT' });
    await assert.rejects(service.confirm('not-a-uuid', f.input), { code: 'INVALID_ARGUMENT' });
    assert.equal((await f.client.readDistributionTaskProjections(f.plan.rootId))[0]?.task.taskId, first.taskId);
    assert.equal((await f.admissions.listAll()).length, 1); await metadataOnly(f);
  } finally { await f.close(); }
});

for (const lost of ['admit', 'project', 'mark'] as const) test(`real ${lost} commit with lost acknowledgement returns the one durable task`, WINDOWS, async () => {
  const f = await confirmationFixture(); let injected = 0;
  const admissions = admissionPorts(f, { admit: async input => {
    const value = await f.admissions.admit(input); if (lost === 'admit' && injected++ === 0) throw new Error('lost admitted acknowledgement'); return value;
  } });
  const reconciler = f.reconciliation({
    project: async (...args) => { const value = await f.reconciliationPorts.project(...args); if (lost === 'project' && injected++ === 0) throw new Error('lost projected acknowledgement'); return value; },
    admissions: { listAll: () => f.admissions.listAll(), readByProposal: id => f.admissions.readByProposal(id), markProjected: async (...args) => {
      const value = await f.admissions.markProjected(...args); if (lost === 'mark' && injected++ === 0) throw new Error('lost marked acknowledgement'); return value;
    } },
  });
  const service = f.service({ admissions, reconcile: () => reconciler.reconcile() });
  try {
    const id = randomUUID(); const result = await service.confirm(id, f.input); assert.equal(injected, 1);
    assert.deepEqual(await service.confirm(id, f.input), result); assert.equal(f.counts().tickets, 1);
    const stored = await f.admissions.readByRequest(id); assert.equal(stored?.taskId, result.taskId); assert.equal(stored?.phase, 'projected');
    const rows = await f.client.readDistributionTaskProjections(f.plan.rootId); assert.equal(rows.length, 1); assert.equal(rows[0]!.task.taskId, result.taskId);
    await metadataOnly(f);
  } finally { await f.close(); }
});

test('reopened service reads original durable confirmation without obtaining another ticket', WINDOWS, async () => {
  const f = await confirmationFixture(); const firstService = f.service();
  try {
    const id = randomUUID(); const result = await firstService.confirm(id, f.input); await firstService.close(); await f.coordinator.close();
    const reopened = f.service({ ticket: async () => { assert.fail('Receipt replay must not obtain a new ticket'); } });
    await assert.rejects(reopened.confirm(id, { ...f.input, sequence: f.input.sequence + 1 }), { code: 'REQUEST_CONFLICT' });
    assert.deepEqual(await reopened.confirm(id, f.input), result);
    assert.deepEqual(await reopened.confirm(randomUUID(), f.input), result);
    assert.equal(f.counts().tickets, 1); assert.equal((await f.admissions.listAll()).length, 1); await metadataOnly(f);
  } finally { await f.close(); }
});

test('different proposals serialize complete metadata chains without overlapping tickets or task identities', WINDOWS, async () => {
  const f = await confirmationFixture(); const held = gate(); const started: string[] = [];
  try {
    const secondId = randomUUID();
    const second = await f.coordinator.prepare(secondId, { rootId: f.plan.rootId, instanceId: f.plan.instanceId,
      sourceId: f.plan.sourceId, packageId: f.plan.packageId, packageVersion: f.plan.packageVersion });
    assert.equal(second.sequence, f.input.sequence);
    const service = f.service({ ticket: async id => {
      started.push(id); if (id === f.plan.txId) { held.enter(); await held.settled; }
      return f.ports.ticket(id);
    } });
    const first = service.confirm(randomUUID(), f.input); await held.entered;
    const next = service.confirm(randomUUID(), { proposalId: secondId, instanceRevision: second.instanceRevision, sequence: second.sequence });
    const both = Promise.all([first, next]);
    await new Promise<void>(resolve => setImmediate(resolve)); assert.deepEqual(started, [f.plan.txId]);
    held.release(); const [a, b] = await both;
    assert.deepEqual(started, [f.plan.txId, secondId]); assert.notEqual(a.taskId, b.taskId);
    assert.equal(a.proposalId, f.plan.txId); assert.equal(b.proposalId, secondId);
    assert.equal(a.snapshot.state, 'queued'); assert.equal(b.snapshot.state, 'queued');
    assert.equal((await f.admissions.listAll()).length, 2);
    const rows = await f.client.readDistributionTaskProjections(f.plan.rootId);
    assert.equal(rows.length, 2); assert.deepEqual(new Set(rows.map(row => row.task.taskId)), new Set([a.taskId, b.taskId]));
    assert.equal(await f.domain.store.journals.read(secondId), undefined); await metadataOnly(f);
  } finally { held.release(); await f.close(); }
});

test('same ID shares held real ticket and close waits the admitted operation to settle', WINDOWS, async () => {
  const f = await confirmationFixture(); const held = f.domain.blockContext(); const service = f.service();
  try {
    const id = randomUUID(); const one = service.confirm(id, f.input); const two = service.confirm(id, f.input); await held.entered;
    assert.equal(f.counts().tickets, 1); let closed = false; const closing = service.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
    await assert.rejects(service.confirm(randomUUID(), f.input), { code: 'UNAVAILABLE' });
    held.release(); const first = await one; const second = await two; assert.deepEqual(first, second); assert.notEqual(first, second);
    await closing; assert.equal(closed, true); assert.equal((await f.admissions.listAll()).length, 1);
    first.snapshot.revision = 999; assert.notEqual(second.snapshot.revision, 999); await metadataOnly(f);
  } finally { held.release(); await f.close(); }
});

test('close after real admission commit drains projection/read-back without abandoning uncertain acceptance', WINDOWS, async () => {
  const f = await confirmationFixture(); const held = gate();
  const service = f.service({ admissions: admissionPorts(f, { admit: async input => {
    const value = await f.admissions.admit(input); held.enter(); await held.settled; return value;
  } }) });
  try {
    const id = randomUUID(); const work = service.confirm(id, f.input); await held.entered;
    const committed = await f.admissions.readByRequest(id); assert.ok(committed); assert.equal(committed.phase, 'accepted');
    assert.deepEqual(await f.client.readDistributionTaskProjections(f.plan.rootId), []);
    let closed = false; const closing = service.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
    held.release(); const result = await work; await closing;
    assert.equal(result.taskId, committed.taskId); assert.equal((await f.admissions.readByRequest(id))?.phase, 'projected');
    assert.equal((await f.client.readDistributionTaskProjections(f.plan.rootId)).length, 1); await metadataOnly(f);
  } finally { held.release(); await f.close(); }
});
