import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalDistributionReleasePayload } from '../src/core/distribution/release.js';
import { DistributionStore } from '../src/services/distribution/store.js';
import type { AdmissionIntent, AdmissionRecord } from '../src/services/distribution/admission-record.js';
import { MAX_ADMISSION_TOTAL_BYTES, parseAdmissionRecord } from '../src/services/distribution/admission-record.js';
import { transactionDigest } from '../src/services/distribution/transaction-record.js';

const windows = { skip: process.platform !== 'win32' };
async function fixture() {
  const temporary = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/distribution-admission-query-tests');
  await mkdir(temporary, { recursive: true }); const root = await mkdtemp(path.join(temporary, 'query-'));
  const store = await DistributionStore.open(root);
  const manifest = { formatVersion: 1 as const, packageId: 'club', packageVersion: 'v1',
    target: { minecraft: '1.20.1', javaMajor: 17 as const, loader: 'vanilla' as const, loaderVersion: null }, operations: [] };
  const payload = { releaseFormatVersion: 2 as const, sourceId: 'query-fixture', packageId: 'club', packageVersion: 'v1', sequence: 1,
    issuedAt: 1000, expiresAt: 2000, manifestSha256: transactionDigest(manifest), manifest };
  const canonical = canonicalDistributionReleasePayload(payload); const { privateKey } = generateKeyPairSync('ed25519');
  const releaseSha256 = createHash('sha256').update(canonical).digest('hex');
  const envelope = { payload, signature: { algorithm: 'ed25519' as const, keyId: 'fixture-key', value: sign(null, Buffer.from(canonical), privateKey).toString('base64') } };
  const scope = { sourceId: payload.sourceId, packageId: payload.packageId };
  await store.compareAndSet(scope, undefined, { sequence: 1, releaseSha256 }); await store.saveAcceptedRelease({ envelope, releaseSha256 });
  const intent = (): AdmissionIntent => {
    const proposalId = randomUUID();
    return { confirmRequestId: randomUUID(), proposalId, plan: { formatVersion: 1, txId: proposalId, rootId: randomUUID(), instanceId: randomUUID(), instanceRevision: 1,
      sourceId: payload.sourceId, packageId: payload.packageId, packageVersion: payload.packageVersion, sequence: payload.sequence,
      manifestSha256: payload.manifestSha256, manifest }, releaseSha256, gameIdentity: { dev: '1', ino: '2' }, previewFingerprint: 'a'.repeat(64) };
  };
  return { root, store, intent };
}
function insert(db: DatabaseSync, original: AdmissionRecord): void {
  const proposalId = randomUUID(); const taskId = randomUUID(); const plan = { ...original.plan, txId: proposalId };
  const input = { proposalId, plan, releaseSha256: original.releaseSha256, gameIdentity: original.gameIdentity, previewFingerprint: original.previewFingerprint };
  const data = { formatVersion: 1, ...input, taskId, inputDigest: transactionDigest(input) };
  db.prepare('INSERT INTO admissions VALUES(?,?,?,?)').run(proposalId, taskId, data.inputDigest, JSON.stringify(data));
  db.prepare("INSERT INTO admission_outbox VALUES(?,?,1,'accepted')").run(proposalId, taskId);
  db.prepare('INSERT INTO admission_aliases VALUES(?,?)').run(randomUUID(), proposalId);
}

test('listAll returns accepted and projected admissions completely and detached across restart', windows, async () => {
  const f = await fixture(); let store = f.store;
  try {
    assert.deepEqual(await store.admissions.listAll(), []);
    const first = await store.admissions.admit(f.intent()); const second = await store.admissions.admit(f.intent());
    const projected = await store.admissions.markProjected(second.proposalId, second.taskId);
    const expected = [first, projected].sort((a, b) => a.proposalId < b.proposalId ? -1 : 1);
    const actual = await store.admissions.listAll(); assert.deepEqual(actual, expected);
    actual[0]!.plan.instanceRevision = 500;
    assert.deepEqual(await store.admissions.listAll(), expected);
    assert.deepEqual(await store.admissions.listPending(), [first]);
    await store.close(); store = await DistributionStore.open(f.root);
    assert.deepEqual(await store.admissions.listAll(), expected);
    await assert.rejects(DistributionStore.open(f.root), { code: 'STORE_BUSY' });
  } finally { await store.close(); }
});

test('listAll audit and results share one real SQLite snapshot during a concurrent committed update', windows, async t => {
  const f = await fixture(); const writer = new DatabaseSync(path.join(f.root, 'distribution.sqlite'));
  try {
    const first = await f.store.admissions.admit(f.intent()); const second = await f.store.admissions.admit(f.intent());
    writer.exec('PRAGMA journal_mode=WAL');
    const original = DatabaseSync.prototype.prepare; let updated = false;
    // Synchronize a real independent connection precisely between the audit and final enumeration.
    const mock = t.mock.method(DatabaseSync.prototype, 'prepare', function (this: DatabaseSync, sql: string) {
      if (!updated && sql === 'SELECT proposal_id FROM admissions ORDER BY proposal_id') {
        updated = true;
        writer.exec(`UPDATE admission_outbox SET revision=2,phase='projected' WHERE proposal_id='${second.proposalId}'`);
      }
      return original.call(this, sql);
    });
    const snapshot = await f.store.admissions.listAll(); mock.mock.restore();
    assert.equal(updated, true);
    assert.deepEqual(snapshot.map(row => row.phase), ['accepted', 'accepted']);
    assert.equal(writer.prepare('SELECT phase FROM admission_outbox WHERE proposal_id=?').get(second.proposalId)?.phase, 'projected');
    const current = await f.store.admissions.listAll();
    assert.equal(current.find(row => row.proposalId === second.proposalId)?.phase, 'projected');
    assert.equal(current.find(row => row.proposalId === first.proposalId)?.phase, 'accepted');
  } finally { writer.close(); await f.store.close(); }
});

test('listAll returns exactly 1024 records and rejects 1025 rather than silently truncating', windows, async () => {
  const f = await fixture(); const db = new DatabaseSync(path.join(f.root, 'distribution.sqlite'));
  try {
    const first = await f.store.admissions.admit(f.intent());
    db.exec('BEGIN'); for (let i = 1; i < 1024; i++) insert(db, first); db.exec('COMMIT');
    assert.equal((await f.store.admissions.listAll()).length, 1024);
    insert(db, first);
    await assert.rejects(f.store.admissions.listAll(), { code: 'NEEDS_RECOVERY' });
    await assert.rejects(f.store.admissions.markProjected(first.proposalId, first.taskId), { code: 'NEEDS_RECOVERY' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admissions').get()?.n, 1025);
    assert.equal(db.prepare('SELECT phase FROM admission_outbox WHERE proposal_id=?').get(first.proposalId)?.phase, 'accepted');
  } finally { db.close(); await f.store.close(); }
});

test('listAll rejects corrupt records, orphan identities and unknown schema without returning a partial set', windows, async () => {
  for (const corruption of ['digest', 'outbox', 'alias', 'schema', 'revision']) {
    const f = await fixture(); const db = new DatabaseSync(path.join(f.root, 'distribution.sqlite'));
    try {
      const first = await f.store.admissions.admit(f.intent()); await f.store.admissions.admit(f.intent());
      if (corruption === 'digest') db.prepare("UPDATE admissions SET input_digest='broken' WHERE proposal_id=?").run(first.proposalId);
      if (corruption === 'outbox') db.prepare('DELETE FROM admission_outbox WHERE proposal_id=?').run(first.proposalId);
      if (corruption === 'alias') {
        // Deliberately corrupt the external fixture connection; production foreign keys remain enabled.
        db.exec('PRAGMA foreign_keys=OFF');
        db.prepare('INSERT INTO admission_aliases VALUES(?,?)').run(randomUUID(), randomUUID());
      }
      if (corruption === 'schema') db.exec('CREATE TABLE unknown(data TEXT)');
      if (corruption === 'revision') db.prepare('UPDATE admission_outbox SET revision=9 WHERE proposal_id=?').run(first.proposalId);
      await assert.rejects(f.store.admissions.listAll(), { code: 'NEEDS_RECOVERY' });
      await assert.rejects(f.store.admissions.markProjected(first.proposalId, first.taskId), { code: 'NEEDS_RECOVERY' });
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admissions').get()?.n, 2);
    } finally { db.close(); await f.store.close(); }
  }
});

test('existing confirmation remains a receipt after authority advances, while a new alias needs current authority', windows, async () => {
  const f = await fixture();
  try {
    const value = f.intent(); const first = await f.store.admissions.admit(value);
    const scope = { sourceId: value.plan.sourceId, packageId: value.plan.packageId };
    assert.equal(await f.store.compareAndSet(scope, { sequence: 1, releaseSha256: value.releaseSha256 }, { sequence: 2, releaseSha256: 'b'.repeat(64) }), true);
    assert.deepEqual(await f.store.admissions.admit(value), first);
    assert.deepEqual(await f.store.admissions.readByRequest(value.confirmRequestId), first);
    await assert.rejects(f.store.admissions.admit({ ...value, confirmRequestId: randomUUID() }), { code: 'REVISION_CONFLICT' });
    assert.deepEqual(await f.store.admissions.listAll(), [first]);
  } finally { await f.store.close(); }
});

test('listAll checks the held owner marker and handles concurrent close with controlled errors', windows, async () => {
  const f = await fixture(); const marker = path.join(f.root, 'owner.lock'); const original = await readFile(marker);
  try {
    await writeFile(marker, 'foreign-owner');
    await assert.rejects(f.store.admissions.listAll(), { code: 'NEEDS_RECOVERY' });
  } finally { await writeFile(marker, original); }
  const outcomes = await Promise.allSettled([f.store.admissions.listAll(), f.store.close(), f.store.admissions.listAll()]);
  for (const result of outcomes) if (result.status === 'rejected') {
    assert.ok(typeof result.reason === 'object' && result.reason !== null && 'code' in result.reason);
    assert.ok(['STORAGE_IO', 'NEEDS_RECOVERY'].includes(String(result.reason.code)));
  }
  await f.store.close(); await assert.rejects(f.store.admissions.listAll(), { code: 'STORAGE_IO' });
});

test('strict admission parser rejects unknown fields, changed canonical binding and illegal phase revisions', windows, async () => {
  const f = await fixture();
  try {
    const value = await f.store.admissions.admit(f.intent());
    assert.deepEqual(parseAdmissionRecord(value), value);
    for (const invalid of [
      { ...value, unexpected: true }, { ...value, phase: 'projected' },
      { ...value, revision: 2 }, { ...value, previewFingerprint: 'd'.repeat(64) },
      { ...value, plan: { ...value.plan, instanceRevision: 2 } },
    ]) assert.throws(() => parseAdmissionRecord(invalid), { code: 'INVALID_RECORD' });
    const parsed = parseAdmissionRecord(value); parsed.plan.instanceRevision = 10;
    assert.equal(value.plan.instanceRevision, 1);
    const projected = await f.store.admissions.markProjected(value.proposalId, value.taskId);
    assert.deepEqual(parseAdmissionRecord(projected), projected);
  } finally { await f.store.close(); }
});

test('aggregate byte budget rejects oversized persisted data before parsing and prevents new over-budget writes', windows, async () => {
  const f = await fixture(); const db = new DatabaseSync(path.join(f.root, 'distribution.sqlite'));
  try {
    const first = await f.store.admissions.admit(f.intent());
    db.prepare('UPDATE admissions SET data=zeroblob(?) WHERE proposal_id=?').run(MAX_ADMISSION_TOTAL_BYTES + 1, first.proposalId);
    await assert.rejects(f.store.admissions.listAll(), { code: 'NEEDS_RECOVERY' });
    await assert.rejects(f.store.admissions.admit(f.intent()), { code: 'NEEDS_RECOVERY' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admissions').get()?.n, 1);
    assert.equal(db.prepare('SELECT length(data) AS n FROM admissions').get()?.n, MAX_ADMISSION_TOTAL_BYTES + 1);
    await f.store.close();
    await assert.rejects(DistributionStore.open(f.root), { code: 'NEEDS_RECOVERY' });
    assert.equal(db.prepare('SELECT length(data) AS n FROM admissions').get()?.n, MAX_ADMISSION_TOTAL_BYTES + 1);
  } finally { db.close(); await f.store.close(); }

  const near = await fixture(); const writer = new DatabaseSync(path.join(near.root, 'distribution.sqlite'));
  try {
    for (let i = 0; i < 4; i++) await near.store.admissions.admit(near.intent());
    const rows = writer.prepare('SELECT proposal_id,data FROM admissions').all();
    const paddedBytes = MAX_ADMISSION_TOTAL_BYTES / 4 - 10;
    for (const row of rows) {
      assert.equal(typeof row.data, 'string');
      const text = String(row.data);
      writer.prepare('UPDATE admissions SET data=? WHERE proposal_id=?').run(text + ' '.repeat(paddedBytes - Buffer.byteLength(text)), String(row.proposal_id));
    }
    assert.equal((await near.store.admissions.listAll()).length, 4);
    await assert.rejects(near.store.admissions.admit(near.intent()), { code: 'REVISION_CONFLICT' });
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM admissions').get()?.n, 4);
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM admission_aliases').get()?.n, 4);
    assert.equal(writer.prepare('SELECT COUNT(*) AS n FROM admission_outbox').get()?.n, 4);
  } finally { writer.close(); await near.store.close(); }
});
