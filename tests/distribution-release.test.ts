import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { canonicalDistributionPayload } from '../src/core/distribution/manifest.js';
import type { DistributionManifest } from '../src/core/distribution/manifest.js';
import { canonicalDistributionReleasePayload, MAX_RELEASE_VALIDITY_MS, parseDistributionReleaseEnvelope, parseDistributionReleasePayload } from '../src/core/distribution/release.js';
import type { DistributionReleaseEnvelope, DistributionReleasePayload } from '../src/core/distribution/release.js';
import { EMPTY_RELEASE_SOURCES, PinnedReleaseSource } from '../src/services/distribution/release-source.js';
import type { ReleaseScope, ReleaseState, ReleaseStateStore } from '../src/services/distribution/release-source.js';

const NOW = 1794758400000;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const manifest = (): DistributionManifest => ({ formatVersion: 1, packageId: 'club', packageVersion: '1', target: {
  minecraft: '1.20.1', javaMajor: 17, loader: 'fabric', loaderVersion: '0.16.14',
}, operations: [{ kind: 'add', area: 'mods', path: 'club.jar', artifactId: 'club-file', sha256: 'a'.repeat(64), size: 16 }] });
function payload(sequence = 1): DistributionReleasePayload {
  const value = manifest();
  return { releaseFormatVersion: 2, sourceId: 'club-source', packageId: value.packageId, packageVersion: value.packageVersion,
    sequence, issuedAt: NOW - 1000, expiresAt: NOW + 60000, manifestSha256: hash(canonicalDistributionPayload(value)), manifest: value };
}
class MemoryStore implements ReleaseStateStore {
  readonly values = new Map<string, ReleaseState>(); reads = 0; writes = 0;
  async read(scope: ReleaseScope): Promise<ReleaseState | undefined> { this.reads++; const value = this.values.get(JSON.stringify(scope)); return value ? { ...value } : undefined; }
  async compareAndSet(scope: ReleaseScope, expected: ReleaseState | undefined, next: ReleaseState): Promise<boolean> {
    const key = JSON.stringify(scope); const current = this.values.get(key);
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
    this.values.set(key, { ...next }); this.writes++; return true;
  }
}
function fixture() {
  const pair = generateKeyPairSync('ed25519');
  const record = { sourceId: 'club-source', manifestOrigin: 'https://publisher.example', manifestPathPrefix: '/releases/',
    keys: [{ keyId: 'release-key', spki: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false }] };
  const envelope = (value = payload()): DistributionReleaseEnvelope => ({ payload: value,
    signature: { algorithm: 'ed25519', keyId: 'release-key', value: sign(null, Buffer.from(canonicalDistributionReleasePayload(value)), pair.privateKey).toString('base64') } });
  const fetcher = (value: unknown): typeof fetch => async (_input, init) => {
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
    return new Response(JSON.stringify(value));
  };
  return { record, envelope, fetcher };
}
const request = () => ({ packageId: 'club', packageVersion: '1', target: manifest().target });

test('release v2 strict canonical format preserves embedded v1 bytes and bounds lifetime/sequence', () => {
  const value = payload(); const before = canonicalDistributionPayload(value.manifest);
  assert.deepEqual(parseDistributionReleasePayload(value), value);
  assert.equal(canonicalDistributionPayload(value.manifest), before);
  assert.equal(canonicalDistributionReleasePayload(Object.fromEntries(Object.entries(value).reverse())), JSON.stringify(value));
  for (const invalid of [{ ...value, releaseFormatVersion: 1 }, { ...value, sequence: 0 }, { ...value, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...value, sourceId: '../source' }, { ...value, issuedAt: 'now' }, { ...value, expiresAt: value.issuedAt },
    { ...value, expiresAt: value.issuedAt + MAX_RELEASE_VALIDITY_MS + 1 }, { ...value, manifestSha256: 'A'.repeat(64) },
    { ...value, extra: true }, { ...value, packageVersion: '2' }]) {
    assert.throws(() => parseDistributionReleasePayload(invalid), { code: 'INVALID_RELEASE' });
  }
  const signed = fixture().envelope(); assert.deepEqual(parseDistributionReleaseEnvelope(signed), signed);
  assert.throws(() => parseDistributionReleaseEnvelope({ ...signed, extra: true }), { code: 'INVALID_RELEASE' });
  assert.throws(() => parseDistributionReleaseEnvelope({ ...signed, signature: { ...signed.signature, algorithm: 'rsa' } }), { code: 'INVALID_RELEASE' });
});

test('real Ed25519 release accepts increasing sequence and exact idempotent payload through authoritative CAS', async () => {
  const f = fixture(); const store = new MemoryStore(); assert.deepEqual(EMPTY_RELEASE_SOURCES, []);
  for (const sequence of [1, 1, 2]) {
    const source = new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(f.envelope(payload(sequence))), now: () => NOW });
    const result = await source.resolve(request()); assert.equal(result.envelope.payload.sequence, sequence);
    assert.equal(result.releaseSha256, hash(canonicalDistributionReleasePayload(result.envelope.payload)));
  }
  assert.equal(store.values.values().next().value?.sequence, 2); assert.equal(store.writes, 3);
});

test('bad signature, revoked/wrong key, wrong request/source/target and manifest digest never touch authority', async () => {
  const f = fixture(); const store = new MemoryStore(); const signed = f.envelope();
  const changed = structuredClone(signed); changed.payload.sequence = 2;
  const wrongHash = payload(); wrongHash.manifestSha256 = 'b'.repeat(64);
  const wrongSource = payload(); wrongSource.sourceId = 'another-source';
  for (const value of [changed, f.envelope(wrongHash), f.envelope(wrongSource)]) {
    await assert.rejects(new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(value), now: () => NOW }).resolve(request()), { code: 'UNTRUSTED_RELEASE' });
  }
  for (const keys of [[{ ...f.record.keys[0]!, revoked: true }], fixture().record.keys]) {
    await assert.rejects(new PinnedReleaseSource({ ...f.record, keys }, store, { fetcher: f.fetcher(signed), now: () => NOW }).resolve(request()), { code: 'UNTRUSTED_RELEASE' });
  }
  const source = new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(signed), now: () => NOW });
  for (const query of [{ ...request(), packageId: 'other' }, { ...request(), packageVersion: '2' },
    { ...request(), target: { ...request().target, javaMajor: 21 as const } }]) await assert.rejects(source.resolve(query), { code: 'UNTRUSTED_RELEASE' });
  assert.equal(store.reads, 0); assert.equal(store.writes, 0);
});

test('expired and not-yet-valid signed releases cannot advance highest accepted sequence', async () => {
  const f = fixture(); const store = new MemoryStore();
  for (const [now, code] of [[NOW + 60000, 'RELEASE_EXPIRED'], [NOW - 1001, 'RELEASE_NOT_YET_VALID']] as const) {
    await assert.rejects(new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(f.envelope()), now: () => now }).resolve(request()), { code });
  }
  assert.equal(store.reads, 0); assert.equal(store.writes, 0);
});

test('accepted high water rejects downgrade and same-sequence differing signed content across package versions', async () => {
  const f = fixture(); const store = new MemoryStore();
  await new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(f.envelope(payload(5))), now: () => NOW }).resolve(request());
  await assert.rejects(new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(f.envelope(payload(4))), now: () => NOW }).resolve(request()), { code: 'RELEASE_DOWNGRADE' });
  const changed = payload(5); changed.manifest.operations = []; changed.manifestSha256 = hash(canonicalDistributionPayload(changed.manifest));
  await assert.rejects(new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(f.envelope(changed)), now: () => NOW }).resolve(request()), { code: 'RELEASE_EQUIVOCATION' });
  const oldVersion = payload(3); oldVersion.packageVersion = '0'; oldVersion.manifest.packageVersion = '0'; oldVersion.manifestSha256 = hash(canonicalDistributionPayload(oldVersion.manifest));
  await assert.rejects(new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(f.envelope(oldVersion)), now: () => NOW }).resolve({ ...request(), packageVersion: '0' }), { code: 'RELEASE_DOWNGRADE' });
  assert.equal(store.writes, 1);
});

test('CAS concurrency prevents delayed lower release and idempotent old release accepting after a newer sequence', async () => {
  const f = fixture(); const memory = new MemoryStore(); const old = payload(1); const newer = payload(2);
  await new PinnedReleaseSource(f.record, memory, { fetcher: f.fetcher(f.envelope(old)), now: () => NOW }).resolve(request());
  let enter: (() => void) | undefined; let unblock: (() => void) | undefined;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { unblock = resolve; });
  const store: ReleaseStateStore = {
    read: scope => memory.read(scope),
    compareAndSet: async (scope, expected, next) => { if (next.sequence === 1) { enter?.(); await gate; } return memory.compareAndSet(scope, expected, next); },
  };
  const pendingOld = new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(f.envelope(old)), now: () => NOW }).resolve(request());
  const oldAssertion = assert.rejects(pendingOld, { code: 'RELEASE_DOWNGRADE' });
  await entered;
  await new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(f.envelope(newer)), now: () => NOW }).resolve(request());
  unblock?.(); await oldAssertion; assert.equal(memory.values.values().next().value?.sequence, 2);
});

test('same sequence competing signed payloads have one CAS winner and deterministic equivocation rejection', async () => {
  const f = fixture(); const store = new MemoryStore(); const second = payload(); second.expiresAt++;
  const results = await Promise.allSettled([payload(), second].map(value => new PinnedReleaseSource(f.record, store, { fetcher: f.fetcher(f.envelope(value)), now: () => NOW }).resolve(request())));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected'); assert.ok(rejected?.status === 'rejected');
  assert.equal((rejected.reason as { code?: string }).code, 'RELEASE_EQUIVOCATION'); assert.equal(store.writes, 1);
});

test('hard timeout and cancellation settle even when fetch/read/cancel ignore abort', async () => {
  const f = fixture(); const store = new MemoryStore();
  const neverFetch: typeof fetch = () => new Promise<Response>(() => {});
  const stalledStream: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel: () => new Promise<void>(() => {}) }));
  for (const fetcher of [neverFetch, stalledStream]) {
    const start = Date.now();
    await assert.rejects(new PinnedReleaseSource(f.record, store, { fetcher, now: () => NOW, timeoutMs: 30 }).resolve(request()), { code: 'RELEASE_TIMEOUT' });
    assert.ok(Date.now() - start < 1500);
  }
  const controller = new AbortController(); const resolving = new PinnedReleaseSource(f.record, store, { fetcher: stalledStream, now: () => NOW }).resolve(request(), controller.signal);
  const assertion = assert.rejects(resolving, { code: 'CANCELLED' }); controller.abort(); await assertion;
  assert.equal(store.writes, 0);
});

test('authority corruption, endless CAS contention and timed-out commit remain conservative', async () => {
  const f = fixture(); const options = { fetcher: f.fetcher(f.envelope()), now: () => NOW };
  const invalid: ReleaseStateStore = { read: async () => ({ sequence: 0, releaseSha256: 'a'.repeat(64) }), compareAndSet: async () => { throw new Error('must not write'); } };
  await assert.rejects(new PinnedReleaseSource(f.record, invalid, options).resolve(request()), { code: 'RELEASE_STATE_INVALID' });
  const unavailable: ReleaseStateStore = { read: async () => { throw new Error('private path must not escape'); }, compareAndSet: async () => false };
  await assert.rejects(new PinnedReleaseSource(f.record, unavailable, options).resolve(request()), { code: 'RELEASE_STATE_INVALID' });
  const contentious: ReleaseStateStore = { read: async () => undefined, compareAndSet: async () => false };
  await assert.rejects(new PinnedReleaseSource(f.record, contentious, options).resolve(request()), { code: 'RELEASE_STATE_CONFLICT' });
  const memory = new MemoryStore(); let complete: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  const delayed: ReleaseStateStore = { read: scope => memory.read(scope), compareAndSet: async (scope, expected, next) => { await gate; return memory.compareAndSet(scope, expected, next); } };
  await assert.rejects(new PinnedReleaseSource(f.record, delayed, { ...options, timeoutMs: 30 }).resolve(request()), { code: 'RELEASE_TIMEOUT' });
  complete?.(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(memory.writes, 1); assert.equal(memory.values.values().next().value?.sequence, 1);
});

test('hard budget also bounds a stalled authority read and expiry during CAS rejects current acceptance', async () => {
  const f = fixture(); const options = { fetcher: f.fetcher(f.envelope()), now: () => NOW };
  const stalled: ReleaseStateStore = { read: () => new Promise(() => {}), compareAndSet: async () => { throw new Error('must not write'); } };
  await assert.rejects(new PinnedReleaseSource(f.record, stalled, { ...options, timeoutMs: 30 }).resolve(request()), { code: 'RELEASE_TIMEOUT' });
  let now = NOW; const memory = new MemoryStore();
  const expiresInCAS: ReleaseStateStore = { read: scope => memory.read(scope), compareAndSet: async (scope, expected, next) => {
    const committed = await memory.compareAndSet(scope, expected, next); now = NOW + 60000; return committed;
  } };
  await assert.rejects(new PinnedReleaseSource(f.record, expiresInCAS, { ...options, now: () => now }).resolve(request()), { code: 'RELEASE_EXPIRED' });
  assert.equal(memory.writes, 1); // High-water acceptance is not rolled back; expired release still cannot execute.
});
