import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localDomainFixture } from './helpers/distribution-local-domain-fixture.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
async function prepared() {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact(); const plan = f.plan([f.add(entry)]); await f.accept(plan);
    const coordinator = await f.coordinator(plan);
    try {
      const proposal = await coordinator.prepare(plan.txId, { rootId: plan.rootId, instanceId: plan.instanceId,
        sourceId: plan.sourceId, packageId: plan.packageId, packageVersion: plan.packageVersion });
      return { f, plan, entry, proposal, coordinator, close: async () => { await coordinator.close(); await f.close(); } };
    } catch (error) { await coordinator.close(); throw error; }
  } catch (error) { await f.close(); throw error; }
}
async function unpublished(value: Awaited<ReturnType<typeof prepared>>) {
  assert.equal(await value.f.store.journals.read(value.plan.txId), undefined);
  assert.equal(await value.f.store.receipts.read(value.plan.instanceId), undefined);
  await assert.rejects(readFile(path.join(value.f.gameDir, 'mods', 'managed.jar')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(value.f.gameDir, 'oucl.session.lock')), { code: 'ENOENT' });
}

test('real signed/worker/domain ticket is detached; durable admission repeats one task without publication', WINDOWS, async () => {
  const v = await prepared();
  try {
    assert.equal(v.proposal.instanceRevision, 1); assert.deepEqual(v.proposal.conflicts, []);
    const ticket = await v.coordinator.ticket(v.plan.txId);
    assert.equal(ticket.proposalId, v.plan.txId); assert.deepEqual(ticket.plan, v.plan);
    const accepted = await v.f.store.readAcceptedRelease({ sourceId: v.plan.sourceId, packageId: v.plan.packageId }); assert.ok(accepted);
    assert.equal(ticket.releaseSha256, accepted.releaseSha256); assert.match(ticket.previewFingerprint, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(ticket).sort(), ['gameIdentity', 'plan', 'previewFingerprint', 'proposalId', 'releaseSha256']);
    ticket.plan.instanceRevision = 999; ticket.gameIdentity.ino = '999';
    const fresh = await v.coordinator.ticket(v.plan.txId); assert.equal(fresh.plan.instanceRevision, 1); assert.notEqual(fresh.gameIdentity.ino, '999');
    assert.deepEqual(await v.f.store.admissions.listAll(), []); await unpublished(v);
    const request = { ...fresh, confirmRequestId: randomUUID() }; const receipt = await v.f.store.admissions.admit(request);
    assert.deepEqual(await v.f.store.admissions.admit(request), receipt);
    assert.equal(receipt.taskId, (await v.f.store.admissions.readByRequest(request.confirmRequestId))?.taskId);
    assert.equal(receipt.phase, 'accepted'); assert.equal((await v.f.store.admissions.listPending()).length, 1);
    assert.equal((await v.f.store.admissions.listAll()).length, 1); await unpublished(v);
    assert.deepEqual(await readdir(path.join(v.f.gameDir, 'mods')), []);
    assert.ok(v.f.counts().scans > 0); assert.equal(v.f.counts().activeScans, 0);
  } finally { await v.close(); }
});

test('ticket rejects an external file change and leaves unknown content untouched', WINDOWS, async () => {
  const v = await prepared();
  try {
    const unknown = path.join(v.f.gameDir, 'mods', 'user-added.jar'); await writeFile(unknown, 'user-owned-content');
    await assert.rejects(v.coordinator.ticket(v.plan.txId), { code: 'FILES_CHANGED' });
    assert.equal(await readFile(unknown, 'utf8'), 'user-owned-content'); await unpublished(v);
    assert.deepEqual(await v.f.store.admissions.listAll(), []);
  } finally { await v.close(); }
});

test('new accepted release high-water invalidates the old ticket without publication', WINDOWS, async () => {
  const v = await prepared();
  try {
    const next = v.f.plan([v.f.add(v.entry)]); await v.f.accept(next);
    await assert.rejects(v.coordinator.ticket(v.plan.txId), { code: 'UNTRUSTED_DISTRIBUTION' });
    await unpublished(v); assert.deepEqual(await v.f.store.admissions.listAll(), []);
  } finally { await v.close(); }
});

test('expired proposal identity cannot obtain a ticket or revive on retry', WINDOWS, async () => {
  const v = await prepared();
  try {
    v.f.advance(300000);
    await assert.rejects(v.coordinator.ticket(v.plan.txId), { code: 'EXECUTION_REQUEST_EXPIRED' });
    await assert.rejects(v.coordinator.ticket(v.plan.txId), { code: 'EXECUTION_REQUEST_EXPIRED' });
    await unpublished(v); assert.deepEqual(await v.f.store.admissions.listAll(), []);
  } finally { await v.close(); }
});

for (const mode of ['cancel', 'close'] as const) test(`ticket ${mode} rejects and drains a held real domain context before shutdown`, WINDOWS, async () => {
  const v = await prepared(); const held = v.f.blockContext();
  try {
    const work = v.coordinator.ticket(v.plan.txId); const rejected = assert.rejects(work, { code: 'CANCELLED' }); await held.entered;
    let drained = false;
    if (mode === 'cancel') await v.coordinator.cancel(v.plan.txId);
    const closing = v.coordinator.close().then(() => { drained = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(drained, false);
    held.release(); await rejected; await closing; assert.equal(drained, true);
    assert.equal(v.f.counts().activeScans, 0); await unpublished(v);
  } finally { held.release(); await v.close(); }
});

test('ticket singleflight and legacy confirm are mutually exclusive before any publication', WINDOWS, async () => {
  for (const first of ['ticket', 'confirm'] as const) {
    const v = await prepared(); const held = v.f.blockContext();
    try {
      const work = first === 'ticket' ? v.coordinator.ticket(v.plan.txId) : v.coordinator.confirm(v.plan.txId);
      const rejected = assert.rejects(work, { code: 'CANCELLED' }); await held.entered;
      let sameRejected: Promise<void> | undefined;
      if (first === 'ticket') {
        const same = v.coordinator.ticket(v.plan.txId); sameRejected = assert.rejects(same, { code: 'CANCELLED' });
        await assert.rejects(v.coordinator.confirm(v.plan.txId), { code: 'EXECUTION_ACTIVE_LIMIT' });
      } else await assert.rejects(v.coordinator.ticket(v.plan.txId), { code: 'EXECUTION_ACTIVE_LIMIT' });
      await unpublished(v); await v.coordinator.cancel(v.plan.txId); held.release(); await rejected; await sameRejected;
      await unpublished(v); assert.deepEqual(await v.f.store.admissions.listAll(), []);
    } finally { held.release(); await v.close(); }
  }
});
