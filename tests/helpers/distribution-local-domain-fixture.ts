import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DistributionManifest, DistributionOperation } from '../../src/core/distribution/manifest.js';
import { canonicalDistributionPayload } from '../../src/core/distribution/manifest.js';
import { canonicalDistributionReleasePayload } from '../../src/core/distribution/release.js';
import type { PlatformModVersion } from '../../src/core/mods/platform.js';
import { LocalModDomain } from '../../src/services/distribution/local-mod-domain.js';
import { DistributionExecutionCoordinator } from '../../src/services/distribution/execution.js';
import type { LocalArtifactEvidence, LocalModDomainOptions, LocalModDomainPorts } from '../../src/services/distribution/local-mod-domain-types.js';
import { loadWindowsDistributionFiles } from '../../src/services/distribution/native-files.js';
import { PinnedReleaseSource } from '../../src/services/distribution/release-source.js';
import { DistributionStore } from '../../src/services/distribution/store.js';
import { DistributionTransactionService } from '../../src/services/distribution/transaction.js';
import type { DistributionTransactionPorts } from '../../src/services/distribution/transaction.js';
import { transactionDigest } from '../../src/services/distribution/transaction-record.js';
import type { DistributionPlan } from '../../src/services/distribution/transaction-record.js';
import { ModInventoryService } from '../../src/services/mods/inventory.js';
import type { ModInventoryContext } from '../../src/services/mods/inventory.js';
import { ModArchiveReader } from '../../src/services/workers/mod-archive-reader.js';
import { modZip } from '../fixtures/mod-zip.js';

export const ROOT = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/distribution-domain-20261117-r3', 'domain', String(process.pid));
const execute = promisify(execFile);
const SOURCE_ROOT = process.env.OUCL_SOURCE_ROOT ?? process.cwd();
const ENTRY = new URL('../../src/services/workers/entry.js', import.meta.url);
const hash = (bytes: Buffer, algorithm: string): string => createHash(algorithm).update(bytes).digest('hex');
let native: Promise<ReturnType<typeof loadWindowsDistributionFiles> extends Promise<infer T> ? T : never> | undefined;
function nativeFactory() {
  native ??= (async () => {
    const output = path.join(ROOT, 'native-build'); await mkdir(output, { recursive: true });
    await execute(process.execPath, [path.join(SOURCE_ROOT, 'scripts/build-distribution-files.mjs')], { cwd: SOURCE_ROOT,
      env: { ...process.env, OUCL_BUILD_ROOT: output }, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
    return loadWindowsDistributionFiles(path.join(output, 'native'));
  })(); return native;
}
export function localJar(id = 'fixture_mod', version = '1.0.0'): Buffer {
  return modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id, version, environment: '*',
    depends: { minecraft: '1.20.1', java: '>=17', fabricloader: '>=0.16.14' } })], ['fixture.bin', 'synthetic-jar-content']]);
}
export interface FixtureArtifact { id: string; path: string; bytes: Buffer; sha256: string; permission: LocalArtifactEvidence['permission']; platform: PlatformModVersion }

/** Generated JARs and actual workers/SQLite/native IO; platform and redistribution decisions are explicit synthetic ports. */
export async function localDomainFixture(options: LocalModDomainOptions = {}) {
  await mkdir(ROOT, { recursive: true }); const base = await mkdtemp(path.join(ROOT, 'case-'));
  const gameDir = path.join(base, 'game'); const artifactsDir = path.join(base, 'artifacts'); const metadata = path.join(base, 'metadata');
  for (const directory of [gameDir, artifactsDir, metadata, path.join(gameDir, 'mods')]) await mkdir(directory);
  const rootId = randomUUID(); const instanceId = randomUUID(); let now = 1794873600000; let sequence = 0;
  const stat = await lstat(gameDir, { bigint: true }); const gameIdentity = { dev: String(stat.dev), ino: String(stat.ino) };
  const context: ModInventoryContext = { instanceId, revision: 1, modsDirectory: path.join(gameDir, 'mods'),
    environment: { loader: 'fabric', versions: { minecraft: '1.20.1', java: '17.0.1', fabricloader: '0.16.14' }, languageVersions: {} } };
  const registry = new Map<string, FixtureArtifact>(); const store = await DistributionStore.open(metadata);
  const reader = new ModArchiveReader(ENTRY); let activeScans = 0; let scans = 0; let platformMissing = false;
  let scanStarted: (() => void) | undefined; let journalOverride: LocalModDomainPorts['readJournal'] | undefined;
  let contextGate: { enter(): void; settled: Promise<void> } | undefined;
  const resolutions: Array<{ planDigest: string; index: number; sha256: string; permission: string }> = [];
  const scanner: LocalModDomainPorts['scanner'] = { read: async (file, signal) => {
    scans++; activeScans++; const work = reader.read(file, signal); const started = scanStarted; scanStarted = undefined; started?.();
    try { return await work; } finally { activeScans--; }
  } };
  const inventory = new ModInventoryService(async () => structuredClone(context), scanner);
  const ports: LocalModDomainPorts = {
    resolveLocalArtifact: async (plan, index) => {
      const operation = plan.manifest.operations[index]!; assert.ok(operation.kind === 'add' || operation.kind === 'replace');
      const entry = registry.get(operation.artifactId); assert.ok(entry);
      const binding = { planDigest: transactionDigest(plan), operationIndex: index, artifactId: operation.artifactId, sha256: operation.sha256, size: operation.size };
      resolutions.push({ planDigest: binding.planDigest, index, sha256: binding.sha256, permission: entry.permission });
      return { binding, path: entry.path, permission: entry.permission };
    },
    readContext: async () => {
      const held = contextGate; contextGate = undefined; if (held) { held.enter(); await held.settled; }
      return { rootId, gameIdentity, context: structuredClone(context) };
    }, inventory, scanner,
    readJournal: id => journalOverride ? journalOverride(id) : store.journals.read(id),
    versionsByHash: async items => {
      const result = new Map<string, PlatformModVersion>(); if (platformMissing) return result;
      for (const item of items) { const version = [...registry.values()].find(entry => entry.platform.files[0]!.sha512 === item.sha512)?.platform;
        if (version && item.sha512) result.set(item.sha512, structuredClone(version)); }
      return result;
    },
  };
  const domains = new Set<LocalModDomain>();
  function makeDomain() { const value = new LocalModDomain(ports, { ...options, now: () => now }); domains.add(value); return value; }
  const domain = makeDomain();
  async function artifact(bytes = localJar(), modId = 'fixture_mod', version = '1.0.0'): Promise<FixtureArtifact> {
    const id = `artifact-${registry.size}`; const file = path.join(artifactsDir, `${id}.jar`); await writeFile(file, bytes);
    const entry: FixtureArtifact = { id, path: file, bytes, sha256: hash(bytes, 'sha256'), permission: 'verified',
      platform: { projectId: `synthetic-${modId}`, versionId: `synthetic-${registry.size}`, name: 'Synthetic platform fixture', versionNumber: version,
        release: 'release', publishedAt: '2026-11-17T00:00:00Z', loaders: ['fabric'], gameVersions: ['1.20.1'], environment: 'client_and_server', dependencies: [],
        files: [{ filename: `${modId}.jar`, size: bytes.length, sha1: hash(bytes, 'sha1'), sha512: hash(bytes, 'sha512'), url: 'https://synthetic.invalid/fixture.jar', primary: true }],
        evidence: { url: 'https://synthetic.invalid/platform-fixture', sha256: 'e'.repeat(64) } } };
    registry.set(id, entry); return entry;
  }
  function add(entry: FixtureArtifact, file = 'managed.jar'): DistributionOperation { return { kind: 'add', area: 'mods', path: file, artifactId: entry.id, sha256: entry.sha256, size: entry.bytes.length }; }
  function plan(operations: DistributionOperation[]): DistributionPlan {
    const current = ++sequence; const manifest: DistributionManifest = { formatVersion: 1, packageId: 'fixture-pack', packageVersion: String(current),
      target: { minecraft: '1.20.1', javaMajor: 17, loader: 'fabric', loaderVersion: '0.16.14' }, operations };
    return { formatVersion: 1, txId: randomUUID(), rootId, instanceId, instanceRevision: 1, sourceId: 'fixture-source', packageId: manifest.packageId,
      packageVersion: manifest.packageVersion, sequence: current, manifestSha256: transactionDigest(manifest), manifest };
  }
  const keys = generateKeyPairSync('ed25519');
  const source = { sourceId: 'fixture-source', manifestOrigin: 'https://synthetic.invalid', manifestPathPrefix: '/releases/',
    keys: [{ keyId: 'temporary-fixture-key', spki: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), revoked: false }] };
  async function accept(input: DistributionPlan): Promise<void> {
    const payload = { releaseFormatVersion: 2 as const, sourceId: input.sourceId, packageId: input.packageId, packageVersion: input.packageVersion,
      sequence: input.sequence, issuedAt: now - 1000, expiresAt: now + 3600000, manifestSha256: hash(Buffer.from(canonicalDistributionPayload(input.manifest)), 'sha256'), manifest: input.manifest };
    const envelope = { payload, signature: { algorithm: 'ed25519', keyId: source.keys[0]!.keyId,
      value: sign(null, Buffer.from(canonicalDistributionReleasePayload(payload)), keys.privateKey).toString('base64') } };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify(envelope));
    const accepted = await new PinnedReleaseSource(source, store, { fetcher, now: () => now }).resolve({ packageId: input.packageId, packageVersion: input.packageVersion, target: input.manifest.target });
    await store.saveAcceptedRelease(accepted);
  }
  const authorizeErrors: string[] = []; let validations = 0;
  async function transaction(checkpoint?: DistributionTransactionPorts['checkpoint']) {
    return new DistributionTransactionService({ journals: store.journals, receipts: store.receipts,
      authorize: async (input, signal) => {
        const accepted = await store.readAcceptedRelease({ sourceId: input.sourceId, packageId: input.packageId }); assert.ok(accepted);
        assert.equal(accepted.envelope.payload.manifestSha256, input.manifestSha256);
        assert.ok(verify(null, Buffer.from(canonicalDistributionReleasePayload(accepted.envelope.payload)), keys.publicKey, Buffer.from(accepted.envelope.signature.value, 'base64')));
        validations++;
        try { await domain.validate(input, signal); } catch (error) { if (error instanceof Error && 'code' in error) authorizeErrors.push(String(error.code)); throw error; }
      },
      readTarget: async () => ({ rootId, instanceId, revision: 1, gameDir }), isIdle: async () => true,
      artifact: (input, index, signal) => domain.artifact(input, index, signal), canRecover: (id, token) => store.canRecover(id, token),
      createFiles: await nativeFactory(), ...(checkpoint ? { checkpoint } : {}),
    });
  }
  async function coordinator(input: DistributionPlan) {
    const accepted = await store.readAcceptedRelease({ sourceId: input.sourceId, packageId: input.packageId }); assert.ok(accepted);
    return new DistributionExecutionCoordinator({ sources: [source], store, now: () => now,
      fetcher: async () => new Response(JSON.stringify(accepted.envelope)),
      readTarget: async () => ({ rootId, instanceId, revision: 1, gameDir, environment: input.manifest.target }), isIdle: async () => true,
      validate: (plan, signal) => domain.validate(plan, signal), artifact: (plan, index, signal) => domain.artifact(plan, index, signal),
      createFiles: await nativeFactory(),
    });
  }
  return { base, gameDir, metadata, artifactsDir, context, domain, ports, store, artifact, add, plan, accept, transaction, coordinator, makeDomain,
    counts: () => ({ activeScans, scans, validations }), resolutions, authorizeErrors,
    advance: (ms: number) => { now += ms; }, noPlatform: () => { platformMissing = true; },
    overrideJournal: (read: LocalModDomainPorts['readJournal']) => { journalOverride = read; },
    nextScan: () => new Promise<void>(resolve => { scanStarted = resolve; }),
    blockContext: () => {
      let enter = (): void => {}; let release = (): void => {};
      const entered = new Promise<void>(resolve => { enter = resolve; }); const settled = new Promise<void>(resolve => { release = resolve; });
      contextGate = { enter, settled }; return { entered, release };
    },
    install: (entry: FixtureArtifact, filename: string) => copyFile(entry.path, path.join(gameDir, 'mods', filename)),
    close: async () => { await Promise.all([...domains].map(value => value.close())); assert.equal(activeScans, 0); await store.close(); },
  };
}
