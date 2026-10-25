import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInstallerCatalog, parseLoaderCatalog, parseLoaderProfile } from '../src/core/loaders/metadata.js';

const catalogEntry = (version = '0.20.1') => ({
  loader: { maven: `net.fabricmc:fabric-loader:${version}`, version, stable: true },
  intermediary: { maven: 'net.fabricmc:intermediary:1.20.1', version: '1.20.1', stable: true }
});

test('loader catalogs retain official identities and reject duplicate or mismatched entries', () => {
  assert.deepEqual(parseLoaderCatalog('fabric', '1.20.1', [catalogEntry()])[0], {
    kind: 'fabric', minecraftVersion: '1.20.1', loaderVersion: '0.20.1',
    loaderCoordinate: 'net.fabricmc:fabric-loader:0.20.1',
    intermediaryCoordinate: 'net.fabricmc:intermediary:1.20.1', stable: true
  });
  assert.throws(() => parseLoaderCatalog('fabric', '1.20.1', [catalogEntry(), catalogEntry()]));
  assert.throws(() => parseLoaderCatalog('fabric', '1.20.2', [catalogEntry()]));
  assert.equal(parseLoaderCatalog('quilt', '1.20.1', [{
    loader: { maven: 'org.quiltmc:quilt-loader:0.29.2-beta.1', version: '0.29.2-beta.1' },
    intermediary: catalogEntry().intermediary
  }])[0]?.stable, false);
});

test('official profiles produce deterministic Maven paths and require missing proof sidecars', () => {
  const profile = parseLoaderProfile('fabric', '1.20.1', '0.20.1', {
    id: 'fabric-loader-0.20.1-1.20.1', inheritsFrom: '1.20.1',
    mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    arguments: { game: [], jvm: ['-Dfabric.skipMcProvider=true'] },
    libraries: [
      { name: 'net.fabricmc:intermediary:1.20.1', url: 'https://maven.fabricmc.net/' },
      { name: 'org.ow2.asm:asm:9.9', url: 'https://maven.fabricmc.net', sha1: 'A'.repeat(40), size: 126122 }
    ]
  });
  assert.equal(profile.libraries[0]?.path, 'net/fabricmc/intermediary/1.20.1/intermediary-1.20.1.jar');
  assert.equal(profile.libraries[0]?.proof, 'official-sidecar-required');
  assert.equal(profile.libraries[1]?.url, 'https://maven.fabricmc.net/org/ow2/asm/asm/9.9/asm-9.9.jar');
  assert.equal(profile.libraries[1]?.sha1, 'a'.repeat(40));
  assert.equal(profile.libraries[1]?.proof, 'inline-sha1');
});

test('profiles reject identity substitution, unsafe repositories and partial checksums', () => {
  const base = {
    id: 'quilt-loader-0.29.2-1.20.1', inheritsFrom: '1.20.1',
    mainClass: 'org.quiltmc.loader.impl.launch.knot.KnotClient', arguments: { game: [], jvm: [] },
    libraries: [{ name: 'org.quiltmc:quilt-loader:0.29.2', url: 'https://maven.quiltmc.org/repository/release/' }]
  };
  assert.equal(parseLoaderProfile('quilt', '1.20.1', '0.29.2', base).libraries.length, 1);
  assert.throws(() => parseLoaderProfile('quilt', '1.20.1', '0.29.2', { ...base, id: 'other' }));
  assert.throws(() => parseLoaderProfile('quilt', '1.20.1', '0.29.2', {
    ...base, libraries: [{ name: 'org.quiltmc:quilt-loader:0.29.2', url: 'https://example.invalid/' }]
  }));
  assert.throws(() => parseLoaderProfile('quilt', '1.20.1', '0.29.2', {
    ...base, libraries: [{ name: 'org.quiltmc:quilt-loader:0.29.2', url: 'https://maven.quiltmc.org/', sha1: 'a'.repeat(40) }]
  }));
});

test('Forge promotions preserve Recommended priority without turning Latest into stable', () => {
  assert.deepEqual(parseInstallerCatalog('forge', '1.20.1', { promos: {
    '1.20.1-recommended': '47.4.28', '1.20.1-latest': '47.4.29', '1.19.4-latest': '45.4.0'
  } }), [
    { kind: 'forge', minecraftVersion: '1.20.1', loaderVersion: '47.4.28', stable: true },
    { kind: 'forge', minecraftVersion: '1.20.1', loaderVersion: '47.4.29', stable: false },
  ]);
  assert.equal(parseInstallerCatalog('forge', '1.20.1', { promos: { '1.20.1-latest': '47.4.29' } })[0]?.stable, false);
});

test('NeoForge release catalog filters the exact 1.21.1 series and sorts deterministically', () => {
  assert.deepEqual(parseInstallerCatalog('neoforge', '1.21.1', { isSnapshot: false,
    versions: ['21.1.9', '21.1.10', '21.2.0-beta', '21.1.8-beta', '20.4.250'] }).map(item => item.loaderVersion), ['21.1.10', '21.1.9']);
  assert.throws(() => parseInstallerCatalog('neoforge', '1.21.2', { isSnapshot: false, versions: ['21.1.10'] }));
  assert.throws(() => parseInstallerCatalog('neoforge', '1.21.1', { isSnapshot: true, versions: ['21.1.10'] }));
});
