import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDistributionPayload } from '../../src/core/distribution/manifest.js';
import type { DistributionManifest } from '../../src/core/distribution/manifest.js';
import { canonicalDistributionReleasePayload } from '../../src/core/distribution/release.js';
import { planGameLayout } from '../../src/core/path/layout.js';
import type { DistributionRuntimeConfiguration } from '../../src/main/distribution-runtime.js';
import { DistributionStore } from '../../src/services/distribution/store.js';
import { PinnedReleaseSource } from '../../src/services/distribution/release-source.js';
import type { DistributionPlan } from '../../src/services/distribution/transaction-record.js';
import { ModArchiveReader } from '../../src/services/workers/mod-archive-reader.js';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { modReadyInstance } from '../fixtures/mod-ready-instance.js';
import { modZip } from '../fixtures/mod-zip.js';

export const ROOT_ID = '00000000-0000-4000-8000-000000000001';
export const INSTANCE_ID = '00000000-0000-4000-8000-000000000002';
export const SOURCE_ID = 'fixture-source';
export const PACKAGE_ID = 'fixture-pack';
export const PACKAGE_VERSION = 'one';
export const INSTALLED_FILE = 'fixture-managed.jar';
const OUTBOX_PACKAGE = 'fixture-startup';
const OUTBOX_FILE = 'fixture-unexecuted.jar';
const KEY_ID = 'temporary-fixture-key';
const ORIGIN = 'https://synthetic.invalid';
const PREFIX = '/releases/';
const TARGET = { minecraft: '1.20.1', javaMajor: 17, loader: 'fabric', loaderVersion: '0.16.14' } as const;
const sha256 = (body: string | Buffer): string => createHash('sha256').update(body).digest('hex');

function paths() {
  const base = process.env.OUCL_CONFIGURED_FIXTURE_ROOT;
  assert.ok(base && path.isAbsolute(base) && path.basename(base).startsWith('distribution-configured-'));
  const profile = path.join(base, 'profile');
  const metadata = path.join(profile, 'metadata');
  const data = path.join(base, 'games');
  const worker = path.join(base, 'dist', 'workers', 'entry.cjs');
  const record = modReadyInstance(ROOT_ID, INSTANCE_ID);
  const game = planGameLayout({ dataDirectory: data, rootId: ROOT_ID, instanceId: INSTANCE_ID, mcVersionId: TARGET.minecraft,
    directoryId: INSTANCE_ID, versionRecordId: INSTANCE_ID, jar: { directoryId: INSTANCE_ID, versionRecordId: INSTANCE_ID },
    isolation: { globalDefault: true, instance: 'on', pack: false } }).gameDirectory;
  return { base, data, metadata, record, worker, game, ledger: path.join(profile, 'distribution'),
    artifact: path.join(base, 'synthetic.jar'), release: path.join(base, 'fixture-release.json'), seed: path.join(base, 'seed.json') };
}

function manifestFor(bytes: Buffer, packageId: string, file: string): DistributionManifest {
  return { formatVersion: 1, packageId, packageVersion: PACKAGE_VERSION, target: TARGET,
    operations: [{ kind: 'add', area: 'mods', path: file, artifactId: 'fixture-artifact', sha256: sha256(bytes), size: bytes.length }] };
}

function source(spki: string) {
  return { sourceId: SOURCE_ID, manifestOrigin: ORIGIN, manifestPathPrefix: PREFIX,
    keys: [{ keyId: KEY_ID, spki, revoked: false }] };
}

function releaseUrl(packageId: string): string {
  return ORIGIN + PREFIX + packageId + '/' + PACKAGE_VERSION + '/release-v2.json';
}

interface Seed {
  proposalId: string; confirmRequestId: string; taskId: string;
}
interface Run {
  taskId: string; proposalId: string; confirmRequestId: string;
}

/** Creates an inert install and a genuine outbox admission with its tasks database projection absent. */
export async function seed(): Promise<void> {
  const p = paths();
  const bytes = modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'fixture_mod', version: '1.0.0',
    environment: '*', depends: { minecraft: '1.20.1', java: '>=17', fabricloader: '>=0.16.14' } })],
  ['fixture.bin', 'synthetic-jar-content']]);
  const keys = generateKeyPairSync('ed25519');
  const spki = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  function signed(manifest: DistributionManifest) {
    const now = Date.now();
    const payload = { releaseFormatVersion: 2 as const, sourceId: SOURCE_ID, packageId: manifest.packageId,
      packageVersion: PACKAGE_VERSION, sequence: 1, issuedAt: now - 1000, expiresAt: now + 3600000,
      manifestSha256: sha256(canonicalDistributionPayload(manifest)), manifest };
    const signature = { algorithm: 'ed25519' as const, keyId: KEY_ID,
      value: sign(null, Buffer.from(canonicalDistributionReleasePayload(payload)), keys.privateKey).toString('base64') };
    return { payload, signature };
  }
  await mkdir(path.join(p.game, 'mods'), { recursive: true });
  await mkdir(p.ledger, { recursive: true });
  await mkdir(p.metadata);
  await writeFile(p.artifact, bytes, { flag: 'wx' });
  await writeFile(p.release, JSON.stringify({ spki, envelope: signed(manifestFor(bytes, PACKAGE_ID, INSTALLED_FILE)) }), { flag: 'wx' });

  const storage = await StorageClient.open(p.worker, p.metadata);
  try {
    await storage.createInstallation({ rootId: ROOT_ID, dataDirectory: p.data });
    const installation = await storage.accept(ROOT_ID, randomUUID(), 'install', sha256('synthetic instance installation task'));
    await storage.update(ROOT_ID, installation.taskId, installation.execution.revision, {
      ...installation.execution, state: 'completed', revision: installation.execution.revision + 1,
    });
    const record = { ...p.record, summary: { ...p.record.summary, taskId: installation.taskId } };
    await storage.writeInstance(INSTANCE_ID, 0, record);
    await storage.writeInstances(0, { items: [record.summary] });
    assert.deepEqual(await storage.readDistributionTaskProjections(ROOT_ID), []);
  } finally { await storage.close(); }

  const ledger = await DistributionStore.open(p.ledger);
  try {
    const manifest = manifestFor(bytes, OUTBOX_PACKAGE, OUTBOX_FILE);
    const envelope = signed(manifest);
    const pinned = new PinnedReleaseSource(source(spki), ledger, { fetcher: async url => {
      assert.equal(String(url), releaseUrl(OUTBOX_PACKAGE));
      return new Response(JSON.stringify(envelope));
    } });
    const accepted = await pinned.resolve({ packageId: OUTBOX_PACKAGE, packageVersion: PACKAGE_VERSION, target: TARGET });
    await ledger.saveAcceptedRelease(accepted);
    const proposalId = randomUUID();
    const confirmRequestId = randomUUID();
    const plan: DistributionPlan = { formatVersion: 1, txId: proposalId, rootId: ROOT_ID, instanceId: INSTANCE_ID, instanceRevision: 1,
      sourceId: SOURCE_ID, packageId: OUTBOX_PACKAGE, packageVersion: PACKAGE_VERSION, sequence: 1,
      manifestSha256: envelope.payload.manifestSha256, manifest };
    const stat = await lstat(p.game, { bigint: true });
    const intent = await ledger.admissions.admit({ confirmRequestId, proposalId, plan, releaseSha256: accepted.releaseSha256,
      gameIdentity: { dev: String(stat.dev), ino: String(stat.ino) }, previewFingerprint: sha256('synthetic outbox fixture') });
    assert.equal(intent.phase, 'accepted');
    assert.equal(await ledger.journals.read(proposalId), undefined);
    await writeFile(p.seed, JSON.stringify({ confirmRequestId, proposalId, taskId: intent.taskId } satisfies Seed), { flag: 'wx' });
  } finally { await ledger.close(); }
}

export function readSeed(): Seed {
  return JSON.parse(readFileSync(paths().seed, 'utf8')) as Seed;
}

/** Bundled only into the isolated build. All publisher and artifact policy inputs are synthetic. */
export function createConfiguredFixture(): DistributionRuntimeConfiguration {
  const p = paths();
  const signed = JSON.parse(readFileSync(p.release, 'utf8')) as { spki: string; envelope: unknown };
  const bytes = readFileSync(p.artifact);
  const manifest = manifestFor(bytes, PACKAGE_ID, INSTALLED_FILE);
  const scanner = new ModArchiveReader(p.worker);
  let fetchCount = 0;
  const validatePlan = (plan: DistributionPlan): void => {
    assert.equal(plan.rootId, ROOT_ID);
    assert.equal(plan.instanceId, INSTANCE_ID);
    assert.equal(plan.instanceRevision, 1);
    assert.equal(plan.sourceId, SOURCE_ID);
    assert.equal(plan.packageId, PACKAGE_ID);
    assert.equal(plan.packageVersion, PACKAGE_VERSION);
    assert.equal(plan.sequence, 1);
    assert.equal(plan.manifestSha256, sha256(canonicalDistributionPayload(manifest)));
    assert.equal(canonicalDistributionPayload(plan.manifest), canonicalDistributionPayload(manifest));
  };
  return {
    sources: [source(signed.spki)],
    fetcher: async (url, init) => {
      assert.equal(String(url), releaseUrl(PACKAGE_ID));
      assert.equal(init?.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.credentials, 'omit');
      assert.equal(++fetchCount, 1);
      return new Response(JSON.stringify(signed.envelope));
    },
    readTarget: async instanceId => {
      assert.equal(instanceId, INSTANCE_ID);
      return { rootId: ROOT_ID, instanceId, revision: 1, gameDir: p.game, environment: TARGET };
    },
    isIdle: async target => {
      assert.equal(target.gameDir, p.game);
      return true; // Fixture does not launch an external game process.
    },
    validate: async (plan, signal) => {
      validatePlan(plan);
      const result = await scanner.read(p.artifact, signal);
      assert.equal(result.sha256, sha256(bytes));
      assert.equal(result.size, bytes.length);
      assert.equal(result.archives.length, 1);
      assert.ok(result.archives[0]?.documents.some(item => item.name === 'fabric.mod.json'));
    },
    artifact: async (plan, index, signal) => {
      signal?.throwIfAborted();
      validatePlan(plan); assert.equal(index, 0);
      return p.artifact;
    },
  };
}

/** Independently reopens the task projection and authoritative ledger after Electron exits. */
export async function inspect(run: Run) {
  const p = paths();
  const startup = readSeed();
  const storage = await StorageClient.open(p.worker, p.metadata);
  const ledger = await DistributionStore.open(p.ledger).catch(async error => { await storage.close(); throw error; });
  try {
    const projections = await storage.readDistributionTaskProjections(ROOT_ID);
    assert.equal(projections.length, 2);
    const completed = projections.find(row => row.proposalId === run.proposalId);
    assert.equal(completed?.task.taskId, run.taskId);
    assert.equal(completed?.task.execution.state, 'completed');
    const queued = projections.find(row => row.proposalId === startup.proposalId);
    assert.equal(queued?.task.taskId, startup.taskId);
    assert.equal(queued?.task.execution.state, 'queued');
    const startupAdmission = await ledger.admissions.readByRequest(startup.confirmRequestId);
    assert.equal(startupAdmission?.phase, 'projected');
    assert.equal(startupAdmission?.inputDigest, queued?.payloadDigest);
    assert.equal(await ledger.journals.read(startup.proposalId), undefined);
    const admission = await ledger.admissions.readByRequest(run.confirmRequestId);
    assert.equal(admission?.phase, 'projected');
    assert.equal(admission?.taskId, run.taskId);
    assert.equal(admission?.inputDigest, completed?.payloadDigest);
    const accepted = await ledger.readAcceptedRelease({ sourceId: SOURCE_ID, packageId: PACKAGE_ID });
    assert.equal(accepted?.releaseSha256, admission?.releaseSha256);
    assert.equal(accepted?.envelope.signature.keyId, KEY_ID);
    const journal = await ledger.journals.read(run.proposalId);
    assert.equal(journal?.data.phase, 'committed');
    assert.deepEqual(journal.data.files.map(file => file.stage), ['published']);
    const receipt = await ledger.receipts.read(INSTANCE_ID);
    assert.equal(receipt?.data.txId, run.proposalId);
    assert.deepEqual(receipt.data, journal.data.afterReceipt);
    const installedSha256 = sha256(await readFile(path.join(p.game, 'mods', INSTALLED_FILE)));
    assert.equal(installedSha256, sha256(await readFile(p.artifact)));
    assert.deepEqual(receipt.data.entries.map(entry => [entry.path, entry.sha256]), [[INSTALLED_FILE, installedSha256]]);
    await assert.rejects(readFile(path.join(p.game, 'mods', OUTBOX_FILE)), { code: 'ENOENT' });
    return { startup, startupState: queued.task.execution.state, projectedTasks: projections.length,
      taskState: completed.task.execution.state, admissionState: admission.phase, journalState: journal.data.phase,
      receiptRevision: receipt.revision, installedFile: INSTALLED_FILE, installedSha256 };
  } finally {
    try { await ledger.close(); }
    finally { await storage.close(); }
  }
}
