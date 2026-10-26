import assert from 'node:assert/strict';
import test from 'node:test';
import { LoaderMetadataClient, isOfficialLoaderMetadataUrl } from '../src/services/loaders/metadata.js';
import type { MetadataReader } from '../src/services/catalog/transport.js';

test('loader source allowlist accepts only fixed official endpoint shapes', () => {
  assert.equal(isOfficialLoaderMetadataUrl('https://meta.fabricmc.net/v2/versions/loader/1.20.1'), true);
  assert.equal(isOfficialLoaderMetadataUrl('https://meta.quiltmc.org/v3/versions/loader/1.20.1/0.29.2/profile/json'), true);
  assert.equal(isOfficialLoaderMetadataUrl('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'), true);
  assert.equal(isOfficialLoaderMetadataUrl('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'), true);
  for (const value of [
    'http://meta.fabricmc.net/v2/versions/loader/1.20.1',
    'https://meta.fabricmc.net/v3/versions/loader/1.20.1',
    'https://meta.fabricmc.net/v2/versions/loader/1.20.1?redirect=x',
    'https://meta.fabricmc.net.evil.invalid/v2/versions/loader/1.20.1',
    'https://meta.quiltmc.org/v3/versions/loader/../project'
    ,'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json?mirror=x'
    ,'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/other'
  ]) assert.equal(isOfficialLoaderMetadataUrl(value), false, value);
});

test('metadata client binds Forge and NeoForge catalogs to their fixed official endpoints', async () => {
  const calls: string[] = []; const reader: MetadataReader = { read: async url => {
    calls.push(url); const value = url.includes('forge/promotions') ? { promos: { '1.20.1-recommended': '47.4.28' } }
      : { isSnapshot: false, versions: ['21.1.258', '21.1.265', '21.2.0-beta'] };
    return { body: JSON.stringify(value), sha1: '1'.repeat(40), sha256: '2'.repeat(64) };
  } };
  const client = new LoaderMetadataClient(reader);
  assert.equal((await client.catalog('forge', '1.20.1')).items[0]?.loaderVersion, '47.4.28');
  assert.equal((await client.catalog('neoforge', '1.21.1')).items[0]?.loaderVersion, '21.1.265');
  assert.deepEqual(calls, ['https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
    'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge']);
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

test('background loader profiles retry only bounded transport unavailability', async () => {
  const { CatalogError } = await import('../src/services/catalog/transport.js'); let calls=0;
  const client = new LoaderMetadataClient({ read: async () => {
    calls++; if(calls<3)throw new CatalogError('CATALOG_UNAVAILABLE');
    return {body:JSON.stringify({id:'fabric-loader-0.20.1-1.20.1',inheritsFrom:'1.20.1',mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient',arguments:{game:[],jvm:[]},libraries:[{name:'net.fabricmc:fabric-loader:0.20.1',url:'https://maven.fabricmc.net/'}]}),sha1:'1'.repeat(40),sha256:'2'.repeat(64)};
  }});
  assert.equal((await client.profile('fabric','1.20.1','0.20.1')).profile.loaderVersion,'0.20.1');assert.equal(calls,3);
});
test('untrusted responses and invalid profiles are never retried', async () => {
  const { CatalogError } = await import('../src/services/catalog/transport.js');let calls=0;
  const untrusted = new LoaderMetadataClient({read:async()=>{calls++;throw new CatalogError('UNTRUSTED_MANIFEST');}});
  await assert.rejects(untrusted.profile('fabric','1.20.1','0.20.1'),{code:'UNTRUSTED_MANIFEST'});assert.equal(calls,1);
  calls=0;const malformed = new LoaderMetadataClient({read:async()=>{calls++;return {body:'{}',sha1:'1'.repeat(40),sha256:'2'.repeat(64)};}});
  await assert.rejects(malformed.profile('fabric','1.20.1','0.20.1'),{code:'UNTRUSTED_MANIFEST'});assert.equal(calls,1);
});
test('loader profile transport retry budget is exactly three', async () => {
  const { CatalogError } = await import('../src/services/catalog/transport.js');let calls=0;
  const client=new LoaderMetadataClient({read:async()=>{calls++;throw new CatalogError('CATALOG_UNAVAILABLE');}});
  await assert.rejects(client.profile('fabric','1.20.1','0.20.1'),{code:'CATALOG_UNAVAILABLE'});assert.equal(calls,3);
});
test('cancelled loader profile cannot start another retry', async () => {
  const { CatalogError } = await import('../src/services/catalog/transport.js');let calls=0;const abort=new AbortController();
  const client=new LoaderMetadataClient({read:async()=>{calls++;abort.abort();throw new CatalogError('CATALOG_UNAVAILABLE');}});
  await assert.rejects(client.profile('fabric','1.20.1','0.20.1',abort.signal),{code:'CATALOG_UNAVAILABLE'});assert.equal(calls,1);
  await assert.rejects(client.profile('fabric','1.20.1','0.20.1',abort.signal),{code:'CATALOG_UNAVAILABLE'});assert.equal(calls,1);
});
