import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectLocalModArtifact, readLocalModContext } from '../src/services/distribution/local-mod-evidence.js';
import type { LocalArtifactEvidence, LocalModDomainContext } from '../src/services/distribution/local-mod-domain-types.js';
import { parseDistributionPlan, transactionDigest } from '../src/services/distribution/transaction-record.js';
import { ModArchiveReader } from '../src/services/workers/mod-archive-reader.js';
import { modZip } from './fixtures/mod-zip.js';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const parent = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/local-mod-evidence'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'evidence-')); const game = path.join(root, 'game'); await mkdir(game);
  const source = path.join(root, 'artifact.jar');
  const bytes = modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'fixture_mod', version: '1.0.0', environment: 'client' })]]);
  await writeFile(source, bytes); const identity = await lstat(game, { bigint: true });
  const manifest = { formatVersion: 1, packageId: 'fixture', packageVersion: '1', target: {
    minecraft: '1.20.1', javaMajor: 17, loader: 'fabric', loaderVersion: '0.16.14' },
  operations: [{ kind: 'add', area: 'mods', path: 'fixture.jar', artifactId: 'fixture-artifact', sha256: digest(bytes), size: bytes.length }] };
  const plan = parseDistributionPlan({ formatVersion: 1, txId: randomUUID(), rootId: randomUUID(), instanceId: randomUUID(), instanceRevision: 1,
    sourceId: 'fixture-source', packageId: 'fixture', packageVersion: '1', sequence: 1, manifestSha256: transactionDigest(manifest), manifest });
  const context: LocalModDomainContext = { rootId: plan.rootId, gameIdentity: { dev: String(identity.dev), ino: String(identity.ino) },
    context: { instanceId: plan.instanceId, revision: 1, modsDirectory: path.join(game, 'mods'),
      environment: { loader: 'fabric', versions: { minecraft: '1.20.1', java: '17.0.12', fabricloader: '0.16.14' }, languageVersions: {} } } };
  let permission: LocalArtifactEvidence['permission'] = 'verified'; let bindingIndex = 0; let scans = 0;
  const reader = new ModArchiveReader(entry);
  const ports = { readContext: async () => context,
    resolveLocalArtifact: async (): Promise<LocalArtifactEvidence> => {
      const operation = plan.manifest.operations[0]!; assert.ok(operation.kind === 'add');
      return { path: source, permission, binding: { planDigest: transactionDigest(plan), operationIndex: bindingIndex,
        artifactId: operation.artifactId, sha256: operation.sha256, size: operation.size } };
    }, scanner: { read: async (file: string, signal?: AbortSignal) => { scans++; return reader.read(file, signal); } } };
  return { root, game, source, bytes, plan, context, ports, reader, scans: () => scans,
    permission: (value: LocalArtifactEvidence['permission']) => { permission = value; }, wrongIndex: () => { bindingIndex = 1; } };
}

test('local evidence reads a real synthetic JAR through the worker and binds measured runtime and root inode', async () => {
  const f = await fixture(); const bound = await readLocalModContext(f.plan, f.ports);
  const artifact = await inspectLocalModArtifact(f.plan, 0, f.ports);
  assert.deepEqual(bound, f.context); assert.equal(artifact.scan.sha256, digest(f.bytes));
  assert.equal(artifact.scan.archives[0]!.declarations[0]!.mods[0]!.id, 'fixture_mod');
  assert.equal(artifact.stamp.ino, String((await lstat(f.source, { bigint: true })).ino));
  assert.equal(await readFile(f.source, 'hex'), f.bytes.toString('hex')); assert.equal(f.scans(), 1);
});

test('missing permission and a foreign operation binding refuse local bytes before any scanner starts', async () => {
  const f = await fixture();
  f.permission('unknown'); await assert.rejects(inspectLocalModArtifact(f.plan, 0, f.ports), { code: 'PERMISSION_UNKNOWN' });
  f.permission('denied'); await assert.rejects(inspectLocalModArtifact(f.plan, 0, f.ports), { code: 'PERMISSION_DENIED' });
  f.permission('verified'); f.wrongIndex(); await assert.rejects(inspectLocalModArtifact(f.plan, 0, f.ports), { code: 'ARTIFACT_UNVERIFIED' });
  assert.equal(f.scans(), 0); assert.deepEqual(await readFile(f.source), f.bytes);
});

test('wrong signed content hash, invalid JAR and multiply linked local sources never become verified artifacts', async () => {
  const wrong = await fixture(); const operation = wrong.plan.manifest.operations[0]!; assert.ok(operation.kind === 'add');
  operation.sha256 = '0'.repeat(64); wrong.plan.manifestSha256 = transactionDigest(wrong.plan.manifest);
  await assert.rejects(inspectLocalModArtifact(wrong.plan, 0, wrong.ports), { code: 'ARTIFACT_UNVERIFIED' }); assert.equal(wrong.scans(), 1);
  const invalid = await fixture(); await writeFile(invalid.source, Buffer.alloc(invalid.bytes.length));
  await assert.rejects(inspectLocalModArtifact(invalid.plan, 0, invalid.ports), { code: 'ARTIFACT_UNVERIFIED' });
  const linked = await fixture(); await link(linked.source, path.join(linked.root, 'second-link.jar'));
  await assert.rejects(inspectLocalModArtifact(linked.plan, 0, linked.ports), { code: 'ARTIFACT_UNVERIFIED' }); assert.equal(linked.scans(), 0);
});

test('unknown runtime facts and replacement game directories cannot borrow the old root identity', async () => {
  const f = await fixture(); f.context.context.environment.versions.java = null;
  await assert.rejects(readLocalModContext(f.plan, f.ports), { code: 'MODS_UNDETERMINED' });
  f.context.context.environment.versions.java = '21.0.1';
  await assert.rejects(readLocalModContext(f.plan, f.ports), { code: 'MODS_UNDETERMINED' });
  f.context.context.environment.versions.java = '17.0.12';
  await rename(f.game, path.join(f.root, 'old-game')); await mkdir(f.game);
  await assert.rejects(readLocalModContext(f.plan, f.ports), { code: 'FILES_CHANGED' });
  assert.deepEqual(await readFile(f.source), f.bytes);
});

test('source namespace replacement after a successful worker scan is detected before returning its path', async () => {
  const f = await fixture(); const original = f.ports.scanner.read;
  f.ports.scanner.read = async (file, signal) => {
    const result = await original(file, signal); await rename(file, path.join(f.root, 'retained-original.jar')); await writeFile(file, f.bytes); return result;
  };
  await assert.rejects(inspectLocalModArtifact(f.plan, 0, f.ports), { code: 'FILES_CHANGED' });
  assert.deepEqual(await readFile(path.join(f.root, 'retained-original.jar')), f.bytes); assert.deepEqual(await readFile(f.source), f.bytes);
});

test('a late successful worker result after cancellation cannot return an artifact or leak its path', async () => {
  const f = await fixture(); const controller = new AbortController(); const original = f.ports.scanner.read;
  f.ports.scanner.read = async file => { const result = await original(file); controller.abort(); return result; };
  await assert.rejects(inspectLocalModArtifact(f.plan, 0, f.ports, controller.signal), { code: 'CANCELLED', message: 'CANCELLED' });
  assert.deepEqual(await readFile(f.source), f.bytes);
});
