import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { admittedExecutionFixture } from './helpers/distribution-admitted-execution-fixture.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
type Fixture = Awaited<ReturnType<typeof admittedExecutionFixture>>;
async function noPublication(v: Fixture) {
  assert.equal(await v.f.store.journals.read(v.plan.txId), undefined);
  assert.equal(await v.f.store.receipts.read(v.plan.instanceId), undefined);
  await assert.rejects(readFile(path.join(v.f.gameDir, 'mods', 'managed.jar')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(v.f.gameDir, 'oucl.session.lock')), { code: 'ENOENT' });
  assert.equal(v.counts().artifacts, 0); assert.equal(v.counts().adapters, 0);
}

test('durable admission/projected task freshly claims once and commits through native; repeat reads terminal evidence only', WINDOWS, async () => {
  const v = await admittedExecutionFixture();
  try {
    assert.equal(v.accepted.snapshot.state, 'queued');
    const evidence = await v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId);
    assert.equal(evidence.phase, 'committed'); assert.equal(evidence.taskId, v.accepted.taskId); assert.equal(evidence.proposalId, v.plan.txId);
    assert.deepEqual(await readFile(path.join(v.f.gameDir, 'mods', 'managed.jar')), v.artifact.bytes);
    const before = v.counts(); assert.equal(before.claims, 1); assert.equal(before.adapters, 1); assert.equal(before.artifacts, 1);
    assert.deepEqual(await v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId), evidence); assert.deepEqual(v.counts(), before);
    await assert.rejects(v.coordinator.cancel(v.plan.txId), { code: 'CANCEL_TOO_LATE' });
    const stored = await v.client.get(v.plan.rootId, v.accepted.taskId);
    assert.equal(stored?.execution.state, 'running'); assert.equal(stored?.execution.attempt, 1);
    assert.equal((await v.f.store.receipts.read(v.plan.instanceId))?.revision, 1);
  } finally { await v.close(); }
});

test('real claim commit with lost acknowledgement leaves running and no journal/files; retry never regrants effects', WINDOWS, async () => {
  const v = await admittedExecutionFixture();
  try {
    v.loseClaimAck(); await assert.rejects(v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId), { code: 'NEEDS_RECOVERY' });
    assert.equal((await v.client.get(v.plan.rootId, v.accepted.taskId))?.execution.state, 'running'); await noPublication(v);
    await assert.rejects(v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId), { code: 'NEEDS_RECOVERY' });
    assert.equal(v.counts().claims, 1); await noPublication(v);
  } finally { await v.close(); }
});

test('busy target and original preview file snapshot changes reject before claim and preserve unknown content', WINDOWS, async () => {
  const v = await admittedExecutionFixture();
  try {
    v.setIdle(false);
    await assert.rejects(v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId), { code: 'INSTANCE_BUSY' });
    assert.equal(v.counts().claims, 0); assert.equal((await v.client.get(v.plan.rootId, v.accepted.taskId))?.execution.state, 'queued');
    await noPublication(v); v.setIdle(true);
    const user = path.join(v.f.gameDir, 'mods', 'user.jar'); await writeFile(user, 'synthetic-user-content');
    await assert.rejects(v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId), { code: 'FILES_CHANGED' });
    assert.equal(v.counts().claims, 0); assert.equal(await readFile(user, 'utf8'), 'synthetic-user-content'); await noPublication(v);
  } finally { await v.close(); }
});

test('same-path replacement root cannot inherit admitted original directory identity', WINDOWS, async () => {
  const v = await admittedExecutionFixture();
  try {
    await rename(v.f.gameDir, v.f.gameDir + '-original'); await mkdir(v.f.gameDir); await mkdir(path.join(v.f.gameDir, 'mods'));
    await assert.rejects(v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId), { code: 'FILES_CHANGED' });
    assert.equal(v.counts().claims, 0); await noPublication(v); assert.deepEqual(await readdir(path.join(v.f.gameDir + '-original', 'mods')), []);
  } finally { await v.close(); }
});

test('current synthetic trust revocation or signed release expiry blocks a fresh claim', WINDOWS, async () => {
  for (const reason of ['revoked', 'expired'] as const) {
    const v = await admittedExecutionFixture();
    try {
      if (reason === 'revoked') v.revoke(); else v.advance(3600000);
      await assert.rejects(v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId), { code: reason === 'revoked' ? 'UNTRUSTED_DISTRIBUTION' : 'RELEASE_EXPIRED' });
      assert.equal(v.counts().claims, 0); await noPublication(v);
    } finally { await v.close(); }
  }
});

test('cancel and close drain held real domain validation and exclude legacy confirmation before publication', WINDOWS, async () => {
  for (const mode of ['cancel', 'close'] as const) {
    const v = await admittedExecutionFixture(); const held = v.f.blockContext();
    try {
      const work = v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId); const rejected = assert.rejects(work, { code: 'CANCELLED' }); await held.entered;
      await assert.rejects(v.coordinator.confirm(v.plan.txId), { code: 'EXECUTION_ACTIVE_LIMIT' });
      await assert.rejects(v.coordinator.ticket(v.plan.txId), { code: 'EXECUTION_ACTIVE_LIMIT' });
      let closed = false;
      const cancellation = mode === 'cancel' ? v.coordinator.cancel(v.plan.txId) : Promise.resolve();
      const closing = v.coordinator.close().then(() => { closed = true; });
      await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
      held.release(); await cancellation; await rejected; await closing;
      assert.equal(v.counts().claims, 0); assert.equal(v.f.counts().activeScans, 0); await noPublication(v);
    } finally { held.release(); await v.close(); }
  }
});

test('legacy-created terminal journal with pristine queued task is not admitted execution evidence', WINDOWS, async () => {
  const v = await admittedExecutionFixture();
  try {
    await v.coordinator.confirm(v.plan.txId); assert.equal((await v.client.get(v.plan.rootId, v.accepted.taskId))?.execution.state, 'queued');
    const before = v.counts();
    await assert.rejects(v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId), { code: 'NEEDS_RECOVERY' });
    assert.deepEqual(v.counts(), before); assert.equal(before.claims, 0);
  } finally { await v.close(); }
});

for (const failRead of [false, true]) test(`actual receipt commit makes cancel too late and close drains cleanup${failRead ? ' with unknown terminal metadata' : ''}`, WINDOWS, async () => {
  const v = await admittedExecutionFixture(); const held = v.holdReceiptCommit();
  try {
    const work = v.coordinator.executeAdmitted(v.plan.txId, v.accepted.taskId);
    const outcome = failRead ? assert.rejects(work, { code: 'NEEDS_RECOVERY' }) : work;
    await held.entered;
    assert.equal((await v.f.store.receipts.read(v.plan.instanceId))?.revision, 1);
    assert.deepEqual(await readFile(path.join(v.f.gameDir, 'mods', 'managed.jar')), v.artifact.bytes);
    await assert.rejects(v.coordinator.cancel(v.plan.txId), { code: 'CANCEL_TOO_LATE' });
    let closed = false; const closing = v.coordinator.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
    if (failRead) v.failTerminalJournalReads();
    held.release(); const result = await outcome; await closing;
    if (!failRead) { assert.ok(result); assert.equal(result.phase, 'committed'); }
    assert.equal((await v.f.store.journals.read(v.plan.txId))?.data.phase, 'committed');
    assert.equal((await v.f.store.receipts.read(v.plan.instanceId))?.revision, 1);
    assert.equal((await v.client.get(v.plan.rootId, v.accepted.taskId))?.execution.state, 'running');
    await assert.rejects(readFile(path.join(v.f.gameDir, 'oucl.session.lock')), { code: 'ENOENT' });
    assert.equal(v.counts().claims, 1); assert.equal(v.counts().adapters, 1);
  } finally { held.release(); await v.close(); }
});
