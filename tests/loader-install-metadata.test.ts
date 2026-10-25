import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { parseAssetIndex } from '../src/core/install/assets.js';
import { planVanillaInstall } from '../src/core/install/plan.js';
import { parseLoaderProfile } from '../src/core/loaders/metadata.js';
import type { ResolvedClientVersion } from '../src/core/version/types.js';
import { LoaderInstallMetadataService, parseStoredLoaderProfile } from '../src/services/loaders/install-metadata.js';

const hash = (algorithm: 'sha1' | 'sha256', value: string): string => createHash(algorithm).update(value).digest('hex');
const assetBody = JSON.stringify({ objects: {} }); const assetSha1 = hash('sha1', assetBody);
const baseDocument = JSON.stringify({ id: '1.20.1', mainClass: 'net.minecraft.client.main.Main',
  downloads: { client: { url: 'https://piston-data.mojang.com/v1/objects/client.jar', sha1: '1'.repeat(40), size: 10 } },
  assetIndex: { id: '1.20', url: 'https://piston-meta.mojang.com/v1/packages/index.json', sha1: assetSha1, size: Buffer.byteLength(assetBody) },
  libraries: [], arguments: { game: [], jvm: [] }, javaVersion: { majorVersion: 17 } });
const baseVersion: ResolvedClientVersion = { id: '1.20.1', ancestry: ['1.20.1'], mainClass: 'net.minecraft.client.main.Main', type: 'release', javaMajor: 17,
  client: { url: 'https://piston-data.mojang.com/v1/objects/client.jar', sha1: '1'.repeat(40), size: 10 }, jarVersionId: '1.20.1',
  assetIndex: { id: '1.20', url: 'https://piston-meta.mojang.com/v1/packages/index.json', sha1: assetSha1, size: Buffer.byteLength(assetBody) },
  assetIndexVersionId: '1.20.1', libraries: [], gameArguments: [], jvmArguments: [] };
const assets = parseAssetIndex(JSON.parse(assetBody) as unknown); const baseSha1 = hash('sha1', baseDocument);
const base = { version: baseVersion, assets, plan: planVanillaInstall(baseVersion, { '1.20.1': baseSha1 }, assets),
  metadataSha1ByVersion: { '1.20.1': baseSha1 }, assetIndexBody: assetBody, versionDocuments: { '1.20.1': baseDocument } };
const profileValue = { id: 'fabric-loader-0.20.1-1.20.1', inheritsFrom: '1.20.1', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  arguments: { game: [], jvm: ['-Dloader=true'] }, libraries: [{ name: 'net.fabricmc:fabric-loader:0.20.1', url: 'https://maven.fabricmc.net/' }] };
const profileBody = JSON.stringify(profileValue); const profileSha256 = hash('sha256', profileBody);
const profile = parseLoaderProfile('fabric', '1.20.1', '0.20.1', profileValue);
const libraryHash = '2'.repeat(40); const environment = { os: 'windows' as const, arch: 'x64' as const, osVersion: '10.0', features: {} };

test('loader metadata orchestration produces one complete pinned plan without side effects', async () => {
  const service = new LoaderInstallMetadataService({ prepare: async () => base }, { profile: async () => ({ profile, body: profileBody,
    evidence: { sourceUrl: 'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.20.1/profile/json', sha256: profileSha256 } }) },
  { plan: async () => ({ totalBytes: 30, libraries: [{ path: profile.libraries[0]!.path, spec: { url: profile.libraries[0]!.url,
    expected: { algorithm: 'sha1', digest: libraryHash, size: 30, provenanceId: `loader:fabric:${libraryHash}` },
    anchor: { kind: 'loader-maven', algorithm: 'sha256', digest: '3'.repeat(64) } } }] }) });
  const prepared = await service.prepare('fabric', '1.20.1', '0.20.1', environment);
  assert.equal(prepared.loader.kind, 'fabric'); assert.equal(prepared.loader.profileBody, profileBody);
  assert.equal(prepared.version.mainClass, profile.mainClass);
  assert.ok(prepared.plan.artifacts.some(item => item.sha1 === libraryHash));
  assert.deepEqual(parseStoredLoaderProfile('fabric', '1.20.1', '0.20.1', profileBody, profileSha256), profile);
});

test('loader metadata orchestration rejects cancellation, corrupt stored bytes and unknown failures', async () => {
  const controller = new AbortController(); controller.abort();
  const unused = new LoaderInstallMetadataService({ prepare: async () => base }, { profile: async () => { throw new Error('private'); } },
    { plan: async () => { throw new Error('private'); } });
  await assert.rejects(unused.prepare('quilt', '1.20.1', '0.29.2', environment, controller.signal), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseStoredLoaderProfile('fabric', '1.20.1', '0.20.1', `${profileBody} `, profileSha256), { code: 'UNTRUSTED_MANIFEST' });
  await assert.rejects(unused.prepare('fabric', '1.20.1', '0.20.1', environment), { code: 'UNTRUSTED_MANIFEST' });
});
