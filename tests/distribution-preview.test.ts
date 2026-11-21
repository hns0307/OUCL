import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDistributionPayload } from '../src/core/distribution/manifest.js';
import type { DistributionManifest } from '../src/core/distribution/manifest.js';
import { parsePackageReceipt, projectDistributionOwnership } from '../src/core/distribution/ownership.js';
import { EMPTY_DISTRIBUTION_SOURCES, MAX_DISTRIBUTION_ENVELOPE_BYTES, PinnedDistributionSource } from '../src/services/distribution/source.js';
import { DistributionPreviewService, observeDistributionFiles, readPackageReceipt } from '../src/services/distribution/preview.js';
import type { DistributionTarget } from '../src/services/distribution/preview.js';

const instanceId = randomUUID(); const managedId = randomUUID();
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const manifest = (): DistributionManifest => ({ formatVersion: 1, packageId: 'club', packageVersion: '1',
  target: { minecraft: '1.20.1', javaMajor: 17, loader: 'fabric', loaderVersion: '0.16.14' },
  operations: [{ kind: 'replace', area: 'mods', path: 'owned.jar', managedId, expectedSha256: digest('old'), artifactId: 'new', sha256: digest('new'), size: 3 }] });
function signed(payload = manifest()) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const record = { sourceId: 'club-source', manifestOrigin: 'https://publisher.example', manifestPathPrefix: '/manifests/',
    keys: [{ keyId: 'publisher-1', spki: publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false }] };
  const envelope = { payload, signature: { algorithm: 'ed25519', keyId: 'publisher-1', value: sign(null, Buffer.from(canonicalDistributionPayload(payload)), privateKey).toString('base64') } };
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    return new Response(JSON.stringify(envelope), { headers: { 'content-type': 'application/json' } });
  };
  return { record, envelope, fetcher };
}
async function folder(): Promise<string> {
  const root = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/distribution-preview-tests'); await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, 'distribution-'));
}
function receipt(entries: unknown[]) { return { formatVersion: 1, instanceId, entries }; }
function claim() { return { sourceId: 'club-source', packageId: 'club', packageVersion: '0', managedId, area: 'mods', path: 'owned.jar', sha256: digest('old') }; }

test('production pinned source verifies real Ed25519 and exact package/version; default trust is empty', async () => {
  const fixture = signed(); assert.deepEqual(EMPTY_DISTRIBUTION_SOURCES, []);
  const source = new PinnedDistributionSource(fixture.record, fixture.fetcher);
  assert.deepEqual((await source.resolve({ packageId: 'club', packageVersion: '1' })).payload, manifest());
  for (const request of [{ packageId: 'other', packageVersion: '1' }, { packageId: 'club', packageVersion: '2' }]) {
    await assert.rejects(source.resolve(request), { code: 'UNTRUSTED_DISTRIBUTION' });
  }
  await assert.rejects(source.resolve({ packageId: 'club', packageVersion: '1' }, AbortSignal.abort()), { code: 'CANCELLED' });
});

test('pinned source rejects tampering, wrong key, revoked key, future fields and oversized envelopes', async () => {
  const fixture = signed(); const request = { packageId: 'club', packageVersion: '1' };
  const changed = structuredClone(fixture.envelope); changed.payload.target.javaMajor = 21;
  await assert.rejects(new PinnedDistributionSource(fixture.record, async () => new Response(JSON.stringify(changed))).resolve(request), { code: 'UNTRUSTED_DISTRIBUTION' });
  for (const keys of [[{ ...fixture.record.keys[0]!, revoked: true }], signed().record.keys]) {
    await assert.rejects(new PinnedDistributionSource({ ...fixture.record, keys }, fixture.fetcher).resolve(request), { code: 'UNTRUSTED_DISTRIBUTION' });
  }
  for (const response of [new Response(JSON.stringify({ ...fixture.envelope, extra: true })),
    new Response(' ', { headers: { 'content-length': String(MAX_DISTRIBUTION_ENVELOPE_BYTES + 1) } }),
    new Response(' '.repeat(MAX_DISTRIBUTION_ENVELOPE_BYTES + 1)), new Response('', { status: 302, headers: { location: 'https://other.example' } })]) {
    await assert.rejects(new PinnedDistributionSource(fixture.record, async () => response).resolve(request), { code: 'UNTRUSTED_DISTRIBUTION' });
  }
});

test('pinned source accepts only fixed HTTPS public origins and unique Ed25519 public keys', () => {
  const fixture = signed();
  for (const manifestOrigin of ['http://publisher.example', 'https://127.0.0.1', 'https://localhost', 'https://site.local', 'https://publisher.example:8443', 'https://user:pass@publisher.example', 'https://publisher.example/path']) {
    assert.throws(() => new PinnedDistributionSource({ ...fixture.record, manifestOrigin }, fixture.fetcher), { code: 'UNTRUSTED_DISTRIBUTION' });
  }
  for (const manifestPathPrefix of ['/../', '/manifests', '/a%2Fb/', '//evil/']) {
    assert.throws(() => new PinnedDistributionSource({ ...fixture.record, manifestPathPrefix }, fixture.fetcher), { code: 'UNTRUSTED_DISTRIBUTION' });
  }
  assert.throws(() => new PinnedDistributionSource({ ...fixture.record, keys: [...fixture.record.keys, ...fixture.record.keys] }, fixture.fetcher), { code: 'UNTRUSTED_DISTRIBUTION' });
});

test('receipt parser is exact, bound to instance, versioned and rejects escape without adopting files', () => {
  const valid = parsePackageReceipt(receipt([claim()]), instanceId);
  assert.equal(valid.entries[0]?.managedId, managedId);
  for (const value of [{ ...receipt([]), formatVersion: 2 }, { ...receipt([]), instanceId: randomUUID() },
    receipt([{ ...claim(), path: '../escape' }]), receipt([{ ...claim(), extra: true }]), receipt([claim(), claim()])]) {
    assert.throws(() => parsePackageReceipt(value, instanceId), { code: 'INVALID_MANIFEST' });
  }
  const file = { area: 'mods' as const, path: 'owned.jar', sha256: digest('old'), managedId: null };
  assert.equal(projectDistributionOwnership([file], undefined, { sourceId: 'club-source', packageId: 'club' })[0]?.ownership, 'local-discovered');
  assert.equal(projectDistributionOwnership([file], undefined, { sourceId: 'club-source', packageId: 'club' }, [file])[0]?.ownership, 'user-added');
});

test('ownership detects user overrides and multiple package claims rather than inferring shared ownership', () => {
  const owner = { sourceId: 'club-source', packageId: 'club' };
  const file = { area: 'mods' as const, path: 'owned.jar', sha256: digest('old'), managedId: null };
  assert.equal(projectDistributionOwnership([file], parsePackageReceipt(receipt([claim()]), instanceId), owner)[0]?.ownership, 'package-managed');
  assert.equal(projectDistributionOwnership([{ ...file, sha256: digest('user') }], parsePackageReceipt(receipt([claim()]), instanceId), owner)[0]?.ownership, 'user-overridden');
  const multiple = parsePackageReceipt(receipt([claim(), { ...claim(), packageId: 'other', managedId: randomUUID() }]), instanceId);
  assert.equal(projectDistributionOwnership([file], multiple, owner)[0]?.ownership, 'ownership-conflict');
});

test('real file preview preserves bytes, exposes no absolute path, and allows exact owned proposal only', async () => {
  const gameDir = await folder(); await mkdir(path.join(gameDir, 'mods')); await writeFile(path.join(gameDir, 'mods', 'owned.jar'), 'old');
  await writeFile(path.join(gameDir, '.oucl-distribution-receipts.json'), JSON.stringify(receipt([claim()])));
  const fixture = signed(); const target: DistributionTarget = { instanceId, revision: 1, gameDir, environment: manifest().target };
  const service = new DistributionPreviewService({ sources: [fixture.record], fetcher: fixture.fetcher, readTarget: async () => target });
  const preview = await service.preview({ sourceId: 'club-source', packageId: 'club', packageVersion: '1', instanceId });
  assert.equal(preview.diff.changes.length, 1); assert.equal(preview.ownership[0]?.ownership, 'package-managed');
  assert.equal(preview.readOnly, true); assert.equal(JSON.stringify(preview).includes(gameDir), false);
  assert.equal(await readFile(path.join(gameDir, 'mods', 'owned.jar'), 'utf8'), 'old');
  await writeFile(path.join(gameDir, 'mods', 'owned.jar'), 'user');
  const changed = await service.preview({ sourceId: 'club-source', packageId: 'club', packageVersion: '1', instanceId });
  assert.deepEqual(changed.diff.changes, []); assert.equal(changed.ownership[0]?.ownership, 'user-overridden');
});

test('preview rejects no source, wrong environment, changed target and corrupt receipt', async () => {
  const gameDir = await folder(); const fixture = signed();
  const request = { sourceId: 'club-source', packageId: 'club', packageVersion: '1', instanceId };
  const target: DistributionTarget = { instanceId, revision: 1, gameDir, environment: manifest().target };
  await assert.rejects(new DistributionPreviewService({ sources: [], readTarget: async () => target }).preview(request), { code: 'SOURCE_UNAVAILABLE' });
  await assert.rejects(new DistributionPreviewService({ sources: [fixture.record], fetcher: fixture.fetcher,
    readTarget: async () => ({ ...target, environment: { ...target.environment, javaMajor: 21 } }) }).preview(request), { code: 'TARGET_MISMATCH' });
  let reads = 0;
  await assert.rejects(new DistributionPreviewService({ sources: [fixture.record], fetcher: fixture.fetcher,
    readTarget: async () => ({ ...target, revision: ++reads }) }).preview(request), { code: 'FILES_CHANGED' });
  await writeFile(path.join(gameDir, '.oucl-distribution-receipts.json'), '{broken');
  await assert.rejects(new DistributionPreviewService({ sources: [fixture.record], fetcher: fixture.fetcher, readTarget: async () => target }).preview(request), { code: 'UNSAFE_FILES' });
});

test('real observation discovers only allowed areas, hashes nested files and missing receipt remains missing', async () => {
  const gameDir = await folder(); await mkdir(path.join(gameDir, 'config', 'nested'), { recursive: true });
  await mkdir(path.join(gameDir, 'saves')); await writeFile(path.join(gameDir, 'saves', 'private'), 'secret');
  await writeFile(path.join(gameDir, 'config', 'nested', 'settings.json'), '{}');
  assert.deepEqual(await observeDistributionFiles(gameDir), [{ area: 'config', path: 'nested/settings.json', sha256: digest('{}'), managedId: null }]);
  assert.equal(await readPackageReceipt(gameDir, instanceId), undefined);
  await assert.rejects(observeDistributionFiles(gameDir, AbortSignal.abort()), { code: 'CANCELLED' });
});

test('config replacements remain conflicts and signature failures retain their authentication classification', async () => {
  const gameDir = await folder(); await mkdir(path.join(gameDir, 'config')); await writeFile(path.join(gameDir, 'config', 'owned.json'), 'old');
  const payload = manifest(); payload.operations = [{ ...payload.operations[0]!, kind: 'replace', area: 'config', path: 'owned.json',
    managedId, expectedSha256: digest('old'), artifactId: 'config', sha256: digest('new'), size: 3 }];
  await writeFile(path.join(gameDir, '.oucl-distribution-receipts.json'), JSON.stringify(receipt([{ ...claim(), area: 'config', path: 'owned.json' }])));
  const fixture = signed(payload); const target: DistributionTarget = { instanceId, revision: 1, gameDir, environment: payload.target };
  const request = { sourceId: 'club-source', packageId: 'club', packageVersion: '1', instanceId };
  const preview = await new DistributionPreviewService({ sources: [fixture.record], fetcher: fixture.fetcher, readTarget: async () => target }).preview(request);
  assert.deepEqual(preview.diff.changes, []); assert.equal(preview.diff.conflicts[0]?.code, 'CHANGED');
  assert.equal(await readFile(path.join(gameDir, 'config', 'owned.json'), 'utf8'), 'old');
  const bad = structuredClone(fixture.record); bad.keys[0]!.revoked = true;
  await assert.rejects(new DistributionPreviewService({ sources: [bad], fetcher: fixture.fetcher, readTarget: async () => target }).preview(request), { code: 'UNTRUSTED_DISTRIBUTION' });
});
