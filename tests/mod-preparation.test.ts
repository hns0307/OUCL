import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ModInstallPreparation, ModPreparationError } from '../src/services/mods/preparation.js';
import type { ModConfirmation } from '../src/services/mods/preparation.js';
import { ModArchiveReader } from '../src/services/workers/mod-archive-reader.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { HashPool } from '../src/services/workers/hash-pool.js';
import { ObjectStore } from '../src/services/objects/store.js';
import { ArtifactTransfer } from '../src/services/download/artifact-transfer.js';
import { HttpTransfer } from '../src/services/download/http.js';
import { ModrinthModClient } from '../src/services/mods/modrinth.js';
import { ModInventoryService } from '../src/services/mods/inventory.js';
import type { ModInventoryContext } from '../src/services/mods/inventory.js';
import { ModInspectionService } from '../src/services/mods/inspection.js';
import { ModLibraryReader } from '../src/services/mods/library.js';
import { modPlanDigest, modPlanInputDigest } from '../src/services/mods/plan-identity.js';
import type { ModInstallPlan, ModPayloads, ModPlanItem } from '../src/shared/contracts/mods.js';
import type { DownloadSpec } from '../src/services/download/types.js';
import { modZip } from './fixtures/mod-zip.js';

const entry = new URL('../src/services/workers/entry.js', import.meta.url);
const rootId = '00000000-0000-4000-8000-000000000001'; const instanceId = '00000000-0000-4000-8000-000000000002';
const hash = (algorithm: string, bytes: Buffer): string => createHash(algorithm).update(bytes).digest('hex');
interface Options { dependencyId?: string; dependencyVersion?: string; serverOnly?: boolean; unknownRange?: boolean; embedded?: boolean }
type RawVersion = ReturnType<typeof rawVersion>;
function rawVersion(projectId: string, versionId: string, filename: string, bytes: Buffer, dependencies: Array<{ project_id: string; version_id: string | null; file_name: null; dependency_type: string }> = []) {
  return { project_id: projectId, id: versionId, name: 'Platform display', version_number: '99.99.99-display-only', version_type: 'release',
    date_published: '2026-01-01T00:00:00Z', loaders: ['fabric'], game_versions: ['1.20.1'], environment: 'client_and_server', dependencies,
    files: [{ filename, url: `https://cdn.modrinth.com/data/${projectId}/versions/${versionId}/${filename}`, size: bytes.length, primary: true,
      hashes: { sha1: hash('sha1', bytes), sha512: hash('sha512', bytes) } }] };
}
async function setup(options: Options = {}) {
  const base = await mkdtemp(path.resolve('.test-build/mod-preparation-')); const games = path.join(base, 'games'); const metadata = path.join(base, 'metadata');
  await mkdir(games); await mkdir(metadata); await mkdir(path.join(games, 'store')); const game = path.join(games, 'private-game'); await mkdir(game);
  const context: ModInventoryContext = { instanceId, revision: 1, modsDirectory: path.join(game, 'mods'),
    environment: { loader: 'fabric', versions: { minecraft: '1.20.1', fabricloader: '0.16.14', java: '17.0.16' }, languageVersions: {} } };
  const dependencyBytes = modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: options.dependencyId ?? 'library_mod',
    version: options.dependencyVersion ?? '1.2.3', environment: options.serverOnly ? 'server' : '*',
    depends: { minecraft: options.unknownRange ? 'unsupported variable ${MC}' : '1.20.1' } })]]);
  const rootDocument = JSON.stringify({ schemaVersion: 1, id: 'root_mod', version: '1.0.0',
    depends: { minecraft: '1.20.1', fabricloader: '>=0.16.0', java: '>=17', library_mod: '>=1.2.0' },
    ...(options.embedded ? { jars: [{ file: 'META-INF/jars/library.jar' }] } : {}) });
  const rootBytes = modZip([['fabric.mod.json', rootDocument], ...(options.embedded ? [['META-INF/jars/library.jar', dependencyBytes] as [string, Buffer]] : [])]);
  const rawRoot = rawVersion('RootProj', 'RootVer1', 'root.jar', rootBytes, [
    { project_id: 'Depends1', version_id: 'DepVers1', file_name: null, dependency_type: options.embedded ? 'embedded' : 'required' },
    { project_id: 'Optional', version_id: null, file_name: null, dependency_type: 'optional' },
  ]);
  const rawDependency = rawVersion('Depends1', 'DepVers1', 'library.jar', dependencyBytes);
  const metadataVersions = new Map<string, RawVersion>([['RootVer1', rawRoot], ['DepVers1', rawDependency]]); const versionRequests: string[] = [];
  const platform = new ModrinthModClient(async (url, init) => {
    const parsed = new URL(String(url)); assert.equal(parsed.origin, 'https://api.modrinth.com');
    if (parsed.pathname === '/v2/version_files') {
      const body = JSON.parse(String(init?.body)) as { hashes: string[] }; const replies: Record<string, RawVersion> = {};
      for (const digest of body.hashes) for (const version of metadataVersions.values()) if (version.files.some(file => file.hashes.sha512 === digest)) replies[digest] = version;
      return new Response(JSON.stringify(replies));
    }
    const id = parsed.pathname.slice('/v2/version/'.length); assert.ok(parsed.pathname.startsWith('/v2/version/') && metadataVersions.has(id));
    versionRequests.push(id); return new Response(JSON.stringify(metadataVersions.get(id)));
  });
  const storage = await StorageClient.open(entry, metadata); await storage.createInstallation({ rootId, dataDirectory: games });
  const pool = new HashPool(entry); const objects = await ObjectStore.open(path.join(games, 'store'), storage, pool);
  const state = { requests: [] as string[], downloadHook: undefined as ((init?: RequestInit) => Promise<void>) | undefined };
  const physical = new ArtifactTransfer(new HttpTransfer(async (url, init) => {
    const address = String(url); state.requests.push(address); await state.downloadHook?.(init);
    const bytes = address.endsWith('/root.jar') ? rootBytes : dependencyBytes;
    return new Response(new Uint8Array(bytes), { headers: { 'content-length': String(bytes.length), etag: '"fixture"' } });
  }), storage, objects);
  const rootVersion = await platform.version('RootVer1'); const rootFile = rootVersion.files[0]!;
  const rootSpec: DownloadSpec = { url: rootFile.url, expected: { algorithm: 'sha1', digest: rootFile.sha1, size: rootFile.size,
    provenanceId: `modrinth:RootProj:RootVer1:${rootFile.sha1}` }, anchor: { kind: 'modrinth-version', algorithm: 'sha256', digest: rootVersion.evidence.sha256 } };
  const rootObject = await physical.run(rootSpec);
  await storage.writeResources(0, { rootId, items: [{ taskId: randomUUID(), projectId: 'RootProj', versionId: 'RootVer1', fileId: rootFile.sha1,
    filename: 'root.jar', kind: 'mod', title: 'Root', versionName: 'Display only', size: rootFile.size, downloaded: true, spec: rootSpec, object: rootObject }] });
  const scanner = new ModArchiveReader(entry); const inventory = new ModInventoryService(async () => context, scanner);
  const inspections = new ModInspectionService(async () => context, inventory, platform);
  const library = new ModLibraryReader(storage, scanner, platform);
  let requestId: string; let plan: ModInstallPlan;
  const input: ModPayloads['mods:plan'] = { instanceId, expectedRevision: 1, root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: rootFile.sha1 }, selections: {} };
  const initialItems: ModPlanItem[] = [{ projectId: 'RootProj', versionId: 'RootVer1', filename: 'root.jar', fileId: rootFile.sha1,
    sha512: rootFile.sha512, size: rootFile.size, disposition: 'library', requiredBy: [] }, ...(options.embedded ? [] : [{
    projectId: 'Depends1', versionId: 'DepVers1', filename: 'library.jar', fileId: hash('sha1', dependencyBytes), sha512: hash('sha512', dependencyBytes),
    size: dependencyBytes.length, disposition: 'download' as const, requiredBy: ['RootProj'] }])];
  async function save(items = initialItems): Promise<void> {
    const observation = await inventory.scan(instanceId, 1); requestId = randomUUID();
    const body: Omit<ModInstallPlan, 'planId'> = { formatVersion: 1, instanceId, instanceRevision: 1, fingerprint: observation.fingerprint,
      minecraft: '1.20.1', loader: 'fabric', rootVersionId: 'RootVer1', state: 'ready', attempts: 1,
      totalDownloadBytes: items.filter(item => item.disposition === 'download').reduce((sum, item) => sum + item.size, 0), items: structuredClone(items), issues: [] };
    plan = { ...body, planId: modPlanDigest(body) };
    await storage.writeModPlan(requestId, 0, { formatVersion: 1, rootId, requestId, input, payloadDigest: modPlanInputDigest(input), plan, status: 'preview' });
    state.requests = []; versionRequests.length = 0;
  }
  await save();
  const dependencies: ConstructorParameters<typeof ModInstallPreparation>[1] = { planner: { plan: async () => structuredClone(plan) },
    context: async () => context, platform, transfer: { transferResource: async (spec, _consumerId, options) => physical.run(spec, options) },
    inspections, inventory, library, scanner };
  return { base, games, metadata, game, context, storage, state, dependencyBytes, rawDependency, versionRequests, dependencies, save, initialItems,
    make: () => new ModInstallPreparation(storage, dependencies),
    confirmation: (): ModConfirmation => ({ planRequestId: requestId, planId: plan.planId, confirmed: true }),
    plan: () => structuredClone(plan),
    close: async () => { await objects.close(); await pool.close(); await storage.close(); } };
}

test('confirmed preparation uses real durable transfers and JAR workers, preserves actual versions, and writes no instance files', async () => {
  const f = await setup();
  try {
    const resourcesBefore = await f.storage.readResources(); const progress: number[] = [];
    const prepared = await f.make().prepare(f.confirmation(), randomUUID(), undefined, value => { if (value.stage === 'downloading') progress.push(value.bytesDone); });
    assert.equal(prepared.assessment.platform.state, 'satisfied'); assert.equal(prepared.files.length, 2); assert.equal(f.state.requests.length, 1);
    assert.equal(prepared.assessment.local.providers.find(mod => mod.id === 'library_mod')?.version, '1.2.3');
    assert.ok(prepared.assessment.local.providers.every(mod => mod.version !== '99.99.99-display-only'));
    assert.ok(f.versionRequests.every(id => id === 'RootVer1' || id === 'DepVers1'));
    assert.ok(progress.at(-1)! <= f.dependencyBytes.length); assert.deepEqual(await readdir(f.game), []);
    assert.deepEqual(await f.storage.readResources(), resourcesBefore);
    assert.equal((await f.storage.readModPlan(f.confirmation().planRequestId))?.data.status, 'preview');
    for (const file of prepared.files) assert.equal(hash('sha256', await readFile(path.join(f.games, 'store/objects/sha256', file.object.digest.slice(0, 2), file.object.digest))), file.object.digest);
  } finally { await f.close(); }
});

test('unconfirmed, cancelled, stale or occupied plans cannot start dependency downloads', async () => {
  const f = await setup();
  try {
    const preparation = f.make();
    await assert.rejects(preparation.prepare({ ...f.confirmation(), confirmed: false } as unknown as ModConfirmation, randomUUID()), { code: 'CONFIRMATION_REQUIRED' });
    await assert.rejects(preparation.prepare({ ...f.confirmation(), planId: '0'.repeat(64) }, randomUUID()), { code: 'REVISION_CONFLICT' });
    f.context.revision = 2; await assert.rejects(preparation.prepare(f.confirmation(), randomUUID()), { code: 'REVISION_CONFLICT' }); f.context.revision = 1;
    await writeFile(path.join(f.game, 'oucl.session.lock'), 'foreign'); await assert.rejects(preparation.prepare(f.confirmation(), randomUUID()), { code: 'INSTANCE_BUSY' });
    assert.equal(f.state.requests.length, 0);
    const saved = (await f.storage.readModPlan(f.confirmation().planRequestId))!;
    await f.storage.writeModPlan(saved.data.requestId, 1, { ...saved.data, status: 'cancelled' });
    await assert.rejects(preparation.prepare(f.confirmation(), randomUUID()), { code: 'CANCELLED' });
  } finally { await f.close(); }
});

test('enabled exact dependency reuse preserves a renamed JAR without downloading or upgrading it', async () => {
  const f = await setup();
  try {
    await mkdir(f.context.modsDirectory); const installed = path.join(f.context.modsDirectory, 'renamed-library.jar'); await writeFile(installed, f.dependencyBytes);
    await f.save(f.initialItems.map(item => item.projectId === 'Depends1' ? { ...item, disposition: 'reuse' } : item));
    const prepared = await f.make().prepare(f.confirmation(), randomUUID());
    assert.equal(prepared.files.length, 1); assert.equal(prepared.files[0]?.item.projectId, 'RootProj'); assert.equal(f.state.requests.length, 0);
    assert.deepEqual(await readFile(installed), f.dependencyBytes); assert.deepEqual(await readdir(f.context.modsDirectory), ['renamed-library.jar']);
  } finally { await f.close(); }
});

test('a disabled dependency is not reused; unknown embedded project relationships stop before duplicate downloads', async () => {
  const f = await setup();
  try {
    await mkdir(f.context.modsDirectory); const disabled = path.join(f.context.modsDirectory, 'library.jar.disabled'); await writeFile(disabled, f.dependencyBytes);
    await f.save(); assert.equal((await f.make().prepare(f.confirmation(), randomUUID())).files.length, 2);
    assert.equal(f.state.requests.length, 1); assert.deepEqual(await readFile(disabled), f.dependencyBytes);
  } finally { await f.close(); }
  const embedded = await setup({ embedded: true });
  try { await assert.rejects(embedded.make().prepare(embedded.confirmation(), randomUUID()), { code: 'MODS_UNDETERMINED' }); assert.equal(embedded.state.requests.length, 0); }
  finally { await embedded.close(); }
});

test('prospective declarations reject unsatisfied actual ranges, duplicate modIds and unknown requirements', async () => {
  for (const [options, code] of [[{ dependencyVersion: '0.1.0' }, 'MODS_INCOMPATIBLE'], [{ dependencyId: 'root_mod' }, 'MODS_INCOMPATIBLE'],
    [{ unknownRange: true }, 'MODS_UNDETERMINED'], [{ serverOnly: true }, 'MODS_INCOMPATIBLE']] as const) {
    const f = await setup(options);
    try {
      const failed = await f.make().prepare(f.confirmation(), randomUUID()).then(() => undefined, (error: unknown) => error);
      assert.ok(failed instanceof ModPreparationError); assert.equal(failed.code, code); assert.ok(failed.assessment);
      assert.deepEqual(await readdir(f.game), []);
    } finally { await f.close(); }
  }
});

test('case-insensitive filename collisions and refreshed source changes stop without overwriting an existing Mod', async () => {
  const f = await setup();
  try {
    await mkdir(f.context.modsDirectory); const file = path.join(f.context.modsDirectory, 'ROOT.jar'); await writeFile(file, f.dependencyBytes); await f.save();
    await assert.rejects(f.make().prepare(f.confirmation(), randomUUID()), { code: 'MODS_UNSAFE' });
    assert.deepEqual(await readFile(file), f.dependencyBytes); assert.equal(f.state.requests.length, 0);
    f.dependencies.planner = { plan: async () => ({ ...f.plan(), planId: '0'.repeat(64) }) };
    await assert.rejects(f.make().prepare(f.confirmation(), randomUUID()), { code: 'FILES_CHANGED' });
  } finally { await f.close(); }
});

test('fixed candidate metadata and post-download SHA512 mismatch cannot prepare untrusted bytes', async () => {
  const f = await setup();
  try {
    f.rawDependency.files[0]!.hashes.sha512 = 'f'.repeat(128);
    await assert.rejects(f.make().prepare(f.confirmation(), randomUUID()), { code: 'UNTRUSTED_METADATA' }); assert.equal(f.state.requests.length, 0);
    await f.save(f.initialItems.map(item => item.projectId === 'Depends1' ? { ...item, sha512: 'f'.repeat(128) } : item));
    await assert.rejects(f.make().prepare(f.confirmation(), randomUUID()), { code: 'UNTRUSTED_METADATA' }); assert.equal(f.state.requests.length, 1);
    assert.deepEqual(await readdir(f.game), []);
  } finally { await f.close(); }
});

test('cancelled preparation joins in-flight transfer cleanup and refuses concurrent admissions', async () => {
  const f = await setup(); let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  let cleaned = false; f.state.downloadHook = async () => { entered(); await gate; cleaned = true; };
  const abort = new AbortController(); const preparation = f.make();
  try {
    const pending = preparation.prepare(f.confirmation(), randomUUID(), abort.signal); const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    await started; await assert.rejects(preparation.prepare(f.confirmation(), randomUUID()), { code: 'SCAN_BUSY' });
    abort.abort(); assert.equal(cleaned, false); release(); await rejected; assert.equal(cleaned, true);
    assert.deepEqual(await readdir(f.game), []);
  } finally { release(); await f.close(); }
});

test('plan refusal, external file changes and unknown sessions during transfer invalidate the preparation', async () => {
  for (const change of ['cancel', 'files', 'session'] as const) {
    const f = await setup();
    try {
      f.state.downloadHook = async () => {
        if (change === 'cancel') {
          const saved = (await f.storage.readModPlan(f.confirmation().planRequestId))!;
          await f.storage.writeModPlan(saved.data.requestId, 1, { ...saved.data, status: 'cancelled' });
        } else if (change === 'files') { await mkdir(f.context.modsDirectory); await writeFile(path.join(f.context.modsDirectory, 'external.jar'), f.dependencyBytes); }
        else {
          const taskId = randomUUID(); await f.storage.writeGameSessions(0, { items: [{ rootId, taskId, spawned: true, stopTaskIds: [],
            snapshot: { sessionId: taskId, instanceId, state: 'unknown', revision: 1, startedAt: new Date().toISOString() } }] });
        }
      };
      await assert.rejects(f.make().prepare(f.confirmation(), randomUUID()), { code: change === 'cancel' ? 'CANCELLED' : change === 'files' ? 'FILES_CHANGED' : 'INSTANCE_BUSY' });
      if (change === 'files') assert.deepEqual(await readFile(path.join(f.context.modsDirectory, 'external.jar')), f.dependencyBytes);
      else assert.deepEqual(await readdir(f.game), []);
    } finally { await f.close(); }
  }
});
