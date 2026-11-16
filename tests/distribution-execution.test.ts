import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DistributionExecutionCoordinator } from '../src/services/distribution/execution.js';
import type { DistributionExecutionOptions } from '../src/services/distribution/execution.js';
import { DistributionStore } from '../src/services/distribution/store.js';
import { PinnedReleaseSource } from '../src/services/distribution/release-source.js';
import { canonicalDistributionPayload } from '../src/core/distribution/manifest.js';
import type { DistributionManifest } from '../src/core/distribution/manifest.js';
import { canonicalDistributionReleasePayload } from '../src/core/distribution/release.js';
import type { DistributionReleasePayload } from '../src/core/distribution/release.js';
import type { DistributionPlan } from '../src/services/distribution/transaction-record.js';

const windows = { skip: process.platform !== 'win32' };
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
async function fixture(empty = false, lifecycle?: DistributionExecutionOptions['lifecycle']) {
  const parent = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/distribution-execution-tests'); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'execution-'));
  const gameDir = path.join(directory, 'game'); const metadata = path.join(directory, 'metadata'); const artifact = path.join(directory, 'fixture-artifact');
  await mkdir(gameDir); await mkdir(metadata); await writeFile(artifact, 'synthetic-text-fixture');
  const store = await DistributionStore.open(metadata); const rootId = randomUUID(); const instanceId = randomUUID();
  let now = 1794758400000; let version = '1'; let sequence = 1; let validations = 0; let targetReads = 0; let fetches = 0; let rejectValidation = false; let idle = true;
  let validationHook: ((count: number, signal?: AbortSignal) => Promise<void>) | undefined;
  let artifactHook: ((signal?: AbortSignal) => Promise<void>) | undefined;
  let targetGate: { entered(): void; promise: Promise<void> } | undefined;
  const pair = generateKeyPairSync('ed25519');
  const record = { sourceId: 'club-source', manifestOrigin: 'https://publisher.example', manifestPathPrefix: '/releases/',
    keys: [{ keyId: 'temporary-fixture-key', spki: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false }] };
  const environment: DistributionManifest['target'] = { minecraft: '1.20.1', javaMajor: 17, loader: 'fabric', loaderVersion: '0.16.14' };
  const release = (): DistributionReleasePayload => {
    const manifest: DistributionManifest = { formatVersion: 1, packageId: 'club', packageVersion: version, target: environment,
      operations: [{ kind: 'add', area: 'mods', path: 'fixture.jar', artifactId: 'fixture-artifact', sha256: hash('synthetic-text-fixture'), size: Buffer.byteLength('synthetic-text-fixture') }] };
    return { releaseFormatVersion: 2, sourceId: record.sourceId, packageId: 'club', packageVersion: version, sequence,
      issuedAt: 1794758399000, expiresAt: 1794762000000, manifestSha256: hash(canonicalDistributionPayload(manifest)), manifest };
  };
  const fetcher: typeof fetch = async () => {
    fetches++; const payload = release();
    return new Response(JSON.stringify({ payload, signature: { algorithm: 'ed25519', keyId: record.keys[0]!.keyId,
      value: sign(null, Buffer.from(canonicalDistributionReleasePayload(payload)), pair.privateKey).toString('base64') } }));
  };
  const coordinator = new DistributionExecutionCoordinator({ sources: empty ? [] : [record], readSources: () => empty ? [] : [record], store,
    readTarget: async requested => {
      targetReads++; assert.equal(requested, instanceId); const held = targetGate; targetGate = undefined;
      if (held) { held.entered(); await held.promise; }
      return { rootId, instanceId, revision: 1, gameDir, environment };
    },
    isIdle: async () => idle, artifact: async (_plan: DistributionPlan, _index: number, signal?: AbortSignal) => { await artifactHook?.(signal); return artifact; },
    validate: async (_plan: DistributionPlan, signal?: AbortSignal) => { validations++; if (rejectValidation) throw new Error('SYNTHETIC_VALIDATOR_REJECTION'); await validationHook?.(validations, signal); }, fetcher, now: () => now,
    ...(lifecycle ? { lifecycle } : {}),
  });
  const query = () => ({ rootId, instanceId, sourceId: record.sourceId, packageId: 'club', packageVersion: version });
  return { directory, gameDir, store, record, coordinator, query, instanceId, fetcher, environment,
    counters: () => ({ validations, targetReads, fetches }), now: () => now, expire: () => { now = 1794762000000; }, advance: (milliseconds: number) => { now += milliseconds; },
    newer: () => { version = '2'; sequence = 2; }, reject: () => { rejectValidation = true; }, allow: () => { rejectValidation = false; }, busy: () => { idle = false; },
    onValidation: (hook: (count: number, signal?: AbortSignal) => Promise<void>) => { validationHook = hook; },
    onArtifact: (hook: (signal?: AbortSignal) => Promise<void>) => { artifactHook = hook; },
    blockTarget: () => {
      let enter = (): void => {}; let release = (): void => {};
      const entered = new Promise<void>(resolve => { enter = resolve; }); const promise = new Promise<void>(resolve => { release = resolve; });
      targetGate = { entered: enter, promise }; return { entered, release };
    },
    close: async () => { await coordinator.close(); await store.close(); },
  };
}
async function absent(file: string): Promise<void> { await assert.rejects(readFile(file), { code: 'ENOENT' }); }
function oneOf(...codes: string[]) { return (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && codes.includes(error.code); }

test('execution integrates real signature, SQLite authority, file publication and idempotent confirmation', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); const proposal = await f.coordinator.prepare(id, f.query());
    assert.deepEqual(await f.coordinator.prepare(id, f.query()), proposal);
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar'));
    const result = await f.coordinator.confirm(id); assert.equal(result.phase, 'committed');
    assert.deepEqual(await f.coordinator.confirm(id), result);
    await assert.rejects(f.coordinator.cancel(id), { code: 'CANCEL_TOO_LATE' });
    await assert.rejects(f.coordinator.prepare(id, f.query()), { code: 'EXECUTION_REQUEST_FINISHED' });
    assert.equal(await readFile(path.join(f.gameDir, 'mods', 'fixture.jar'), 'utf8'), 'synthetic-text-fixture');
    assert.equal((await f.store.receipts.read(f.instanceId))?.data.txId, result.plan.txId);
    assert.ok(f.counters().validations >= 2, 'product validator must run again before final commit');
  } finally { await f.close(); }
});

test('empty source registry rejects without target, network, artifact or receipt access', windows, async () => {
  const f = await fixture(true);
  try {
    await assert.rejects(f.coordinator.prepare(randomUUID(), f.query()), oneOf('SOURCE_UNAVAILABLE', 'UNTRUSTED_DISTRIBUTION'));
    assert.deepEqual(f.counters(), { validations: 0, targetReads: 0, fetches: 0 });
    assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('new accepted publisher sequence invalidates an earlier prepared proposal before publication', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query()); f.newer();
    const release = await new PinnedReleaseSource(f.record, f.store, { fetcher: f.fetcher, now: f.now }).resolve({ packageId: 'club', packageVersion: '2', target: f.environment });
    await f.store.saveAcceptedRelease(release);
    await assert.rejects(f.coordinator.confirm(id), oneOf('UNTRUSTED_DISTRIBUTION', 'RELEASE_DOWNGRADE', 'FILES_CHANGED'));
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('revocation after prepare is checked against current pinned configuration', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query()); f.record.keys[0]!.revoked = true;
    await assert.rejects(f.coordinator.confirm(id), oneOf('UNTRUSTED_DISTRIBUTION', 'UNTRUSTED_RELEASE'));
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('expired prepared release/proposal cannot publish a file or receipt', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query()); f.expire();
    await assert.rejects(f.coordinator.confirm(id), { code: 'EXECUTION_REQUEST_EXPIRED' });
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('archived signature metadata is reverified before execution, beyond its accepted payload hash', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query());
    const accepted = await f.store.readAcceptedRelease({ sourceId: 'club-source', packageId: 'club' }); assert.ok(accepted);
    accepted.envelope.signature.value = Buffer.alloc(64).toString('base64');
    await f.store.saveAcceptedRelease(accepted);
    await assert.rejects(f.coordinator.confirm(id), { code: 'UNTRUSTED_DISTRIBUTION' });
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('publisher upgrade during final product validation cannot pass the SQLite receipt commit guard', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query()); let upgraded = false;
    f.onValidation(async count => {
      if (count === 4) {
        f.newer(); const accepted = await new PinnedReleaseSource(f.record, f.store, { fetcher: f.fetcher, now: f.now })
          .resolve({ packageId: 'club', packageVersion: '2', target: f.environment });
        await f.store.saveAcceptedRelease(accepted); upgraded = true;
      }
    });
    await assert.rejects(f.coordinator.confirm(id)); assert.equal(upgraded, true, 'upgrade must occur after the final authorize read');
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
    assert.equal((await f.store.journals.read(id))?.data.phase, 'rolledBack');
  } finally { await f.close(); }
});

test('same request cannot change identity; cancelled and closed coordinators cannot confirm preparation', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query());
    await assert.rejects(f.coordinator.prepare(id, { ...f.query(), packageId: 'other' }), { code: 'INVALID_TRANSACTION' });
    await f.coordinator.cancel(id); await assert.rejects(f.coordinator.confirm(id), { code: 'CANCELLED' });
    const another = randomUUID(); await f.coordinator.prepare(another, f.query()); await f.coordinator.close();
    await assert.rejects(f.coordinator.confirm(another), { code: 'CANCELLED' });
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('cancel between confirm admission and transaction start aborts the original proposal', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query()); const gate = f.blockTarget();
    const confirmation = f.coordinator.confirm(id); const settled = Promise.allSettled([confirmation]); await gate.entered;
    let cancelError: unknown;
    try { await f.coordinator.cancel(id); } catch (error) { cancelError = error; } finally { gate.release(); }
    const results = await settled; assert.equal(cancelError, undefined);
    const result = results[0]; assert.ok(result?.status === 'rejected'); assert.equal((result.reason as { code: string }).code, 'CANCELLED');
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('revocation during awaited product validation is rechecked before receipt commit', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query());
    f.onValidation(async count => { if (count === 4) f.record.keys[0]!.revoked = true; });
    await assert.rejects(f.coordinator.confirm(id));
    assert.ok(f.counters().validations >= 4); await absent(path.join(f.gameDir, 'mods', 'fixture.jar'));
    assert.equal(await f.store.receipts.read(f.instanceId), undefined); assert.equal((await f.store.journals.read(id))?.data.phase, 'rolledBack');
  } finally { await f.close(); }
});

test('external filesystem changes after prepare are retained and invalidate confirmation', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query());
    await mkdir(path.join(f.gameDir, 'mods')); await writeFile(path.join(f.gameDir, 'mods', 'player.jar'), 'player-owned');
    await assert.rejects(f.coordinator.confirm(id), oneOf('FILES_CHANGED'));
    assert.equal(await readFile(path.join(f.gameDir, 'mods', 'player.jar'), 'utf8'), 'player-owned');
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('product validator rejection and active session prevent trusted release execution', windows, async () => {
  for (const refusal of ['validator', 'busy'] as const) {
    const f = await fixture();
    try {
      const id = randomUUID(); await f.coordinator.prepare(id, f.query());
      if (refusal === 'validator') f.reject(); else f.busy();
      await assert.rejects(f.coordinator.confirm(id));
      await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
    } finally { await f.close(); }
  }
});

test('failed identities release active capacity but retain bounded same-input failure and reject changed input', windows, async () => {
  const f = await fixture(true, { maxActiveRequests: 2, maxSeenRequests: 24 });
  try {
    const ids = Array.from({ length: 24 }, () => randomUUID());
    for (const id of ids) await assert.rejects(f.coordinator.prepare(id, f.query()), { code: 'UNTRUSTED_DISTRIBUTION' });
    await assert.rejects(f.coordinator.prepare(randomUUID(), f.query()), { code: 'EXECUTION_IDENTITY_LIMIT' });
    await assert.rejects(f.coordinator.prepare(ids[0]!, f.query()), { code: 'UNTRUSTED_DISTRIBUTION' });
    await assert.rejects(f.coordinator.confirm(ids[0]!), { code: 'UNTRUSTED_DISTRIBUTION' });
    await assert.rejects(f.coordinator.prepare(ids[0]!, { ...f.query(), packageId: 'different' }), { code: 'INVALID_TRANSACTION' });
    assert.deepEqual(f.counters(), { validations: 0, targetReads: 0, fetches: 0 });
  } finally { await f.close(); }
});

test('TTL releases a ready slot without allowing expired identity to fetch or execute again', windows, async () => {
  const f = await fixture(false, { maxActiveRequests: 1, maxSeenRequests: 8, proposalTtlMs: 20 });
  try {
    const first = randomUUID(); const second = randomUUID(); await f.coordinator.prepare(first, f.query());
    await assert.rejects(f.coordinator.prepare(second, f.query()), { code: 'EXECUTION_ACTIVE_LIMIT' });
    f.advance(20); await f.coordinator.prepare(second, f.query()); const before = f.counters();
    for (const id of [first, first]) await assert.rejects(f.coordinator.prepare(id, f.query()), { code: 'EXECUTION_REQUEST_EXPIRED' });
    await assert.rejects(f.coordinator.confirm(first), { code: 'EXECUTION_REQUEST_EXPIRED' });
    await assert.rejects(f.coordinator.prepare(first, { ...f.query(), packageVersion: 'other' }), { code: 'INVALID_TRANSACTION' });
    assert.deepEqual(f.counters(), before);
    await f.coordinator.cancel(second); await assert.rejects(f.coordinator.prepare(second, f.query()), { code: 'CANCELLED' });
    await f.coordinator.prepare(randomUUID(), f.query()); await absent(path.join(f.gameDir, 'mods', 'fixture.jar'));
  } finally { await f.close(); }
});

test('expired unresolved work still consumes the active budget until its underlying job settles', windows, async () => {
  const f = await fixture(false, { maxActiveRequests: 1, maxSeenRequests: 8, proposalTtlMs: 20 });
  try {
    const id = randomUUID(); const gate = f.blockTarget(); const first = f.coordinator.prepare(id, f.query());
    const failed = assert.rejects(first, { code: 'EXECUTION_REQUEST_EXPIRED' }); await gate.entered; f.advance(20);
    try { await assert.rejects(f.coordinator.prepare(randomUUID(), f.query()), { code: 'EXECUTION_ACTIVE_LIMIT' }); }
    finally { gate.release(); }
    await failed; assert.equal(f.counters().fetches, 0, 'expired build must not start a late network request');
    await f.coordinator.prepare(randomUUID(), f.query());
  } finally { await f.close(); }
});

test('in-flight duplicate preparation shares one effect and cancelled requests free slots beyond the former sixteen limit', windows, async () => {
  const f = await fixture(false, { maxActiveRequests: 2, maxSeenRequests: 32 });
  try {
    const id = randomUUID(); const gate = f.blockTarget(); const first = f.coordinator.prepare(id, f.query()); await gate.entered;
    const duplicate = f.coordinator.prepare(id, f.query()); gate.release();
    const [one, two] = await Promise.all([first, duplicate]); assert.deepEqual(one, two); assert.equal(f.counters().fetches, 1);
    await f.coordinator.cancel(id);
    for (let index = 0; index < 20; index++) { const next = randomUUID(); await f.coordinator.prepare(next, f.query()); await f.coordinator.cancel(next); }
    await assert.rejects(f.coordinator.prepare(id, f.query()), { code: 'CANCELLED' });
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar'));
  } finally { await f.close(); }
});

test('unknown validator errors become small stable failures and cannot rerun the same identity after recovery', windows, async () => {
  const f = await fixture(false, { maxActiveRequests: 1, maxSeenRequests: 8 });
  try {
    const id = randomUUID(); f.reject(); await assert.rejects(f.coordinator.prepare(id, f.query()), { code: 'EXECUTION_REQUEST_FAILED' });
    const before = f.counters(); f.allow();
    await assert.rejects(f.coordinator.prepare(id, f.query()), { code: 'EXECUTION_REQUEST_FAILED' }); assert.deepEqual(f.counters(), before);
    const another = randomUUID(); await f.coordinator.prepare(another, f.query()); await f.coordinator.cancel(another);
  } finally { await f.close(); }
});

test('close is idempotent, cancels pre-transaction confirmation and drains its delayed target read', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query()); const gate = f.blockTarget();
    const confirmation = f.coordinator.confirm(id); const rejected = assert.rejects(confirmation, { code: 'CANCELLED' }); await gate.entered;
    const closing = f.coordinator.close(); assert.equal(f.coordinator.close(), closing); let done = false; void closing.then(() => { done = true; });
    await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(done, false, 'close cannot release the store before pending work settles');
    gate.release(); await rejected; await closing;
    await assert.rejects(f.coordinator.prepare(randomUUID(), f.query()), { code: 'CANCELLED' });
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('replacing an empty game directory namespace after prepare invalidates the unchanged-looking proposal', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query());
    const retained = path.join(f.directory, 'retained-original-game'); await rename(f.gameDir, retained); await mkdir(f.gameDir);
    await assert.rejects(f.coordinator.confirm(id), { code: 'FILES_CHANGED' });
    assert.deepEqual(await readdir(f.gameDir), []); assert.deepEqual(await readdir(retained), []);
    assert.equal(await f.store.receipts.read(f.instanceId), undefined);
  } finally { await f.close(); }
});

test('completed identities retain read-only confirmation under the total identity limit without retaining proposal capability', windows, async () => {
  const f = await fixture(false, { maxActiveRequests: 1, maxSeenRequests: 1 });
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query()); const committed = await f.coordinator.confirm(id);
    await assert.rejects(f.coordinator.prepare(randomUUID(), f.query()), { code: 'EXECUTION_IDENTITY_LIMIT' });
    const results = await Promise.all(Array.from({ length: 20 }, () => f.coordinator.confirm(id)));
    for (const value of results) assert.deepEqual(value, committed);
    await assert.rejects(f.coordinator.prepare(id, f.query()), { code: 'EXECUTION_REQUEST_FINISHED' });
    await assert.rejects(f.coordinator.prepare(id, { ...f.query(), packageId: 'other' }), { code: 'INVALID_TRANSACTION' });
    await assert.rejects(f.coordinator.cancel(id), { code: 'CANCEL_TOO_LATE' });
    assert.equal((await f.store.receipts.read(f.instanceId))?.revision, 1);
  } finally { await f.close(); }
});

test('close also drains a preparation whose trusted target port is still pending', windows, async () => {
  const f = await fixture();
  try {
    const id = randomUUID(); const gate = f.blockTarget(); const preparation = f.coordinator.prepare(id, f.query());
    const rejected = assert.rejects(preparation, { code: 'CANCELLED' }); await gate.entered;
    let closed = false; const closing = f.coordinator.close().then(() => { closed = true; });
    await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(closed, false);
    gate.release(); await rejected; await closing; assert.equal(f.counters().fetches, 0);
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar'));
  } finally { await f.close(); }
});

test('cancellation signal reaches a pending preparation validator without releasing its unfinished work', windows, async () => {
  const f = await fixture(); let entered!: () => void; let release!: () => void;
  const inValidator = new Promise<void>(resolve => { entered = resolve; }); const exited = new Promise<void>(resolve => { release = resolve; });
  let observed: AbortSignal | undefined;
  f.onValidation(async (_count, signal) => { observed = signal; entered(); await exited; });
  const id = randomUUID(); const preparing = f.coordinator.prepare(id, f.query());
  const rejected = assert.rejects(preparing, { code: 'CANCELLED' });
  try {
    await inValidator; await f.coordinator.cancel(id);
    assert.ok(observed, 'validate must receive the request signal'); assert.equal(observed.aborted, true);
  } finally { release(); await rejected; await f.close(); }
});

test('close aborts validator work but drains its actual settlement before the store can close', windows, async () => {
  const f = await fixture(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
  let observed: AbortSignal | undefined; let aborted = false;
  f.onValidation(async (_count, signal) => {
    observed = signal; const abort = (): void => { aborted = true; }; signal?.addEventListener('abort', abort, { once: true });
    enter(); try { await settled; } finally { signal?.removeEventListener('abort', abort); }
  });
  const pending = f.coordinator.prepare(randomUUID(), f.query()); const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  let closing: Promise<void> | undefined;
  try {
    await entered; let done = false; closing = f.coordinator.close(); void closing.then(() => { done = true; });
    assert.ok(observed); assert.equal(observed.aborted, true); assert.equal(aborted, true);
    await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(done, false, 'abort is not worker exit acknowledgement');
  } finally { release(); await rejected; await closing; await f.close(); }
});

test('cancel during the authority read prevents a late validator from starting', windows, async () => {
  const f = await fixture(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
  const read = f.store.readAcceptedRelease.bind(f.store);
  f.store.readAcceptedRelease = async scope => { enter(); await settled; return read(scope); };
  const id = randomUUID(); const pending = f.coordinator.prepare(id, f.query()); const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  try { await entered; await f.coordinator.cancel(id); }
  finally { release(); await rejected; }
  try {
    assert.equal(f.counters().validations, 0); assert.equal(await f.store.journals.read(id), undefined);
  } finally { await f.close(); }
});

test('transaction-local cancellation reaches the final domain validator and rolls back published bytes', windows, async () => {
  const f = await fixture(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
  let observed: AbortSignal | undefined;
  f.onValidation(async (_count, signal) => {
    try { await readFile(path.join(f.gameDir, 'mods', 'fixture.jar')); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return; throw error; }
    observed = signal; enter(); await settled;
  });
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query()); const pending = f.coordinator.confirm(id);
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    try {
      await entered; await f.coordinator.cancel(id);
      assert.ok(observed, 'the last validate must receive the transaction combined signal'); assert.equal(observed.aborted, true);
    } finally { release(); await rejected; }
    assert.equal((await f.store.journals.read(id))?.data.phase, 'rolledBack');
    assert.equal(await f.store.receipts.read(f.instanceId), undefined);
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); await absent(path.join(f.gameDir, 'oucl.session.lock'));
    assert.equal(await readFile(path.join(f.gameDir, '.oucl-distribution-staging', id, '0.rollback'), 'utf8'), 'synthetic-text-fixture');
  } finally { release(); await f.close(); }
});

test('coordinator cancellation reaches artifact work through the transaction combined signal', windows, async () => {
  const f = await fixture(); let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
  let observed: AbortSignal | undefined;
  f.onArtifact(async signal => { observed = signal; enter(); await settled; });
  try {
    const id = randomUUID(); await f.coordinator.prepare(id, f.query()); const pending = f.coordinator.confirm(id);
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    try { await entered; await f.coordinator.cancel(id); assert.ok(observed); assert.equal(observed.aborted, true); }
    finally { release(); await rejected; }
    assert.equal(await f.store.journals.read(id), undefined); assert.equal(await f.store.receipts.read(f.instanceId), undefined);
    await absent(path.join(f.gameDir, 'mods', 'fixture.jar')); await absent(path.join(f.gameDir, 'oucl.session.lock'));
  } finally { release(); await f.close(); }
});
