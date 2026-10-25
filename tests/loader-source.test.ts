import assert from 'node:assert/strict';
import test from 'node:test';
import { LoaderMetadataClient, isOfficialLoaderMetadataUrl } from '../src/services/loaders/metadata.js';
import type { MetadataReader } from '../src/services/catalog/transport.js';

test('loader source allowlist accepts only fixed official endpoint shapes', () => {
  assert.equal(isOfficialLoaderMetadataUrl('https://meta.fabricmc.net/v2/versions/loader/1.20.1'), true);
  assert.equal(isOfficialLoaderMetadataUrl('https://meta.quiltmc.org/v3/versions/loader/1.20.1/0.29.2/profile/json'), true);
  for (const value of [
    'http://meta.fabricmc.net/v2/versions/loader/1.20.1',
    'https://meta.fabricmc.net/v3/versions/loader/1.20.1',
    'https://meta.fabricmc.net/v2/versions/loader/1.20.1?redirect=x',
    'https://meta.fabricmc.net.evil.invalid/v2/versions/loader/1.20.1',
    'https://meta.quiltmc.org/v3/versions/loader/../project'
  ]) assert.equal(isOfficialLoaderMetadataUrl(value), false, value);
});

test('metadata client binds validated facts to the exact official response digest', async () => {
  const calls: string[] = [];
  const reader: MetadataReader = { read: async url => {
    calls.push(url);
    const value = url.endsWith('/profile/json') ? {
      id: 'fabric-loader-0.20.1-1.20.1', inheritsFrom: '1.20.1',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', arguments: { game: [], jvm: [] },
      libraries: [{ name: 'net.fabricmc:fabric-loader:0.20.1', url: 'https://maven.fabricmc.net/' }]
    } : [{ loader: { maven: 'net.fabricmc:fabric-loader:0.20.1', version: '0.20.1', stable: true },
      intermediary: { maven: 'net.fabricmc:intermediary:1.20.1', version: '1.20.1' } }];
    return { body: JSON.stringify(value), sha1: '1'.repeat(40), sha256: '2'.repeat(64) };
  } };
  const client = new LoaderMetadataClient(reader);
  const catalog = await client.catalog('fabric', '1.20.1');
  const profile = await client.profile('fabric', '1.20.1', '0.20.1');
  assert.equal(catalog.items[0]?.loaderVersion, '0.20.1');
  assert.equal(profile.profile.libraries[0]?.proof, 'official-sidecar-required');
  assert.equal(profile.evidence.sha256, '2'.repeat(64));
  assert.deepEqual(calls, [
    'https://meta.fabricmc.net/v2/versions/loader/1.20.1',
    'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.20.1/profile/json'
  ]);
});

test('metadata client redacts malformed documents and refuses unsafe identifiers', async () => {
  const reader: MetadataReader = { read: async () => ({ body: '{', sha1: '1'.repeat(40), sha256: '2'.repeat(64) }) };
  const client = new LoaderMetadataClient(reader);
  await assert.rejects(client.catalog('quilt', '1.20.1'), { code: 'UNTRUSTED_MANIFEST' });
  await assert.rejects(client.catalog('fabric', '../secret'), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(client.profile('fabric', '1.20.1', '0.20.1?x'), { code: 'INVALID_ARGUMENT' });
});
