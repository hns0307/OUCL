import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { InstallMetadataService } from '../src/services/catalog/install-metadata.js';
import { CatalogError } from '../src/services/catalog/transport.js';
import type { MetadataReader, JsonDocument } from '../src/services/catalog/transport.js';
import { resolveClientVersion } from '../src/core/version/resolve.js';
import type { ResolvedClientVersion, VersionEnvironment } from '../src/core/version/types.js';

const body = JSON.stringify({ objects: { 'minecraft/音效.ogg': { hash: 'a'.repeat(40), size: 3 } }, virtual: false, map_to_resources: false }, null, 2) + '\n';
const sha1 = createHash('sha1').update(body).digest('hex');
const assetIndex = { id: '17', url: `https://piston-meta.mojang.com/v1/packages/${sha1}/17.json`, sha1, size: Buffer.byteLength(body) };
const client = { url: 'https://piston-data.mojang.com/client.jar', sha1: 'c'.repeat(40), size: 200 };
const library = { url: 'https://libraries.minecraft.net/org/example/library/1/library.jar', sha1: 'd'.repeat(40), size: 12, path: 'org/example/library/1/library.jar' };
const environment: VersionEnvironment = { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} };
const resolved = resolveClientVersion('child', {
  base: { id: 'base', mainClass: 'net.minecraft.client.main.Main', downloads: { client }, assetIndex,
    libraries: [{ name: 'org.example:library:1', downloads: { artifact: library } }], javaVersion: { majorVersion: 21 } },
  child: { id: 'child', inheritsFrom: 'base' }
}, environment);
const hashes = { base: 'e'.repeat(40), child: 'f'.repeat(40) };
const document: JsonDocument = { body, sha1, sha256: createHash('sha256').update(body).digest('hex') };
function catalog(version: ResolvedClientVersion = resolved, metadataSha1ByVersion: Record<string, string> = hashes) {
  return { async resolve(id: string, actual: VersionEnvironment) {
    assert.equal(id, 'child'); assert.deepEqual(actual, environment);
    return { version, metadataSha1: hashes.child, metadataSha1ByVersion };
  } };
}

test('first-release install metadata refuses unsupported OS or architecture before network access', async () => {
  const reader: MetadataReader = { async read() { throw new Error('network must not start'); } };
  const service = new InstallMetadataService(catalog(), reader);
  await assert.rejects(service.prepare('child', { ...environment, arch: 'x86' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(service.prepare('child', { ...environment, os: 'linux' }), { code: 'INVALID_ARGUMENT' });
});

test('install metadata keeps each descriptor origin and exact validated asset-index bytes', async () => {
  let reads = 0;
  const reader: MetadataReader = { async read(url, expectedSha1) {
    reads++; assert.equal(url, assetIndex.url); assert.equal(expectedSha1, sha1); return document;
  } };
  const prepared = await new InstallMetadataService(catalog(), reader).prepare('child', environment);
  assert.equal(reads, 1); assert.equal(prepared.version, resolved);
  assert.deepEqual(prepared.metadataSha1ByVersion, hashes);
  assert.equal(prepared.assetIndexBody, body); assert.notEqual(prepared.assetIndexBody, JSON.stringify(JSON.parse(body) as unknown));
  assert.ok(body.length < Buffer.byteLength(body));
  assert.deepEqual(prepared.assets.objects, [{ name: 'minecraft/音效.ogg', sha1: 'a'.repeat(40), size: 3 }]);
  assert.equal(prepared.plan.artifacts.length, 4);
  assert.equal(prepared.plan.totalBytes, client.size + library.size + assetIndex.size + 3);
  assert.equal(prepared.plan.artifacts.find(item => item.url === library.url)?.source.sha1, hashes.base);
  assert.equal(prepared.plan.artifacts.find(item => item.url === assetIndex.url)?.source.sha1, hashes.base);
  assert.equal(prepared.plan.artifacts.find(item => item.url.startsWith('https://resources.download.minecraft.net/'))?.source.sha1, sha1);
});

test('wrong returned hashes and forged same-size bodies are rejected before planning', async () => {
  for (const value of [{ ...document, sha1: '0'.repeat(40) }, { ...document, body: body.replace('音效', '声音') }, { ...document, body: body + ' ' }]) {
    const reader: MetadataReader = { async read() { return value; } };
    await assert.rejects(new InstallMetadataService(catalog(), reader).prepare('child', environment), { code: 'UNTRUSTED_MANIFEST' });
  }
});

test('asset-index declared size is checked as UTF8 bytes and cannot be trusted from a reader claim', async () => {
  const reader: MetadataReader = { async read() { return document; } };
  for (const size of [assetIndex.size - 1, assetIndex.size + 1, body.length]) {
    const version = { ...resolved, assetIndex: { ...assetIndex, size } };
    await assert.rejects(new InstallMetadataService(catalog(version), reader).prepare('child', environment), { code: 'UNTRUSTED_MANIFEST' });
  }
});

test('missing asset metadata or its actual declaring origin never starts an index request', async () => {
  let reads = 0;
  const reader: MetadataReader = { async read() { reads++; return document; } };
  const missing: ResolvedClientVersion = { ...resolved }; delete missing.assetIndex; delete missing.assetIndexVersionId;
  const noOrigin: ResolvedClientVersion = { ...resolved }; delete noOrigin.assetIndexVersionId;
  for (const version of [missing, noOrigin]) await assert.rejects(new InstallMetadataService(catalog(version), reader).prepare('child', environment), { code: 'UNTRUSTED_MANIFEST' });
  assert.equal(reads, 0);
});

test('malformed asset JSON and absent source proofs are redacted rather than becoming an install plan', async () => {
  const malformed = '{not valid JSON}';
  const malformedSha1 = createHash('sha1').update(malformed).digest('hex');
  const version = { ...resolved, assetIndex: { ...assetIndex, sha1: malformedSha1, size: Buffer.byteLength(malformed) } };
  const reader: MetadataReader = { async read() { return { body: malformed, sha1: malformedSha1, sha256: 'a'.repeat(64) }; } };
  await assert.rejects(new InstallMetadataService(catalog(version), reader).prepare('child', environment), { code: 'UNTRUSTED_MANIFEST', message: 'UNTRUSTED_MANIFEST' });
  await assert.rejects(new InstallMetadataService(catalog(resolved, { child: hashes.child }), { async read() { return document; } }).prepare('child', environment), { code: 'UNTRUSTED_MANIFEST' });
});

test('known catalog/network errors retain their fixed code and unknown dependency errors never leak', async () => {
  await assert.rejects(new InstallMetadataService(catalog(), { async read() { throw new CatalogError('CATALOG_UNAVAILABLE'); } }).prepare('child', environment), { code: 'CATALOG_UNAVAILABLE' });
  await assert.rejects(new InstallMetadataService(catalog(), { async read() { throw new Error('PRIVATE_PATH_OR_BODY'); } }).prepare('child', environment), { code: 'UNTRUSTED_MANIFEST', message: 'UNTRUSTED_MANIFEST' });
});
