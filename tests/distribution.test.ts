import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { canonicalDistributionPayload, distributionDiff, parseDistributionEnvelope, parseDistributionManifest } from '../src/core/distribution/manifest.js';
import type { DistributionManifest } from '../src/core/distribution/manifest.js';
import { distributionTestSource } from './fixtures/distribution-source.js';

const managedId = randomUUID();
const manifest = (): DistributionManifest => ({ formatVersion: 1, packageId: 'club', packageVersion: '1.0.0',
  target: { minecraft: '1.20.1', javaMajor: 17, loader: 'fabric', loaderVersion: '0.16.14' }, operations: [
    { kind: 'replace', area: 'mods', path: 'owned.jar', managedId, expectedSha256: 'a'.repeat(64), artifactId: 'new-mod', sha256: 'b'.repeat(64), size: 12 },
    { kind: 'remove', area: 'config', path: 'owned.json', managedId, expectedSha256: 'c'.repeat(64) },
    { kind: 'add', area: 'resourcepacks', path: 'club.zip', artifactId: 'pack', sha256: 'd'.repeat(64), size: 9 },
    { kind: 'keep', area: 'mods', path: 'private.jar' },
  ] });

test('distribution manifest is bounded, exact and rejects protected areas, aliases and path escape', () => {
  assert.deepEqual(parseDistributionManifest(manifest()), manifest());
  for (const value of [{ ...manifest(), formatVersion: 2 }, { ...manifest(), url: 'https://untrusted.invalid' },
    { ...manifest(), operations: [{ kind: 'remove', area: 'saves', path: 'world', managedId, expectedSha256: 'a'.repeat(64) }] },
    ...['../escape', 'C:/escape', 'a\\b', 'CON', 'name.'].map(path => ({ ...manifest(), operations: [{ kind: 'keep', area: 'config', path }] })),
    { ...manifest(), operations: [{ kind: 'keep', area: 'mods', path: 'A.jar' }, { kind: 'keep', area: 'mods', path: 'a.jar' }] },
    { ...manifest(), operations: new Array(257).fill({ kind: 'keep', area: 'mods', path: 'a.jar' }) }]) {
    assert.throws(() => parseDistributionManifest(value), { code: 'INVALID_MANIFEST' });
  }
});

test('distribution changes require ownership and exact observed old hash, preserving omitted and unknown files', () => {
  const observations = [{ area: 'mods' as const, path: 'owned.jar', managedId, sha256: 'a'.repeat(64) },
    { area: 'config' as const, path: 'owned.json', managedId, sha256: 'c'.repeat(64) },
    { area: 'mods' as const, path: 'private.jar', managedId: null, sha256: 'e'.repeat(64) },
    { area: 'config' as const, path: 'player.json', managedId: null, sha256: 'f'.repeat(64) }];
  const before = structuredClone(observations); const result = distributionDiff(manifest(), observations);
  assert.equal(result.changes.length, 3); assert.deepEqual(observations, before);
  for (const changed of [{ ...observations[0]!, managedId: null }, { ...observations[0]!, sha256: 'f'.repeat(64) }]) {
    const conflict = distributionDiff(manifest(), [changed, ...observations.slice(1)]);
    assert.equal(conflict.changes.length, 0); assert.equal(conflict.conflicts.length, 1);
  }
});

test('in-memory distribution adapter requires configured Ed25519 key and rejects tampering, substitution and cancellation', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519'); const payload = manifest();
  const signature = { algorithm: 'ed25519' as const, keyId: 'test-only', value: sign(null, Buffer.from(canonicalDistributionPayload(payload)), privateKey).toString('base64') };
  const source = distributionTestSource({ payload, signature }, new Map([[signature.keyId, publicKey]]));
  assert.deepEqual((await source.resolve({ packageId: 'club', packageVersion: '1.0.0' })).payload, payload);
  for (const adapter of [distributionTestSource({ payload: { ...payload, packageVersion: '2.0.0' }, signature }, new Map([[signature.keyId, publicKey]])),
    distributionTestSource({ payload: { ...payload, target: { ...payload.target, javaMajor: 21 } }, signature }, new Map([[signature.keyId, publicKey]])),
    distributionTestSource({ payload, signature }, new Map([[signature.keyId, generateKeyPairSync('ed25519').publicKey]])),
    distributionTestSource({ payload, signature }, new Map())]) {
    await assert.rejects(adapter.resolve({ packageId: 'club', packageVersion: '1.0.0' }), { code: 'UNTRUSTED_DISTRIBUTION' });
  }
  await assert.rejects(source.resolve({ packageId: 'another', packageVersion: '1.0.0' }), { code: 'UNTRUSTED_DISTRIBUTION' });
  await assert.rejects(source.resolve({ packageId: 'club', packageVersion: '1.0.0' }, AbortSignal.abort()), { code: 'CANCELLED' });
  assert.throws(() => parseDistributionEnvelope({ payload, signature: { ...signature, url: 'private' } }), { code: 'INVALID_MANIFEST' });
  assert.throws(() => parseDistributionEnvelope({ payload, signature: { ...signature, value: 'unsigned' } }), { code: 'INVALID_MANIFEST' });
});
