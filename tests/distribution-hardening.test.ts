import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonicalDistributionPayload, parseDistributionManifest } from '../src/core/distribution/manifest.js';
import { parsePackageReceipt } from '../src/core/distribution/ownership.js';
import { PinnedDistributionSource } from '../src/services/distribution/source.js';
import { generateKeyPairSync } from 'node:crypto';

const manifest = () => ({ formatVersion: 1, packageId: 'club', packageVersion: 'one',
  target: { minecraft: '1.20.1', javaMajor: 17, loader: 'vanilla', loaderVersion: null }, operations: [{ kind: 'keep', area: 'mods', path: 'a.jar' }] });

test('signed manifest enum fields reject arrays and objects rather than coercing their string value', () => {
  for (const loader of [['vanilla'], { toString: () => 'vanilla' }]) {
    const value = manifest(); assert.throws(() => parseDistributionManifest({ ...value, target: { ...value.target, loader } }), { code: 'INVALID_MANIFEST' });
  }
  for (const [field, value] of [['kind', ['keep']], ['area', ['mods']], ['area', { toString: () => 'mods' }]] as const) {
    const body = manifest(); assert.throws(() => parseDistributionManifest({ ...body, operations: [{ ...body.operations[0], [field]: value }] }), { code: 'INVALID_MANIFEST' });
  }
  const valid = manifest(); assert.deepEqual(parseDistributionManifest(valid), valid);
  assert.equal(canonicalDistributionPayload(valid), JSON.stringify(valid));
});

test('local receipt area must be an exact string before it can influence ownership classification', () => {
  const instanceId = randomUUID();
  const entry = { sourceId: 'club-source', packageId: 'club', packageVersion: 'one', managedId: randomUUID(), area: 'mods', path: 'a.jar', sha256: 'a'.repeat(64) };
  const valid = { formatVersion: 1, instanceId, entries: [entry] };
  assert.deepEqual(parsePackageReceipt(valid, instanceId), valid);
  for (const area of [['mods'], { toString: () => 'mods' }]) assert.throws(() => parsePackageReceipt({ ...valid, entries: [{ ...entry, area }] }, instanceId), { code: 'INVALID_MANIFEST' });
});

test('v1 preview cancellation ends even when an injected fetch, body read or body cleanup ignores abort', async () => {
  const { publicKey } = generateKeyPairSync('ed25519');
  const record = { sourceId: 'club-source', manifestOrigin: 'https://publisher.example', manifestPathPrefix: '/manifests/',
    keys: [{ keyId: 'one', spki: publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false }] };
  for (const fetcher of [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) }))]) {
    const controller = new AbortController(); const timer = setTimeout(() => { controller.abort(); }, 10);
    try { await assert.rejects(new PinnedDistributionSource(record, fetcher).resolve({ packageId: 'club', packageVersion: 'one' }, controller.signal), { code: 'CANCELLED' }); }
    finally { clearTimeout(timer); }
  }
});
