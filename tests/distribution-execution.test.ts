import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DistributionExecutionCoordinator } from '../src/services/distribution/execution.js';
import { DistributionStore } from '../src/services/distribution/store.js';
import { PinnedReleaseSource } from '../src/services/distribution/release-source.js';
import { canonicalDistributionPayload } from '../src/core/distribution/manifest.js';
import type { DistributionManifest } from '../src/core/distribution/manifest.js';
import { canonicalDistributionReleasePayload } from '../src/core/distribution/release.js';
import type { DistributionReleasePayload } from '../src/core/distribution/release.js';

const windows = { skip: process.platform !== 'win32' };
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
async function fixture(empty = false) {
  const parent = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/distribution-execution-tests'); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'execution-'));
  const gameDir = path.join(directory, 'game'); const metadata = path.join(directory, 'metadata'); const artifact = path.join(directory, 'fixture-artifact');
  await mkdir(gameDir); await mkdir(metadata); await writeFile(artifact, 'synthetic-text-fixture');
  const store = await DistributionStore.open(metadata); const rootId = randomUUID(); const instanceId = randomUUID();
  let now = 1794758400000; let version = '1'; let sequence = 1; let validations = 0; let targetReads = 0; let fetches = 0; let rejectValidation = false; let idle = true;
  let validationHook: ((count: number) => Promise<void>) | undefined;
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
    isIdle: async () => idle, artifact: async () => artifact,
    validate: async () => { validations++; if (rejectValidation) throw new Error('SYNTHETIC_VALIDATOR_REJECTION'); await validationHook?.(validations); }, fetcher, now: () => now,
  });
  const query = () => ({ rootId, instanceId, sourceId: record.sourceId, packageId: 'club', packageVersion: version });
  return { directory, gameDir, store, record, coordinator, query, instanceId, fetcher, environment,
    counters: () => ({ validations, targetReads, fetches }), now: () => now, expire: () => { now = 1794762000000; },
    newer: () => { version = '2'; sequence = 2; }, reject: () => { rejectValidation = true; }, busy: () => { idle = false; },
    onValidation: (hook: (count: number) => Promise<void>) => { validationHook = hook; },
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
    await assert.rejects(f.coordinator.confirm(id), { code: 'FILES_CHANGED' });
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
