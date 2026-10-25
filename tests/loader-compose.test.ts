import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { parseAssetIndex } from '../src/core/install/assets.js';
import { composeLoaderInstall } from '../src/services/loaders/compose.js';
import type { LoaderProfile } from '../src/core/loaders/types.js';
import type { LoaderLibraryPlan } from '../src/services/loaders/maven.js';

const sha1 = (value: string): string => createHash('sha1').update(value).digest('hex');
const assetBody = JSON.stringify({ objects: {} }); const assetHash = sha1(assetBody);
const base = {
  id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', type: 'release', javaVersion: { majorVersion: 17 },
  downloads: { client: { url: 'https://piston-data.mojang.com/v1/objects/client.jar', sha1: '1'.repeat(40), size: 10 } },
  assetIndex: { id: '1.20', url: 'https://piston-meta.mojang.com/v1/packages/index.json', sha1: assetHash, size: Buffer.byteLength(assetBody) },
  libraries: [{ name: 'org.example:base:1', downloads: { artifact: { url: 'https://libraries.minecraft.net/org/example/base/1/base-1.jar', sha1: '2'.repeat(40), size: 20 } } }],
  arguments: { game: ['--vanilla'], jvm: ['-Dvanilla=true'] }
};
const baseBody = JSON.stringify(base); const profile: LoaderProfile = {
  kind: 'fabric', minecraftVersion: '1.20.1', loaderVersion: '0.20.1', id: 'fabric-loader-0.20.1-1.20.1',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', arguments: { game: ['--loader'], jvm: ['-Dloader=true'] },
  libraries: [{ coordinate: 'net.fabricmc:fabric-loader:0.20.1', path: 'net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar',
    url: 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.20.1/fabric-loader-0.20.1.jar', proof: 'official-sidecar-required' }]
};
const libraries: LoaderLibraryPlan = { totalBytes: 30, libraries: [{ path: profile.libraries[0]!.path, spec: {
  url: profile.libraries[0]!.url, expected: { algorithm: 'sha1', digest: '3'.repeat(40), size: 30, provenanceId: `loader:fabric:${'3'.repeat(40)}` },
  anchor: { kind: 'loader-maven', algorithm: 'sha256', digest: '4'.repeat(64) }
} }] };

test('loader composition inherits vanilla content while pinning entry, arguments and trusted libraries', () => {
  const result = composeLoaderInstall({ baseVersionDocuments: { '1.20.1': baseBody }, baseMetadataSha1ByVersion: { '1.20.1': sha1(baseBody) },
    assets: parseAssetIndex(JSON.parse(assetBody) as unknown), profile, profileSha256: '5'.repeat(64), libraries,
    environment: { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} } });
  assert.equal(result.version.mainClass, profile.mainClass);
  assert.deepEqual(result.version.gameArguments, ['--vanilla', '--loader']);
  assert.deepEqual(result.version.jvmArguments, ['-Dvanilla=true', '-Dloader=true']);
  assert.equal(result.version.client.sha1, '1'.repeat(40));
  assert.deepEqual(result.version.ancestry, ['1.20.1', profile.id]);
  const loader = result.plan.artifacts.find(item => item.sha1 === '3'.repeat(40));
  assert.equal(loader?.source.kind, 'loader-maven');
  assert.equal(loader?.source.algorithm, 'sha256');
  assert.equal(loader?.source.digest, '4'.repeat(64));
  assert.ok(result.plan.classpath.includes(profile.libraries[0]!.path));
});

test('loader composition refuses mismatched library facts and duplicate version identities', () => {
  const input = { baseVersionDocuments: { '1.20.1': baseBody }, baseMetadataSha1ByVersion: { '1.20.1': sha1(baseBody) },
    assets: parseAssetIndex(JSON.parse(assetBody) as unknown), profile, profileSha256: '5'.repeat(64), libraries,
    environment: { os: 'windows' as const, arch: 'x64' as const, osVersion: '10.0', features: {} } };
  assert.throws(() => composeLoaderInstall({ ...input, libraries: { ...libraries, libraries: [{ ...libraries.libraries[0]!, path: 'other.jar' }] } }));
  assert.throws(() => composeLoaderInstall({ ...input, baseVersionDocuments: { ...input.baseVersionDocuments, [profile.id]: baseBody } }));
});
