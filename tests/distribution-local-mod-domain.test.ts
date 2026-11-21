import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LocalModDomain } from '../src/services/distribution/local-mod-domain.js';
import { SimulatedDistributionCrash, transactionDigest } from '../src/services/distribution/transaction-record.js';
import { localDomainFixture, localJar } from './helpers/distribution-local-domain-fixture.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
async function absent(file: string): Promise<void> { await assert.rejects(readFile(file), { code: 'ENOENT' }); }

test('local domain validates real JAR worker facts before and after a real SQLite/native transaction', WINDOWS, async () => {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact(); const plan = f.plan([f.add(entry)]); await f.accept(plan);
    await f.domain.validate(plan); assert.equal(await f.domain.artifact(plan, 0), entry.path);
    const result = await (await f.transaction()).commit(plan); assert.equal(result.phase, 'committed');
    assert.equal(hash(await readFile(path.join(f.gameDir, 'mods', 'managed.jar'))), entry.sha256);
    assert.equal((await f.store.receipts.read(plan.instanceId))?.data.txId, plan.txId);
    assert.equal((await f.store.journals.read(plan.txId))?.data.formatVersion, 2);
    assert.ok(f.counts().validations >= 2); assert.ok(f.counts().scans > 0); assert.equal(f.counts().activeScans, 0);
    assert.ok(f.resolutions.every(value => value.planDigest === transactionDigest(plan) && value.index === 0 && value.sha256 === entry.sha256 && value.permission === 'verified'));
    await assert.rejects(f.domain.validate(plan), { code: 'JOURNAL_UNAVAILABLE' });
    await absent(path.join(f.gameDir, 'oucl.session.lock'));
  } finally { await f.close(); }
});

test('internal execution coordinator confirms real local-domain JAR facts through SQLite and native publication exactly once', WINDOWS, async () => {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact(); const plan = f.plan([f.add(entry)]); await f.accept(plan); const coordinator = await f.coordinator(plan);
    try {
      const proposal = await coordinator.prepare(plan.txId, { rootId: plan.rootId, instanceId: plan.instanceId, sourceId: plan.sourceId,
        packageId: plan.packageId, packageVersion: plan.packageVersion });
      assert.equal(proposal.proposalId, plan.txId); assert.deepEqual(proposal.conflicts, []); assert.equal(proposal.changes.length, 1);
      const committed = await coordinator.confirm(plan.txId); assert.equal(committed.phase, 'committed');
      assert.deepEqual(await coordinator.confirm(plan.txId), committed);
      await assert.rejects(coordinator.cancel(plan.txId), { code: 'CANCEL_TOO_LATE' });
      assert.equal((await f.store.receipts.read(plan.instanceId))?.revision, 1);
      assert.equal(hash(await readFile(path.join(f.gameDir, 'mods', 'managed.jar'))), entry.sha256);
      assert.equal((await lstat(path.join(f.gameDir, 'mods', 'managed.jar'))).nlink, 1);
      await coordinator.close(); assert.equal(f.counts().activeScans, 0); await absent(path.join(f.gameDir, 'oucl.session.lock'));
    } finally { await coordinator.close(); }
  } finally { await f.close(); }
});

test('replace and remove final validation does not require the old JAR to remain in the published inventory', WINDOWS, async () => {
  const f = await localDomainFixture();
  try {
    const old = await f.artifact(); const add = f.plan([f.add(old)]); await f.accept(add); await f.domain.validate(add);
    await (await f.transaction()).commit(add); const claim = (await f.store.receipts.read(add.instanceId))!.data.entries[0]!;
    const fresh = await f.artifact(localJar('fixture_mod', '2.0.0'), 'fixture_mod', '2.0.0');
    const replace = f.plan([{ kind: 'replace', area: 'mods', path: 'managed.jar', artifactId: fresh.id, sha256: fresh.sha256, size: fresh.bytes.length,
      managedId: claim.managedId, expectedSha256: old.sha256 }]);
    await f.accept(replace); await f.domain.validate(replace); assert.equal((await (await f.transaction()).commit(replace)).phase, 'committed');
    assert.equal(hash(await readFile(path.join(f.gameDir, 'mods', 'managed.jar'))), fresh.sha256);
    const kept = await f.artifact(localJar('player_kept'), 'player_kept'); await f.install(kept, 'player.jar');
    const remove = f.plan([{ kind: 'remove', area: 'mods', path: 'managed.jar', managedId: claim.managedId, expectedSha256: fresh.sha256 },
      { kind: 'keep', area: 'mods', path: 'player.jar' }]);
    await f.accept(remove); await f.domain.validate(remove); const removed = await (await f.transaction()).commit(remove);
    assert.equal(removed.phase, 'committed'); assert.equal(removed.files.length, 1); assert.equal(removed.files[0]?.stage, 'backedUp');
    await absent(path.join(f.gameDir, 'mods', 'managed.jar')); assert.equal(hash(await readFile(path.join(f.gameDir, 'mods', 'player.jar'))), kept.sha256);
    assert.deepEqual((await f.store.receipts.read(remove.instanceId))?.data.entries, []);
    assert.ok(f.counts().validations >= 6);
  } finally { await f.close(); }
});

test('external final JAR mutation is rejected and rollback preserves the unknown replacement with needsRecovery', WINDOWS, async () => {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact(); const foreign = localJar('external_mod'); const plan = f.plan([f.add(entry)]); await f.accept(plan); await f.domain.validate(plan);
    const target = path.join(f.gameDir, 'mods', 'managed.jar');
    const transaction = await f.transaction(async point => { if (point === 'published') await writeFile(target, foreign); });
    await assert.rejects(transaction.commit(plan), { code: 'NEEDS_RECOVERY' });
    assert.ok(f.authorizeErrors.includes('FILES_CHANGED')); assert.equal(hash(await readFile(target)), hash(foreign));
    assert.equal(await f.store.receipts.read(plan.instanceId), undefined); assert.equal((await f.store.journals.read(plan.txId))?.data.phase, 'needsRecovery');
    assert.ok((await readFile(path.join(f.gameDir, 'oucl.session.lock'), 'utf8')).length > 0);
  } finally { await f.close(); }
});

for (const checkpoint of ['staged', 'published', 'receipt-committed'] as const) test(`local domain cannot adopt an invalid post session at transaction checkpoint ${checkpoint}`, WINDOWS, async () => {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact(); const plan = f.plan([f.add(entry)]); await f.accept(plan); await f.domain.validate(plan);
    await assert.rejects((await f.transaction(async point => { if (point === checkpoint) throw new SimulatedDistributionCrash(); })).commit(plan), SimulatedDistributionCrash);
    const domain = checkpoint === 'receipt-committed' ? f.makeDomain() : f.domain;
    const before = await f.store.journals.read(plan.txId);
    await assert.rejects(domain.validate(plan), { code: 'JOURNAL_UNAVAILABLE' });
    assert.deepEqual(await f.store.journals.read(plan.txId), before);
  } finally { await f.close(); }
});

test('class bridge blocks unknown permission, missing platform, server-only additions and unknown runtime facts', WINDOWS, async () => {
  for (const reason of ['permission', 'platform', 'server', 'runtime'] as const) {
    const f = await localDomainFixture();
    try {
      const entry = await f.artifact(); const plan = f.plan([f.add(entry)]);
      if (reason === 'permission') entry.permission = 'unknown';
      if (reason === 'platform') f.noPlatform();
      if (reason === 'server') entry.platform.environment = 'server_only';
      if (reason === 'runtime') f.context.environment.versions.java = null;
      await assert.rejects(f.domain.validate(plan), { code: reason === 'permission' ? 'PERMISSION_UNKNOWN' : reason === 'server' ? 'MODS_INCOMPATIBLE' : 'MODS_UNDETERMINED' });
      await absent(path.join(f.gameDir, 'mods', 'managed.jar')); assert.equal(await f.store.receipts.read(plan.instanceId), undefined);
    } finally { await f.close(); }
  }
});

test('local domain rejects unsupported nested mod paths and other content areas without publishing', WINDOWS, async () => {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact();
    for (const operation of [f.add(entry, 'nested/managed.jar'), { ...f.add(entry), area: 'resourcepacks' as const }]) {
      const plan = f.plan([operation]); await assert.rejects(f.domain.validate(plan), { code: 'UNSUPPORTED_OPERATION' });
    }
    await absent(path.join(f.gameDir, 'mods', 'managed.jar'));
  } finally { await f.close(); }
});

test('artifact cannot silently rebind an identical-content source to a different inode after validation', WINDOWS, async () => {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact(); const plan = f.plan([f.add(entry)]); await f.domain.validate(plan);
    const previous = await lstat(entry.path, { bigint: true }); await rename(entry.path, entry.path + '.retained'); await writeFile(entry.path, entry.bytes);
    assert.notEqual((await lstat(entry.path, { bigint: true })).ino, previous.ino);
    await assert.rejects(f.domain.artifact(plan, 0), { code: 'FILES_CHANGED' }); assert.equal(hash(await readFile(entry.path + '.retained')), entry.sha256);
  } finally { await f.close(); }
});

test('local domain TTL, active session and total identity bounds do not revive expired plans', WINDOWS, async () => {
  const f = await localDomainFixture({ maxSessions: 1, maxSeen: 4, ttlMs: 20 });
  try {
    const entry = await f.artifact(); const one = f.plan([f.add(entry)]); await f.domain.validate(one);
    const two = f.plan([f.add(entry)]); await assert.rejects(f.domain.validate(two), { code: 'DOMAIN_CAPACITY' });
    f.advance(20); await assert.rejects(f.domain.validate(one), { code: 'DOMAIN_EXPIRED' });
    await assert.rejects(f.domain.artifact(one, 0), { code: 'DOMAIN_EXPIRED' });
    const three = f.plan([f.add(entry)]); await f.domain.validate(three);
    const changed = { ...f.plan([f.add(entry)]), txId: one.txId }; await assert.rejects(f.domain.validate(changed), { code: 'INVALID_DOMAIN_INPUT' });
    const four = f.plan([f.add(entry)]); await assert.rejects(f.domain.validate(four), { code: 'DOMAIN_CAPACITY' });
    f.advance(20); await assert.rejects(f.domain.validate(f.plan([f.add(entry)])), { code: 'DOMAIN_CAPACITY' });
    assert.throws(() => new LocalModDomain(f.ports, { ttlMs: 300001 }), { code: 'INVALID_DOMAIN_INPUT' });
  } finally { await f.close(); }
});

test('clock rollback during an awaited port expires the existing artifact session before returning its path', WINDOWS, async () => {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact(); const plan = f.plan([f.add(entry)]); await f.domain.validate(plan);
    const gate = f.blockContext(); const artifact = f.domain.artifact(plan, 0); const rejected = assert.rejects(artifact, { code: 'DOMAIN_EXPIRED' });
    await gate.entered; f.advance(-1); gate.release(); await rejected;
    assert.equal(f.counts().activeScans, 0);
  } finally { await f.close(); }
});

test('aborting the original prepared request releases its session slot and preserves a cancelled identity', WINDOWS, async () => {
  const f = await localDomainFixture({ maxSessions: 1 });
  try {
    const entry = await f.artifact(); const one = f.plan([f.add(entry)]); const controller = new AbortController();
    await f.domain.validate(one, controller.signal); controller.abort();
    const two = f.plan([f.add(entry)]); await f.domain.validate(two);
    await assert.rejects(f.domain.validate(one), { code: 'CANCELLED' }); assert.equal(f.counts().activeScans, 0);
  } finally { await f.close(); }
});

for (const mode of ['cancel', 'close'] as const) test(`real archive worker ${mode} settles before local domain releases its active operation`, WINDOWS, async () => {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact(); const plan = f.plan([f.add(entry)]); const started = f.nextScan(); const controller = new AbortController();
    const validating = f.domain.validate(plan, controller.signal); const rejected = assert.rejects(validating, { code: 'CANCELLED' }); await started;
    assert.equal(f.counts().activeScans, 1);
    if (mode === 'cancel') {
      await assert.rejects(f.domain.validate(f.plan([f.add(entry)])), { code: 'DOMAIN_BUSY' }); controller.abort(); await rejected;
      assert.equal(f.counts().activeScans, 0); await f.domain.validate(f.plan([f.add(entry)]));
    } else {
      const closing = f.domain.close(); await rejected; await closing; assert.equal(f.counts().activeScans, 0);
      await assert.rejects(f.domain.validate(f.plan([f.add(entry)])), { code: 'DOMAIN_CLOSED' });
    }
  } finally { await f.close(); }
});
