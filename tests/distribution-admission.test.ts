import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalDistributionReleasePayload } from '../src/core/distribution/release.js';
import { DistributionStore } from '../src/services/distribution/store.js';
import type { AdmissionIntent } from '../src/services/distribution/admission-record.js';
import { transactionDigest, transactionReceipt } from '../src/services/distribution/transaction-record.js';

const windows = { skip: process.platform !== 'win32' };
async function directory(): Promise<string> {
  const root = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/distribution-admission-tests');
  await mkdir(root, { recursive: true }); return mkdtemp(path.join(root, 'admission-'));
}
function release(sequence = 1) {
  const manifest = { formatVersion: 1 as const, packageId: 'club', packageVersion: `v${sequence}`,
    target: { minecraft: '1.20.1', javaMajor: 17 as const, loader: 'vanilla' as const, loaderVersion: null }, operations: [] };
  const payload = { releaseFormatVersion: 2 as const, sourceId: 'club-source', packageId: 'club', packageVersion: manifest.packageVersion,
    sequence, issuedAt: 1000, expiresAt: 2000, manifestSha256: transactionDigest(manifest), manifest };
  const canonical = canonicalDistributionReleasePayload(payload); const { privateKey } = generateKeyPairSync('ed25519');
  const releaseSha256 = createHash('sha256').update(canonical).digest('hex');
  const envelope = { payload, signature: { algorithm: 'ed25519' as const, keyId: 'fixture-key', value: sign(null, Buffer.from(canonical), privateKey).toString('base64') } };
  return { envelope, releaseSha256 };
}
function intent(accepted = release()): AdmissionIntent {
  const value = accepted.envelope.payload; const proposalId = randomUUID();
  return { confirmRequestId: randomUUID(), proposalId, plan: { formatVersion: 1, txId: proposalId, rootId: randomUUID(), instanceId: randomUUID(), instanceRevision: 1,
    sourceId: value.sourceId, packageId: value.packageId, packageVersion: value.packageVersion, sequence: value.sequence,
    manifestSha256: value.manifestSha256, manifest: value.manifest }, releaseSha256: accepted.releaseSha256,
  gameIdentity: { dev: '1', ino: '2' }, previewFingerprint: 'c'.repeat(64) };
}
async function authorize(store: DistributionStore, accepted: ReturnType<typeof release>): Promise<void> {
  const scope = { sourceId: accepted.envelope.payload.sourceId, packageId: accepted.envelope.payload.packageId };
  assert.equal(await store.compareAndSet(scope, await store.read(scope), { sequence: accepted.envelope.payload.sequence, releaseSha256: accepted.releaseSha256 }), true);
  await store.saveAcceptedRelease(accepted);
}

test('admission keeps one task/outbox across exact retries and confirmation aliases', windows, async () => {
  const root = await directory(); const store = await DistributionStore.open(root); const accepted = release(); const value = intent(accepted);
  try {
    await authorize(store, accepted);
    const first = await store.admissions.admit(value);
    assert.equal(first.phase, 'accepted'); assert.equal(first.revision, 1);
    assert.deepEqual(await store.admissions.admit(structuredClone(value)), first);
    const alias = { ...value, confirmRequestId: randomUUID() };
    assert.deepEqual(await store.admissions.admit(alias), first);
    assert.deepEqual(await store.admissions.readByRequest(alias.confirmRequestId), first);
    assert.deepEqual(await store.admissions.readByProposal(value.proposalId), first);
    assert.deepEqual(await store.admissions.listPending(), [first]);
    await assert.rejects(DistributionStore.open(root), { code: 'STORE_BUSY' });
  } finally { await store.close(); }
});

test('receipt aliases recover an existing task after publisher advancement without a new execution grant', windows, async () => {
  const store = await DistributionStore.open(await directory()); const initial = release(); const value = intent(initial);
  try {
    await authorize(store, initial); const first = await store.admissions.admit(value);
    const newer = release(2); await authorize(store, newer); const alias = randomUUID();
    const bind = () => store.admissions.bindReceiptAlias(value.plan.rootId, alias, value.proposalId, first.inputDigest);
    assert.deepEqual(await bind(), first); assert.deepEqual(await bind(), first);
    assert.deepEqual(await store.admissions.readByRequest(alias), first);
    await assert.rejects(store.admissions.bindReceiptAlias(randomUUID(), randomUUID(), value.proposalId, first.inputDigest), { code: 'REVISION_CONFLICT' });
    await assert.rejects(store.admissions.bindReceiptAlias(value.plan.rootId, randomUUID(), value.proposalId, '0'.repeat(64)), { code: 'REVISION_CONFLICT' });
    const other = intent(newer); const second = await store.admissions.admit(other);
    await assert.rejects(store.admissions.bindReceiptAlias(other.plan.rootId, alias, other.proposalId, second.inputDigest), { code: 'REVISION_CONFLICT' });
    assert.deepEqual(await store.admissions.readByRequest(alias), first);
    assert.equal((await store.admissions.listAll()).length, 2);
    assert.equal(await store.journals.read(value.proposalId), undefined); assert.equal(await store.receipts.read(value.plan.instanceId), undefined);
  } finally { await store.close(); }
});

test('immutable binding rejects same request/proposal with changed snapshot, inode, plan or identity', windows, async () => {
  const store = await DistributionStore.open(await directory()); const accepted = release(); const value = intent(accepted);
  try {
    await authorize(store, accepted); const first = await store.admissions.admit(value);
    for (const changed of [
      { ...value, previewFingerprint: 'd'.repeat(64) },
      { ...value, confirmRequestId: randomUUID(), gameIdentity: { dev: '1', ino: '3' } },
      { ...value, plan: { ...value.plan, instanceRevision: 2 } },
      { ...intent(accepted), confirmRequestId: value.confirmRequestId },
    ]) await assert.rejects(store.admissions.admit(changed), { code: 'REVISION_CONFLICT' });
    await assert.rejects(store.admissions.admit({ ...value, proposalId: randomUUID() }), { code: 'INVALID_RECORD' });
    assert.deepEqual(await store.admissions.listPending(), [first]);
  } finally { await store.close(); }
});

test('new admissions require current archived release but old exact receipts survive high-water advance', windows, async () => {
  const store = await DistributionStore.open(await directory()); const accepted = release(); const value = intent(accepted);
  try {
    await assert.rejects(store.admissions.admit(value), { code: 'REVISION_CONFLICT' });
    await authorize(store, accepted); const first = await store.admissions.admit(value);
    await authorize(store, release(2));
    assert.deepEqual(await store.admissions.admit(value), first);
    assert.deepEqual(await store.admissions.readByRequest(value.confirmRequestId), first);
    await assert.rejects(store.admissions.admit(intent(accepted)), { code: 'REVISION_CONFLICT' });
    await assert.rejects(store.admissions.admit({ ...value, previewFingerprint: 'e'.repeat(64) }), { code: 'REVISION_CONFLICT' });
    assert.deepEqual(await store.admissions.listPending(), [first]);
  } finally { await store.close(); }
});

test('lost acceptance and projection acknowledgements reopen as exact original task, without execution', windows, async () => {
  const root = await directory(); let store = await DistributionStore.open(root); const accepted = release(); const value = intent(accepted);
  try {
    await authorize(store, accepted); const first = await store.admissions.admit(value);
    await store.close(); store = await DistributionStore.open(root);
    assert.deepEqual(await store.admissions.listPending(1), [first]);
    assert.deepEqual(await store.admissions.admit(value), first);
    await assert.rejects(store.admissions.markProjected(first.proposalId, randomUUID()), { code: 'REVISION_CONFLICT' });
    await assert.rejects(store.admissions.markProjected(randomUUID(), first.taskId), { code: 'REVISION_CONFLICT' });
    const projected = await store.admissions.markProjected(first.proposalId, first.taskId);
    assert.equal(projected.phase, 'projected'); assert.equal(projected.revision, 2);
    assert.deepEqual(await store.admissions.markProjected(first.proposalId, first.taskId), projected);
    await store.close(); store = await DistributionStore.open(root);
    assert.deepEqual(await store.admissions.readByRequest(value.confirmRequestId), projected);
    assert.deepEqual(await store.admissions.markProjected(first.proposalId, first.taskId), projected);
    assert.deepEqual(await store.admissions.listPending(), []);
  } finally { await store.close(); }
});

test('schema v1 migrates atomically while preserving legacy release, journal and receipt bytes', windows, async () => {
  const root = await directory(); let store = await DistributionStore.open(root); const accepted = release(); const value = intent(accepted);
  const receipt = transactionReceipt(value.plan, null);
  const journal = { formatVersion: 2 as const, plan: value.plan, planDigest: transactionDigest(value.plan), leaseToken: randomUUID(), gameIdentity: value.gameIdentity,
    phase: 'prepared' as const, beforeReceiptRevision: 0, beforeReceipt: null, afterReceipt: receipt, files: [], pending: null };
  await authorize(store, accepted); await store.journals.write(value.proposalId, 0, journal); await store.close();
  const db = new DatabaseSync(path.join(root, 'distribution.sqlite'));
  db.prepare('INSERT INTO receipts VALUES(?,1,?)').run(receipt.instanceId, JSON.stringify(receipt));
  db.exec('DROP TABLE recovery_requests; DROP TABLE admission_aliases; DROP TABLE admission_outbox; DROP TABLE admissions; PRAGMA user_version=1;');
  const before = ['release_states', 'accepted_releases', 'journals', 'receipts'].map(table => db.prepare(`SELECT * FROM ${table}`).all()); db.close();
  store = await DistributionStore.open(root);
  try {
    assert.deepEqual((await store.journals.read(value.proposalId))?.data, journal);
    assert.deepEqual((await store.receipts.read(receipt.instanceId))?.data, receipt);
    assert.deepEqual(await store.readAcceptedRelease({ sourceId: value.plan.sourceId, packageId: value.plan.packageId }), accepted);
    const check = new DatabaseSync(path.join(root, 'distribution.sqlite'));
    try {
      assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 3);
      assert.deepEqual(['release_states', 'accepted_releases', 'journals', 'receipts'].map(table => check.prepare(`SELECT * FROM ${table}`).all()), before);
    } finally { check.close(); }
    assert.equal((await store.admissions.admit(value)).phase, 'accepted');
  } finally { await store.close(); }
});

test('unknown versions/schema and corrupt admission/outbox records fail closed without repair', windows, async () => {
  for (const corruption of ['version', 'table', 'digest', 'phase', 'orphan']) {
    const root = await directory(); const store = await DistributionStore.open(root); const accepted = release(); const value = intent(accepted);
    await authorize(store, accepted); await store.admissions.admit(value); await store.close();
    const db = new DatabaseSync(path.join(root, 'distribution.sqlite'));
    if (corruption === 'version') db.exec('PRAGMA user_version=9');
    if (corruption === 'table') db.exec('CREATE TABLE unknown(data TEXT)');
    if (corruption === 'digest') db.exec("UPDATE admissions SET input_digest='broken'");
    if (corruption === 'phase') db.exec("UPDATE admission_outbox SET revision=2,phase='accepted'");
    if (corruption === 'orphan') db.exec('DELETE FROM admission_outbox');
    db.close(); await assert.rejects(DistributionStore.open(root), { code: 'NEEDS_RECOVERY' });
    const check = new DatabaseSync(path.join(root, 'distribution.sqlite'));
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM admissions').get()?.n, 1); check.close();
  }
});

test('admission reads reject invalid bounds and stop on live corruption without leaking native SQL', windows, async () => {
  const root = await directory(); const store = await DistributionStore.open(root);
  try {
    for (const limit of [0, 1025, 1.5]) await assert.rejects(store.admissions.listPending(limit), { code: 'INVALID_RECORD' });
    assert.equal(await store.admissions.readByRequest(randomUUID()), undefined);
    assert.equal(await store.admissions.readByProposal(randomUUID()), undefined);
    const db = new DatabaseSync(path.join(root, 'distribution.sqlite')); db.exec('DROP TABLE admission_outbox'); db.close();
    await assert.rejects(store.admissions.listPending(), { code: 'NEEDS_RECOVERY' });
  } finally { await store.close(); }
});

test('identity bounds preserve old receipts and reject new aliases/admissions without eviction', windows, async () => {
  const root = await directory(); const store = await DistributionStore.open(root); const accepted = release(); const value = intent(accepted);
  try {
    await authorize(store, accepted); const first = await store.admissions.admit(value);
    const db = new DatabaseSync(path.join(root, 'distribution.sqlite'));
    const aliases: string[] = [];
    try {
      db.exec('BEGIN IMMEDIATE');
      for (let i = 1; i < 4096; i++) {
        const id = randomUUID(); aliases.push(id);
        db.prepare('INSERT INTO admission_aliases VALUES(?,?)').run(id, first.proposalId);
      }
      db.exec('COMMIT');
      assert.deepEqual(await store.admissions.admit(value), first);
      await assert.rejects(store.admissions.admit({ ...value, confirmRequestId: randomUUID() }), { code: 'REVISION_CONFLICT' });
      db.exec('BEGIN IMMEDIATE');
      for (let i = 0; i < 1023; i++) {
        const proposalId = randomUUID(); const plan = { ...value.plan, txId: proposalId }; const taskId = randomUUID();
        const input = { proposalId, plan, releaseSha256: value.releaseSha256, gameIdentity: value.gameIdentity, previewFingerprint: value.previewFingerprint };
        const data = { formatVersion: 1, ...input, taskId, inputDigest: transactionDigest(input) };
        db.prepare('INSERT INTO admissions VALUES(?,?,?,?)').run(proposalId, taskId, data.inputDigest, JSON.stringify(data));
        db.prepare("INSERT INTO admission_outbox VALUES(?,?,1,'accepted')").run(proposalId, taskId);
        db.prepare('UPDATE admission_aliases SET proposal_id=? WHERE request_id=?').run(proposalId, aliases[i]!);
      }
      db.exec('COMMIT');
      await assert.rejects(store.admissions.admit(intent(accepted)), { code: 'REVISION_CONFLICT' });
      assert.equal((await store.admissions.listPending(1024)).length, 1024);
      assert.deepEqual(await store.admissions.readByRequest(value.confirmRequestId), first);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admissions').get()?.n, 1024);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admission_aliases').get()?.n, 4096);
    } finally { db.close(); }
  } finally { await store.close(); }
});
