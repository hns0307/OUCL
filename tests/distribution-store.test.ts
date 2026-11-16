import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DistributionStore } from '../src/services/distribution/store.js';
import { canonicalDistributionReleasePayload } from '../src/core/distribution/release.js';
import { transactionDigest, transactionReceipt } from '../src/services/distribution/transaction-record.js';
import type { DistributionJournal, DistributionPlan, DistributionReceipt } from '../src/services/distribution/transaction-record.js';

const windows = { skip: process.platform !== 'win32' };
async function directory(): Promise<string> {
  const root = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/distribution-store-tests'); await mkdir(root, { recursive: true }); return mkdtemp(path.join(root, 'ledger-'));
}
const scope = { sourceId: 'club-source', packageId: 'club' };
const first = { sequence: 1, releaseSha256: 'a'.repeat(64) };
function receipt(instanceId: string = randomUUID()): DistributionReceipt { return { formatVersion: 1, instanceId, txId: randomUUID(), planDigest: 'b'.repeat(64), entries: [], releases: [] }; }
function journal(): DistributionJournal {
  const manifest = { formatVersion: 1 as const, packageId: 'club', packageVersion: 'one', target: { minecraft: '1.20.1', javaMajor: 17 as const, loader: 'vanilla' as const, loaderVersion: null }, operations: [] };
  const plan: DistributionPlan = { formatVersion: 1, txId: randomUUID(), rootId: randomUUID(), instanceId: randomUUID(), instanceRevision: 1,
    sourceId: 'club-source', packageId: 'club', packageVersion: 'one', sequence: 1, manifestSha256: transactionDigest(manifest), manifest };
  return { formatVersion: 1, plan, planDigest: transactionDigest(plan), leaseToken: randomUUID(), phase: 'prepared',
    beforeReceiptRevision: 0, beforeReceipt: null, afterReceipt: transactionReceipt(plan, null), files: [], pending: null };
}

test('private SQLite ledger persists monotonic publisher state and exact CAS across owner restarts', windows, async () => {
  const root = await directory(); let store = await DistributionStore.open(root);
  try {
    assert.equal(await store.compareAndSet(scope, undefined, first), true);
    assert.equal(await store.compareAndSet(scope, undefined, first), false);
    assert.equal(await store.compareAndSet(scope, first, first), true);
    await assert.rejects(store.compareAndSet(scope, first, { ...first, releaseSha256: 'b'.repeat(64) }), { code: 'INVALID_RECORD' });
    assert.equal(await store.compareAndSet(scope, first, { sequence: 2, releaseSha256: 'c'.repeat(64) }), true);
    await assert.rejects(store.compareAndSet(scope, { sequence: 2, releaseSha256: 'c'.repeat(64) }, first), { code: 'INVALID_RECORD' });
    await store.close(); store = await DistributionStore.open(root);
    assert.deepEqual(await store.read(scope), { sequence: 2, releaseSha256: 'c'.repeat(64) });
  } finally { await store.close(); }
});

test('ledger journals and receipt commits are CAS records; recovery never adopts a live transaction', windows, async () => {
  const root = await directory(); let store = await DistributionStore.open(root); const value = journal();
  try {
    const record = await store.journals.write(value.plan.txId, 0, value); assert.equal(record.revision, 1);
    assert.equal(await store.canRecover(value.plan.txId, value.leaseToken), false);
    await assert.rejects(store.journals.write(value.plan.txId, 0, value), { code: 'REVISION_CONFLICT' });
    await assert.rejects(store.receipts.commit(value.plan.instanceId, 0, receipt(value.plan.instanceId)), { code: 'INVALID_RECORD' });
    const output = value.afterReceipt;
    await store.journals.write(value.plan.txId, record.revision, { ...value, phase: 'applying' });
    const payload = { releaseFormatVersion: 2 as const, sourceId: value.plan.sourceId, packageId: value.plan.packageId, packageVersion: value.plan.packageVersion,
      sequence: value.plan.sequence, issuedAt: 1000, expiresAt: 2000, manifestSha256: value.plan.manifestSha256, manifest: value.plan.manifest };
    const { privateKey } = generateKeyPairSync('ed25519'); const canonical = canonicalDistributionReleasePayload(payload);
    const releaseSha256 = createHash('sha256').update(canonical).digest('hex');
    const envelope = { payload, signature: { algorithm: 'ed25519' as const, keyId: 'test-key', value: sign(null, Buffer.from(canonical), privateKey).toString('base64') } };
    await store.compareAndSet(scope, undefined, { sequence: value.plan.sequence, releaseSha256 }); await store.saveAcceptedRelease({ envelope, releaseSha256 });
    await store.receipts.commit(output.instanceId, 0, output);
    await assert.rejects(store.receipts.commit(output.instanceId, 0, output), { code: 'REVISION_CONFLICT' });
    assert.deepEqual((await store.receipts.read(output.instanceId))?.data, output);
    await store.close(); store = await DistributionStore.open(root);
    assert.equal(await store.canRecover(value.plan.txId, value.leaseToken), true);
    assert.equal(await store.canRecover(value.plan.txId, randomUUID()), false);
    assert.deepEqual((await store.journals.read(value.plan.txId))?.data, { ...value, phase: 'applying' });
  } finally { await store.close(); }
});

test('a second metadata owner and unknown directory contents cannot become ledger authority', windows, async () => {
  const root = await directory(); const store = await DistributionStore.open(root);
  try { await assert.rejects(DistributionStore.open(root), { code: 'STORE_BUSY' }); }
  finally { await store.close(); }
  const unknown = await directory(); await writeFile(path.join(unknown, 'foreign.json'), '{}');
  await assert.rejects(DistributionStore.open(unknown), { code: 'NEEDS_RECOVERY' });
});

test('executor archives must match already-authenticated canonical release high-water state', windows, async () => {
  const store = await DistributionStore.open(await directory());
  try {
    const manifest = journal().plan.manifest;
    const payload = { releaseFormatVersion: 2 as const, sourceId: scope.sourceId, packageId: 'club', packageVersion: 'one', sequence: 1,
      issuedAt: 1000, expiresAt: 2000, manifestSha256: transactionDigest(manifest), manifest };
    const { privateKey } = generateKeyPairSync('ed25519');
    const canonical = canonicalDistributionReleasePayload(payload); const releaseSha256 = createHash('sha256').update(canonical).digest('hex');
    const envelope = { payload, signature: { algorithm: 'ed25519' as const, keyId: 'test-key', value: sign(null, Buffer.from(canonical), privateKey).toString('base64') } };
    await assert.rejects(store.saveAcceptedRelease({ envelope, releaseSha256 }), { code: 'REVISION_CONFLICT' });
    await store.compareAndSet(scope, undefined, { sequence: 1, releaseSha256 });
    await store.saveAcceptedRelease({ envelope, releaseSha256 }); assert.deepEqual(await store.readAcceptedRelease(scope), { envelope, releaseSha256 });
    await store.compareAndSet(scope, { sequence: 1, releaseSha256 }, { sequence: 2, releaseSha256: 'c'.repeat(64) });
    assert.equal(await store.readAcceptedRelease(scope), undefined);
  } finally { await store.close(); }
});

test('SQL schema failures and concurrent close reads remain controlled without leaking native errors', windows, async () => {
  const root = await directory(); const store = await DistributionStore.open(root);
  const external = new DatabaseSync(path.join(root, 'distribution.sqlite'));
  external.exec('DROP TABLE release_states'); external.close();
  await assert.rejects(store.read(scope), { code: 'NEEDS_RECOVERY' }); await store.close();
  const other = await DistributionStore.open(await directory());
  const results = await Promise.allSettled([other.close(), other.read(scope), other.read(scope), other.close()]);
  for (const result of results) if (result.status === 'rejected') assert.ok(['STORAGE_IO', 'NEEDS_RECOVERY'].includes((result.reason as { code: string }).code));
  assert.equal(results[0]?.status, 'fulfilled'); assert.equal(results[3]?.status, 'fulfilled');
});
