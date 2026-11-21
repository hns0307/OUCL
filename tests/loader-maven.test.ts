import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { LoaderMavenResolver, readOfficialMavenProof } from '../src/services/loaders/maven.js';
import type { LoaderProfile } from '../src/core/loaders/types.js';
import { definition } from '../src/services/objects/provenance.js';
import { isArtifactUrl } from '../src/services/download/types.js';

const inlineHash = 'a'.repeat(40); const sidecarHash = 'b'.repeat(40);
const profile: LoaderProfile = {
  kind: 'fabric', minecraftVersion: '1.20.1', loaderVersion: '0.20.1', id: 'fabric-loader-0.20.1-1.20.1',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient', arguments: { game: [], jvm: [] }, libraries: [
    { coordinate: 'org.example:inline:1', path: 'org/example/inline/1/inline-1.jar', url: 'https://maven.fabricmc.net/org/example/inline/1/inline-1.jar', sha1: inlineHash, size: 12, proof: 'inline-sha1' },
    { coordinate: 'org.example:sidecar:1', path: 'org/example/sidecar/1/sidecar-1.jar', url: 'https://maven.fabricmc.net/org/example/sidecar/1/sidecar-1.jar', proof: 'official-sidecar-required' }
  ]
};
const evidence = { sourceUrl: 'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.20.1/profile/json', sha256: 'c'.repeat(64) };

test('loader Maven libraries use inline profile proof or the exact official sidecar', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': '34' } });
    return new Response(sidecarHash, { status: 200, headers: { 'content-length': '40' } });
  };
  const plan = await new LoaderMavenResolver(fetcher, 2).plan(profile, evidence);
  assert.equal(plan.totalBytes, 46);
  assert.equal(plan.libraries[0]?.spec.anchor.kind, 'loader-profile');
  assert.equal(plan.libraries[1]?.spec.anchor.kind, 'loader-maven');
  assert.equal(plan.libraries[1]?.spec.anchor.digest, createHash('sha256').update(sidecarHash).digest('hex'));
  assert.equal(plan.libraries[1]?.spec.expected.digest, sidecarHash);
  assert.deepEqual(calls, [
    { url: `${profile.libraries[1]!.url}.sha1`, method: 'GET' },
    { url: profile.libraries[1]!.url, method: 'HEAD' }
  ]);
  for (const item of plan.libraries) assert.doesNotThrow(() => definition(item.spec.expected, item.spec.anchor));
});

test('official Maven proof retries network failures three times, never malformed proof or cancellation', async () => {
  const url = profile.libraries[1]!.url; let calls = 0;
  const recovered: typeof fetch = async (_input, options) => {
    calls++; if (calls === 1) throw new Error('PRIVATE_NETWORK_DETAIL');
    return options?.method === 'HEAD' ? new Response(null, { headers: { 'content-length': '4' } }) : new Response(sidecarHash);
  };
  assert.equal((await readOfficialMavenProof(recovered, url)).sha1, sidecarHash); assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(readOfficialMavenProof(async () => { calls++; throw new Error('network'); }, url), { code: 'NETWORK_FAILED' });
  assert.equal(calls, 3); calls = 0;
  await assert.rejects(readOfficialMavenProof(async () => { calls++; return new Response('bad-hash'); }, url), { code: 'INVALID_METADATA' });
  assert.equal(calls, 1); calls = 0;
  const controller = new AbortController();
  await assert.rejects(readOfficialMavenProof(async () => { calls++; controller.abort(); throw new Error('cancelled'); }, url, controller.signal), { code: 'CANCELLED' });
  assert.equal(calls, 1);
  await assert.rejects(readOfficialMavenProof(recovered, url, controller.signal), { code: 'CANCELLED' }); assert.equal(calls, 1);
});

test('artifact policy admits only exact official Maven hosts without query or credentials', () => {
  assert.equal(isArtifactUrl('https://maven.fabricmc.net/a/b.jar'), true);
  assert.equal(isArtifactUrl('https://maven.quiltmc.org/repository/release/a/b.jar'), true);
  assert.equal(isArtifactUrl('https://maven.minecraftforge.net/net/minecraftforge/forge/a.jar'), true);
  assert.equal(isArtifactUrl('https://maven.neoforged.net/releases/net/neoforged/neoforge/a.jar'), true);
  assert.equal(isArtifactUrl('https://maven.fabricmc.net.evil.invalid/a.jar'), false);
  assert.equal(isArtifactUrl('https://maven.fabricmc.net/a.jar?token=x'), false);
});

test('loader Maven resolver rejects malformed proof, unsafe size, bad evidence and cancellation', async () => {
  const reply = (hash: string, size: string): typeof fetch => async (_input, init) => init?.method === 'HEAD'
    ? new Response(null, { status: 200, headers: { 'content-length': size } })
    : new Response(hash, { status: 200 });
  await assert.rejects(new LoaderMavenResolver(reply('not-a-hash', '4')).plan(profile, evidence), { code: 'INVALID_METADATA' });
  await assert.rejects(new LoaderMavenResolver(reply(sidecarHash, String(1024 ** 3 + 1))).plan(profile, evidence), { code: 'INVALID_METADATA' });
  await assert.rejects(new LoaderMavenResolver(reply(sidecarHash, '4')).plan(profile, { ...evidence, sourceUrl: 'https://example.invalid/profile/json' }), { code: 'INVALID_METADATA' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new LoaderMavenResolver(reply(sidecarHash, '4')).plan(profile, evidence, controller.signal), { code: 'CANCELLED' });
});

test('Maven size retries do not refetch a successful checksum and cancellation interrupts its backoff', async () => {
  const url = 'https://maven.fabricmc.net/example/library.jar'; let gets = 0; let heads = 0;
  const request: typeof fetch = async (_input, options) => {
    if (options?.method !== 'HEAD') { gets++; return new Response(sidecarHash); }
    if (++heads < 3) throw new TypeError('connection reset');
    return new Response(null, { headers: { 'content-length': '4' } });
  };
  const proof = await readOfficialMavenProof(request, url); assert.equal(proof.sha1, sidecarHash); assert.equal(proof.size, 4);
  assert.equal(gets, 1); assert.equal(heads, 3);
  const controller = new AbortController(); heads = 0;
  await assert.rejects(readOfficialMavenProof(async (_input, options) => {
    if (options?.method !== 'HEAD') return new Response(sidecarHash);
    heads++; setTimeout(() => controller.abort(), 20); throw new TypeError('reset');
  }, url, controller.signal), { code: 'CANCELLED' }); assert.equal(heads, 1);
});
