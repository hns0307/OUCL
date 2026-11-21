import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { InstallerArtifactResolver } from '../src/services/loaders/installer-artifact.js';

const evidence = (kind: 'forge' | 'neoforge', minecraftVersion: string, loaderVersion: string) => ({
  evidence: { sourceUrl: kind === 'forge' ? 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
    : 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge', sha256: 'c'.repeat(64) },
  items: [{ kind, minecraftVersion, loaderVersion, stable: true }]
});
const reader = (calls: Array<{ url: string; method: string }>): typeof fetch => async (input, init) => {
  calls.push({ url: String(input), method: init?.method ?? 'GET' });
  return init?.method === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-length': '123' } })
    : new Response('a'.repeat(40), { status: 200, headers: { 'content-length': '40' } });
};

test('Forge installer proof is bound to an exact official catalog choice and Maven path', async () => {
  const calls: Array<{ url: string; method: string }> = []; const resolver = new InstallerArtifactResolver(reader(calls));
  const result = await resolver.resolve('forge', '1.20.1', '47.4.28', evidence('forge', '1.20.1', '47.4.28'));
  const url = 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-installer.jar';
  assert.equal(result.sourceUrl, url); assert.equal(result.spec.expected.size, 123); assert.equal(result.spec.expected.digest, 'a'.repeat(40));
  assert.equal(result.spec.anchor.digest, createHash('sha256').update('a'.repeat(40)).digest('hex'));
  assert.deepEqual(calls, [{ url: `${url}.sha1`, method: 'GET' }, { url, method: 'HEAD' }]);
});

test('NeoForge installer uses the releases path and rejects catalog or matrix substitution', async () => {
  const resolver = new InstallerArtifactResolver(reader([]));
  const result = await resolver.resolve('neoforge', '1.21.1', '21.1.265', evidence('neoforge', '1.21.1', '21.1.265'));
  assert.equal(result.sourceUrl, 'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.265/neoforge-21.1.265-installer.jar');
  await assert.rejects(resolver.resolve('neoforge', '1.21.2', '21.1.265', evidence('neoforge', '1.21.2', '21.1.265')), { code: 'INVALID_METADATA' });
  await assert.rejects(resolver.resolve('forge', '1.20.1', '47.4.29', evidence('forge', '1.20.1', '47.4.28')), { code: 'INVALID_METADATA' });
});
