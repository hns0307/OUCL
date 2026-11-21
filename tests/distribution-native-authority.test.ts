import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { canonicalDistributionPayload } from '../src/core/distribution/manifest.js';
import type { DistributionManifest } from '../src/core/distribution/manifest.js';
import { canonicalDistributionReleasePayload, checkDistributionReleaseTime } from '../src/core/distribution/release.js';
import { loadWindowsDistributionFiles } from '../src/services/distribution/native-files.js';
import { PinnedReleaseSource } from '../src/services/distribution/release-source.js';
import { DistributionStore } from '../src/services/distribution/store.js';
import { DistributionTransactionService } from '../src/services/distribution/transaction.js';
import type { DistributionTransactionCheckpoint, DistributionTransactionPorts } from '../src/services/distribution/transaction.js';
import { SimulatedDistributionCrash, transactionDigest } from '../src/services/distribution/transaction-record.js';
import type { DistributionPlan } from '../src/services/distribution/transaction-record.js';
import { hasCode } from '../src/services/storage/files.js';

const WINDOWS = { skip: process.platform !== 'win32' || process.arch !== 'x64' };
const NOW = 1794873600000;
const CONTENT = 'synthetic-native-authority-content';
const SOURCE_ROOT = process.env.OUCL_SOURCE_ROOT ?? process.cwd();
const TEST_ROOT = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/native-authority-20261117', 'native-authority');
const EVIDENCE_ROOT = path.resolve(process.env.OUCL_AUTHORITY_EVIDENCE ?? path.join(TEST_ROOT, 'evidence'));
const execute = promisify(execFile);
const digest = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
let built: Promise<{ nativeDirectory: string; metadata: unknown }> | undefined;

function helper() {
  built ??= (async () => {
    const output = path.join(TEST_ROOT, 'build'); await mkdir(output, { recursive: true });
    await execute(process.execPath, [path.join(SOURCE_ROOT, 'scripts/build-distribution-files.mjs')], {
      cwd: SOURCE_ROOT, env: { ...process.env, OUCL_BUILD_ROOT: output }, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
    });
    const nativeDirectory = path.join(output, 'native');
    return { nativeDirectory, metadata: JSON.parse(await readFile(path.join(nativeDirectory, 'distribution-files.json'), 'utf8')) as unknown };
  })(); return built;
}
async function identity(directory: string) {
  const info = await lstat(directory, { bigint: true }); return { dev: String(info.dev), ino: String(info.ino) };
}
async function fileFact(file: string) {
  try {
    const info = await lstat(file, { bigint: true });
    return { dev: String(info.dev), ino: String(info.ino), links: String(info.nlink), bytes: Number(info.size), sha256: digest(await readFile(file)) };
  } catch (error) { if (hasCode(error, 'ENOENT')) return null; throw error; }
}
async function absent(file: string): Promise<void> { await assert.rejects(readFile(file), { code: 'ENOENT' }); }

async function fixture(interruption: DistributionTransactionCheckpoint) {
  const binary = await helper(); const nativeFactory = await loadWindowsDistributionFiles(binary.nativeDirectory);
  const base = await mkdtemp(path.join(TEST_ROOT, 'case-')); const gameDir = path.join(base, 'game'); const metadata = path.join(base, 'metadata');
  await mkdir(gameDir); await mkdir(metadata); await mkdir(path.join(gameDir, 'mods'));
  const playerFile = path.join(gameDir, 'mods', 'player.jar'); await writeFile(playerFile, 'player-owned-content');
  const artifact = path.join(base, 'artifact'); await writeFile(artifact, CONTENT);
  const rootId = randomUUID(); const instanceId = randomUUID(); const txId = randomUUID();
  const scope = { sourceId: 'authority-fixture-source', packageId: 'authority-fixture-pack' };
  const manifest: DistributionManifest = { formatVersion: 1, packageId: scope.packageId, packageVersion: '1',
    target: { minecraft: '1.20.1', javaMajor: 17, loader: 'vanilla', loaderVersion: null },
    operations: [{ kind: 'add', area: 'mods', path: 'authority.jar', artifactId: 'synthetic-artifact', sha256: digest(CONTENT), size: Buffer.byteLength(CONTENT) }] };
  const pair = generateKeyPairSync('ed25519'); const keyId = 'temporary-fixture-key';
  const record = { ...scope, manifestOrigin: 'https://authority-fixture.example', manifestPathPrefix: '/releases/',
    keys: [{ keyId, spki: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false }] };
  const payload = { releaseFormatVersion: 2 as const, ...scope, packageVersion: '1', sequence: 1, issuedAt: NOW - 1000, expiresAt: NOW + 60000,
    manifestSha256: digest(canonicalDistributionPayload(manifest)), manifest };
  const envelope = { payload, signature: { algorithm: 'ed25519' as const, keyId,
    value: sign(null, Buffer.from(canonicalDistributionReleasePayload(payload)), pair.privateKey).toString('base64') } };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify(envelope));
  let store = await DistributionStore.open(metadata);
  const accepted = await new PinnedReleaseSource(record, store, { fetcher, now: () => NOW }).resolve({ packageId: scope.packageId, packageVersion: '1', target: manifest.target });
  await store.saveAcceptedRelease(accepted);
  const plan: DistributionPlan = { formatVersion: 1, txId, rootId, instanceId, instanceRevision: 1, ...scope, packageVersion: '1',
    sequence: 1, manifestSha256: payload.manifestSha256, manifest };
  const factoryBindings: Array<{ gameDir: string; txId: string; expectedRoot: { dev: string; ino: string } | null }> = [];
  function service() {
    const owner = store;
    const ports: DistributionTransactionPorts = {
      journals: owner.journals, receipts: owner.receipts,
      authorize: async candidate => {
        assert.equal(transactionDigest(candidate), transactionDigest(plan));
        const archive = await owner.readAcceptedRelease(scope); assert.ok(archive);
        assert.equal(archive.envelope.payload.manifestSha256, candidate.manifestSha256);
        assert.equal(archive.envelope.payload.sequence, candidate.sequence);
        assert.ok(verify(null, Buffer.from(canonicalDistributionReleasePayload(archive.envelope.payload)), createPublicKey(record.keys[0]!.spki), Buffer.from(archive.envelope.signature.value, 'base64')));
        checkDistributionReleaseTime(archive.envelope.payload, NOW);
      },
      readTarget: async id => { assert.equal(id, instanceId); return { rootId, instanceId, revision: 1, gameDir }; },
      isIdle: async () => true, artifact: async () => artifact,
      canRecover: (id, token) => owner.canRecover(id, token),
      createFiles: (game, id, expectedRoot) => { factoryBindings.push({ gameDir: game, txId: id, expectedRoot: expectedRoot ? { ...expectedRoot } : null }); return nativeFactory(game, id, expectedRoot); },
      checkpoint: async point => { if (point === interruption) throw new SimulatedDistributionCrash(); },
    };
    return new DistributionTransactionService(ports);
  }
  const target = path.join(gameDir, 'mods', 'authority.jar'); const lock = path.join(gameDir, 'oucl.session.lock');
  async function state() {
    return { journal: await store.journals.read(txId), receipt: await store.receipts.read(instanceId) ?? null, highWater: await store.read(scope),
      rootIdentity: await identity(gameDir), target: await fileFact(target), player: await fileFact(playerFile), lease: await readFile(lock, 'utf8') };
  }
  async function reopen(): Promise<void> { await store.close(); await absent(path.join(metadata, 'owner.lock')); store = await DistributionStore.open(metadata); }
  async function evidence(name: string, facts: unknown): Promise<void> {
    await mkdir(EVIDENCE_ROOT, { recursive: true });
    await writeFile(path.join(EVIDENCE_ROOT, `${name}-${txId}.json`), JSON.stringify({ synthetic: true, actualSQLite: true, actualOwnerGuard: true,
      actualNativeFactory: true, binary: binary.metadata, base, txId, instanceId, factoryBindings, facts }, null, 2));
  }
  return { base, gameDir, metadata, playerFile, target, lock, txId, instanceId, plan, scope, accepted, service, state, reopen, evidence,
    store: () => store, factoryBindings, close: () => store.close() };
}

for (const interruption of ['published', 'receipt-committed'] as const) test(`real SQLite owner restart and native ${interruption} recovery preserve the authoritative commit boundary`, WINDOWS, async () => {
  const f = await fixture(interruption);
  try {
    await assert.rejects(f.service().commit(f.plan), SimulatedDistributionCrash);
    const before = await f.state(); assert.ok(before.journal); assert.equal(before.journal.data.formatVersion, 2);
    assert.deepEqual(before.journal.data.gameIdentity, before.rootIdentity); assert.equal(before.lease, before.journal.data.leaseToken);
    assert.equal(before.target?.sha256, digest(CONTENT)); assert.equal(before.target.links, '2');
    assert.equal(before.receipt !== null, interruption === 'receipt-committed');
    assert.equal(await f.store().canRecover(f.txId, before.lease), false);
    await assert.rejects(DistributionStore.open(f.metadata), { code: 'STORE_BUSY' });
    await assert.rejects(f.service().recover(f.txId), { code: 'NEEDS_RECOVERY' });
    assert.deepEqual(await f.state(), before, 'rejected live-owner recovery must not touch journal, receipt, files or lease');
    await f.reopen(); const afterReopen = await f.state(); assert.deepEqual(afterReopen, before);
    assert.equal(await f.store().canRecover(f.txId, before.lease), true);
    assert.equal(await f.store().canRecover(f.txId, randomUUID()), false);
    const result = await f.service().recover(f.txId); assert.equal(result.phase, interruption === 'published' ? 'rolledBack' : 'committed');
    const terminal = await f.store().journals.read(f.txId); assert.ok(terminal); assert.deepEqual(terminal.data.gameIdentity, before.rootIdentity);
    await absent(f.lock); assert.deepEqual(await fileFact(f.playerFile), before.player); assert.deepEqual(await f.store().read(f.scope), before.highWater);
    const receipt = await f.store().receipts.read(f.instanceId);
    if (interruption === 'published') {
      await absent(f.target); assert.equal(receipt, undefined);
      const retained = path.join(f.gameDir, '.oucl-distribution-staging', f.txId, '0.rollback');
      assert.equal(await readFile(retained, 'utf8'), CONTENT); assert.equal((await fileFact(retained))?.ino, before.target.ino);
    } else {
      assert.ok(receipt); assert.equal(receipt.revision, 1); assert.deepEqual(receipt.data, terminal.data.afterReceipt);
      assert.equal(await readFile(f.target, 'utf8'), CONTENT); assert.equal((await fileFact(f.target))?.ino, before.target.ino);
      assert.equal((await fileFact(f.target))?.links, '1'); await absent(path.join(f.gameDir, '.oucl-distribution-staging', f.txId, '0.new'));
    }
    assert.equal((await f.service().recover(f.txId)).phase, terminal.data.phase);
    assert.deepEqual(await f.store().journals.read(f.txId), terminal); assert.deepEqual(await f.store().receipts.read(f.instanceId), receipt);
    assert.ok(f.factoryBindings.some(binding => binding.expectedRoot?.ino === before.rootIdentity.ino));
    await f.evidence(interruption, { before, afterReopen, terminal, receipt: receipt ?? null, player: await fileFact(f.playerFile), target: await fileFact(f.target), leaseReleased: true });
  } finally { await f.close(); }
});

test('real reopened owner rejects recovery into a replacement game namespace without touching either directory or authority', WINDOWS, async () => {
  const f = await fixture('published');
  try {
    await assert.rejects(f.service().commit(f.plan), SimulatedDistributionCrash); const before = await f.state(); assert.ok(before.journal);
    await f.store().close(); const original = path.join(f.base, 'retained-original-game'); await rename(f.gameDir, original);
    await mkdir(path.join(f.gameDir, 'mods'), { recursive: true }); await writeFile(f.playerFile, 'new-namespace-player'); const foreignToken = randomUUID(); await writeFile(f.lock, foreignToken);
    await f.reopen(); assert.equal(await f.store().canRecover(f.txId, before.lease), true);
    const replacementBefore = await f.state(); await assert.rejects(f.service().recover(f.txId), { code: 'FILES_CHANGED' });
    assert.deepEqual(await f.state(), replacementBefore); assert.deepEqual(await f.store().journals.read(f.txId), before.journal);
    assert.equal(await readFile(path.join(original, 'mods', 'authority.jar'), 'utf8'), CONTENT);
    assert.equal(await readFile(path.join(original, 'oucl.session.lock'), 'utf8'), before.lease);
    assert.equal(await readFile(f.lock, 'utf8'), foreignToken); await absent(f.target);
    await f.evidence('replacement-root', { before, original, replacementBefore, replacementAfter: await f.state() });
  } finally { await f.close(); }
});

test('real reopened owner preserves a foreign game lease and all persisted evidence when recovery is busy', WINDOWS, async () => {
  const f = await fixture('published');
  try {
    await assert.rejects(f.service().commit(f.plan), SimulatedDistributionCrash); const before = await f.state(); assert.ok(before.journal);
    await f.store().close(); const foreignToken = randomUUID(); await writeFile(f.lock, foreignToken); await f.reopen();
    assert.equal(await f.store().canRecover(f.txId, before.lease), true);
    const busy = await f.state(); await assert.rejects(f.service().recover(f.txId), { code: 'INSTANCE_BUSY' });
    assert.deepEqual(await f.state(), busy); assert.deepEqual(await f.store().journals.read(f.txId), before.journal);
    assert.equal(await readFile(f.lock, 'utf8'), foreignToken); assert.equal(await readFile(f.target, 'utf8'), CONTENT);
    await f.evidence('foreign-lease', { before, busyBefore: busy, busyAfter: await f.state() });
  } finally { await f.close(); }
});
