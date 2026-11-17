import assert from 'node:assert/strict';
import test from 'node:test';
import { lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { DistributionTransactionService } from '../src/services/distribution/transaction.js';
import type { DistributionTransactionPorts } from '../src/services/distribution/transaction.js';
import { SimulatedDistributionCrash } from '../src/services/distribution/transaction-record.js';
import type { DirectoryProof } from '../src/services/distribution/transaction-record.js';
import { loadWindowsDistributionFiles } from '../src/services/distribution/native-files.js';
import { localDomainFixture, ROOT } from './helpers/distribution-local-domain-fixture.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
async function fixture() {
  const f = await localDomainFixture();
  try {
    const entry = await f.artifact(); const plan = f.plan([f.add(entry)]); await f.accept(plan);
    const info = await lstat(f.gameDir, { bigint: true }); const proof = { dev: String(info.dev), ino: String(info.ino) };
    const ports: DistributionTransactionPorts = { journals: f.store.journals, receipts: f.store.receipts,
      authorize: (input, signal) => f.domain.validate(input, signal),
      readTarget: async () => ({ rootId: plan.rootId, instanceId: plan.instanceId, revision: 1, gameDir: f.gameDir }),
      isIdle: async () => true, artifact: (input, index, signal) => f.domain.artifact(input, index, signal), canRecover: () => Promise.resolve(false) };
    return { f, plan, entry, proof, ports };
  } catch (error) { await f.close(); throw error; }
}
async function untouched(v: Awaited<ReturnType<typeof fixture>>) {
  assert.equal(await v.f.store.journals.read(v.plan.txId), undefined); assert.equal(await v.f.store.receipts.read(v.plan.instanceId), undefined);
  assert.deepEqual(await readdir(path.join(v.f.gameDir, 'mods')), []);
  await assert.rejects(readFile(path.join(v.f.gameDir, 'oucl.session.lock')), { code: 'ENOENT' });
}

test('real native fresh-bound first commit binds the captured root and refuses a second call', WINDOWS, async () => {
  const v = await fixture();
  try {
    await v.f.transaction(); // Builds the existing fixture's protected helper in this process-owned root.
    const nativeFactory = await loadWindowsDistributionFiles(path.join(ROOT, 'native-build', 'native'));
    const bindings: Array<DirectoryProof | undefined> = [];
    const service = new DistributionTransactionService({ ...v.ports, createFiles: (gameDir, txId, expectedRoot) => {
      bindings.push(expectedRoot ? { ...expectedRoot } : undefined); return nativeFactory(gameDir, txId, expectedRoot);
    } });
    const journal = await service.commitFreshBound(v.plan, v.proof);
    assert.equal(journal.phase, 'committed'); assert.deepEqual(journal.gameIdentity, v.proof);
    assert.deepEqual(bindings, [v.proof]);
    assert.deepEqual(await readFile(path.join(v.f.gameDir, 'mods', 'managed.jar')), v.entry.bytes);
    await assert.rejects(service.commitFreshBound(v.plan, v.proof), { code: 'NEEDS_RECOVERY' });
    assert.equal(bindings.length, 1);
    assert.equal((await v.f.store.receipts.read(v.plan.instanceId))?.revision, 1);
  } finally { await v.f.close(); }
});

test('replacement of the original root inode fails before lease, journal or publication', WINDOWS, async () => {
  const v = await fixture();
  try {
    const service = await v.f.transaction(); await rename(v.f.gameDir, v.f.gameDir + '-original');
    await mkdir(v.f.gameDir); await mkdir(path.join(v.f.gameDir, 'mods'));
    assert.notEqual(String((await lstat(v.f.gameDir, { bigint: true })).ino), v.proof.ino);
    await assert.rejects(service.commitFreshBound(v.plan, v.proof), { code: 'NEEDS_RECOVERY' }); await untouched(v);
    assert.deepEqual(await readdir(path.join(v.f.gameDir + '-original', 'mods')), []);
  } finally { await v.f.close(); }
});

test('missing protected factory and malformed proof reject before calling authorization or artifacts', WINDOWS, async () => {
  const v = await fixture(); let calls = 0;
  const service = new DistributionTransactionService({ ...v.ports, authorize: async () => { calls++; }, artifact: async () => { calls++; return v.entry.path; } });
  try {
    await assert.rejects(service.commitFreshBound(v.plan, v.proof), { code: 'NEEDS_RECOVERY' });
    for (const proof of [{ ...v.proof, ino: '0' }, { ...v.proof, dev: '-1' }, { ...v.proof, extra: true }]) {
      await assert.rejects(service.commitFreshBound(v.plan, proof), { code: 'INVALID_TRANSACTION' });
    }
    assert.equal(calls, 0); await untouched(v);
  } finally { await v.f.close(); }
});

test('existing terminal and interrupted journals never call fresh factory or artifact', WINDOWS, async () => {
  for (const phase of ['committed', 'partial'] as const) {
    const v = await fixture();
    try {
      const original = await v.f.transaction(phase === 'partial' ? async point => { if (point === 'staged') throw new SimulatedDistributionCrash(); } : undefined);
      if (phase === 'partial') await assert.rejects(original.commit(v.plan), SimulatedDistributionCrash);
      else await original.commit(v.plan);
      let effects = 0;
      const service = new DistributionTransactionService({ ...v.ports, createFiles: () => { effects++; throw new Error('Must not construct adapter'); },
        authorize: async () => { effects++; }, artifact: async () => { effects++; return v.entry.path; } });
      const before = await v.f.store.journals.read(v.plan.txId);
      await assert.rejects(service.commitFreshBound(v.plan, v.proof), { code: 'NEEDS_RECOVERY' });
      assert.equal(effects, 0); assert.deepEqual(await v.f.store.journals.read(v.plan.txId), before);
      // The controlled interruption retains its own fixture lease; do not call recovery with the same metadata owner.
    } finally { await v.f.close(); }
  }
});

test('caller proof mutation during awaited authorization cannot change the captured expected root', WINDOWS, async () => {
  const v = await fixture();
  try {
    const service = await v.f.transaction(); const gate = v.f.blockContext(); const proof: DirectoryProof = { ...v.proof };
    const work = service.commitFreshBound(v.plan, proof); await gate.entered;
    proof.ino = '999'; proof.dev = '999'; gate.release();
    const journal = await work; assert.equal(journal.phase, 'committed'); assert.deepEqual(journal.gameIdentity, v.proof);
    assert.deepEqual(await readFile(path.join(v.f.gameDir, 'mods', 'managed.jar')), v.entry.bytes);
  } finally { await v.f.close(); }
});
