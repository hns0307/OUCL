import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ModTransactionService } from '../src/services/mods/transaction.js';
import { ModPreparationError } from '../src/services/mods/preparation.js';
import type { PreparedModInstall } from '../src/services/mods/preparation.js';
import { ModContractError } from '../src/shared/contracts/mods.js';
import { parseModInstallResult } from '../src/services/storage/mod-results.js';
import { ModArchiveReader } from '../src/services/workers/mod-archive-reader.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { WorkerError } from '../src/services/workers/protocol.js';
import { ModInventoryService } from '../src/services/mods/inventory.js';
import { plannedModFacts, platformFacts } from '../src/services/mods/facts.js';
import { checkLocalMods } from '../src/core/mods/check.js';
import { checkPlatformMods } from '../src/core/mods/platform.js';
import type { PlatformModVersion } from '../src/core/mods/platform.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import { modPlanDigest, modPlanInputDigest } from '../src/services/mods/plan-identity.js';
import type { ModInstallPlan, ModPayloads } from '../src/shared/contracts/mods.js';
import type { DownloadSpec } from '../src/services/download/types.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';
import { modZip } from './fixtures/mod-zip.js';
import { RecordStore } from '../src/services/storage/records.js';
import { parseInstanceRecord } from '../src/services/storage/instance-records.js';
import { assertModTransactionTransition, modTransactionRecordId, parseModTransaction } from '../src/services/storage/mod-transactions.js';
import type { ModTransaction } from '../src/services/storage/mod-transactions.js';
import { ModArchiveError } from '../src/services/mods/archive.js';
import { ModInstallTaskService } from '../src/services/mods/install-tasks.js';

const entry = process.env.OUCL_MOD_TXN_BUNDLED_WORKER === '1'
  ? pathToFileURL(path.resolve('dist/workers/entry.cjs')) : new URL('../src/services/workers/entry.js', import.meta.url);
const rootId = '00000000-0000-4000-8000-000000000001'; const instanceId = '00000000-0000-4000-8000-000000000002';
type Repository = ConstructorParameters<typeof ModTransactionService>[0];
type Dependencies = ConstructorParameters<typeof ModTransactionService>[1];
async function fixture() {
  const base = await mkdtemp(path.resolve('.test-build/mod-transaction-')); const games = path.join(base, 'games'); const metadata = path.join(base, 'metadata');
  await mkdir(games); await mkdir(metadata); const game = path.join(games, 'private-game'); await mkdir(game);
  let storage = await StorageClient.open(entry, metadata); await storage.createInstallation({ rootId, dataDirectory: games });
  const instance = modReadyInstance(rootId, instanceId); await storage.writeInstance(instanceId, 0, instance); await storage.writeInstances(0, { items: [instance.summary] });
  const context = async () => ({ instanceId, revision: (await storage.readInstance(instanceId))!.revision, modsDirectory: path.join(game, 'mods'),
    environment: { loader: 'fabric' as const, versions: { minecraft: '1.20.1', fabricloader: '0.16.14', java: '17.0.16' }, languageVersions: {} } });
  const scanner = new ModArchiveReader(entry); const inventory = new ModInventoryService(context, scanner); const initial = await inventory.scan(instanceId, 1);
  const definitions = [
    { projectId: 'RootProj', versionId: 'RootVer1', filename: 'root.jar', id: 'root_mod', depends: { library_mod: '>=1.0.0' } },
    { projectId: 'Depends1', versionId: 'DepVers1', filename: 'library.jar', id: 'library_mod', depends: {} },
  ];
  const files: PreparedModInstall['files'] = []; const versions = new Map<string, PlatformModVersion>(); const original = new Map<string, Buffer>();
  for (const [index, definition] of definitions.entries()) {
    const bytes = modZip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: definition.id, version: '1.0.0', depends: definition.depends })]]);
    const sha1 = createHash('sha1').update(bytes).digest('hex'); const sha256 = createHash('sha256').update(bytes).digest('hex'); const sha512 = createHash('sha512').update(bytes).digest('hex');
    const cache = path.join(games, 'store/objects/sha256', sha256.slice(0, 2), sha256); await mkdir(path.dirname(cache), { recursive: true }); await writeFile(cache, bytes);
    const spec: DownloadSpec = { url: `https://cdn.modrinth.com/data/${definition.projectId}/versions/${definition.versionId}/${definition.filename}`,
      expected: { algorithm: 'sha1', digest: sha1, size: bytes.length, provenanceId: `modrinth:${definition.projectId}:${definition.versionId}:${sha1}` },
      anchor: { kind: 'modrinth-version', algorithm: 'sha256', digest: 'f'.repeat(64) } };
    const scan = await scanner.read(cache);
    const item = { projectId: definition.projectId, versionId: definition.versionId, filename: definition.filename, fileId: sha1, sha512, size: bytes.length,
      disposition: index === 0 ? 'library' as const : 'download' as const, requiredBy: index === 0 ? [] : ['RootProj'] };
    files.push({ item, object: { digest: sha256, size: bytes.length, sourceKey: sourceKey(spec.expected, spec.anchor) }, spec, scan }); original.set(definition.filename, bytes);
    versions.set(sha512, { projectId: definition.projectId, versionId: definition.versionId, name: 'fixture', versionNumber: '1.0.0', release: 'release',
      publishedAt: '2026-01-01T00:00:00Z', loaders: ['fabric'], gameVersions: ['1.20.1'], environment: 'client_and_server',
      files: [{ filename: definition.filename, sha1, sha512, size: bytes.length, url: spec.url, primary: true }],
      dependencies: index === 0 ? [{ projectId: 'Depends1', versionId: 'DepVers1', filename: null, type: 'required' }] : [],
      evidence: { url: `https://api.modrinth.com/v2/version/${definition.versionId}`, sha256: 'f'.repeat(64) } });
  }
  const requestId = randomUUID(); const consumerId = randomUUID();
  const input: ModPayloads['mods:plan'] = { instanceId, expectedRevision: 1, root: { projectId: 'RootProj', versionId: 'RootVer1', fileId: files[0]!.item.fileId }, selections: {} };
  const body: Omit<ModInstallPlan, 'planId'> = { formatVersion: 1, instanceId, instanceRevision: 1, fingerprint: initial.fingerprint, minecraft: '1.20.1', loader: 'fabric',
    rootVersionId: 'RootVer1', state: 'ready', attempts: 1, totalDownloadBytes: files[1]!.item.size, items: files.map(file => file.item), issues: [] };
  const plan = { ...body, planId: modPlanDigest(body) };
  await storage.writeModPlan(requestId, 0, { formatVersion: 1, rootId, requestId, input, payloadDigest: modPlanInputDigest(input), plan, status: 'preview' });
  const facts = files.map(file => plannedModFacts(instanceId, file.item.filename, file.scan)); const environment = (await context()).environment;
  const local = checkLocalMods(facts, environment); const platform = checkPlatformMods(local.state, platformFacts(facts), environment, versions);
  assert.equal(platform.state, 'satisfied');
  const prepared: PreparedModInstall = { rootId, consumerId, planRequestId: requestId, planId: plan.planId, instanceId, instanceRevision: 1,
    fingerprint: initial.fingerprint, files, assessment: { local, platform } };
  const dependencies: Dependencies = { context, scanner, inventory };
  function repository(overrides: Partial<Repository> = {}): Repository {
    return { readInstallation: () => storage.readInstallation(), readInstance: id => storage.readInstance(id),
      writeInstance: (id, revision, data) => storage.writeInstance(id, revision, data), readInstances: () => storage.readInstances(),
      writeInstances: (revision, data) => storage.writeInstances(revision, data), readModPlan: id => storage.readModPlan(id),
      readGameSessions: () => storage.readGameSessions(), readModTransaction: id => storage.readModTransaction(id),
      writeModTransaction: (id, revision, data) => storage.writeModTransaction(id, revision, data), ...overrides };
  }
  return { base, game, games, metadata, prepared, original, instance, dependencies, repository,
    storage: () => storage,
    reopen: async () => { await storage.close(); storage = await StorageClient.open(entry, metadata); },
    make: (overrides: Partial<Repository> = {}) => new ModTransactionService(repository(overrides), dependencies),
    close: () => storage.close() };
}
async function noLease(game: string): Promise<void> { await assert.rejects(readFile(path.join(game, 'oucl.session.lock')), { code: 'ENOENT' }); }

const confirmation = (f: Awaited<ReturnType<typeof fixture>>) => ({ planRequestId: f.prepared.planRequestId, planId: f.prepared.planId, confirmed: true as const });
async function finished(service: ModInstallTaskService, taskId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = await service.get(taskId);
    if (task && ['completed', 'failed', 'cancelled', 'needsRecovery'].includes(task.execution.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('task did not settle');
}

test('confirmed executor joins duplicate requests and commits real files once with durable completion', async () => {
  const f = await fixture(); let preparations = 0;
  const service = new ModInstallTaskService(f.storage(), { prepare: async (_input, consumerId, _signal, progress) => {
    preparations++; progress?.({ stage: 'downloading', bytesDone: 5, bytesTotal: 5 });
    return { ...f.prepared, consumerId };
  } }, f.make());
  try {
    await service.initialize(); const accepted = await service.confirm(confirmation(f));
    assert.equal((await service.confirm(confirmation(f))).taskId, accepted.taskId);
    const task = await finished(service, accepted.taskId); assert.equal(task.execution.state, 'completed');
    assert.equal(task.execution.bytesDone, 5); assert.equal(preparations, 1);
    assert.equal((await f.storage().readInstance(instanceId))!.data.modCommitId, accepted.taskId);
    assert.equal((await f.storage().readModResult(accepted.taskId))!.data.state, 'completed');
    await service.close(); await f.reopen();
    const restored = new ModInstallTaskService(f.storage(), { prepare: async () => { throw new Error('NO_REPLAY'); } }, f.make());
    try { await restored.initialize(); assert.equal((await restored.get(accepted.taskId))!.execution.state, 'completed'); }
    finally { await restored.close(); }
  } finally { await service.close(); await f.close(); }
});

test('failed preparation persists bounded assessment and immutable task/plan association', async () => {
  const f = await fixture();
  const assessment = { ...f.prepared.assessment, local: { ...f.prepared.assessment.local, state: 'unsatisfied' as const,
    issues: [{ severity: 'error' as const, code: 'MISSING_DEPENDENCY', fileId: 'a'.repeat(64), modId: 'root_mod', dependencyId: 'library_mod', expected: '>=2', actual: ['1.0.0'], via: [] }] } };
  const service = new ModInstallTaskService(f.storage(), { prepare: async () => { throw new ModPreparationError('MODS_INCOMPATIBLE', assessment); } }, f.make());
  try {
    const { taskId } = await service.confirm(confirmation(f)); assert.equal((await finished(service, taskId)).execution.state, 'failed');
    const saved = (await f.storage().readModResult(taskId))!;
    assert.equal(saved.data.errorCode, 'MODS_INCOMPATIBLE'); assert.equal(saved.data.assessment!.localState, 'unsatisfied');
    assert.equal(saved.data.assessment!.issues[0]!.requirement, '>=2');
    assert.equal(saved.data.assessment!.issues[0]!.fileId, '');
    await assert.rejects(f.storage().writeModResult(taskId, saved.revision, { ...saved.data, errorCode: 'FILES_CHANGED' }), { code: 'INVALID_RECORD' });
    assert.throws(() => parseModInstallResult({ ...saved.data, path: 'private' }), { code: 'INVALID_RECORD' });
    assert.throws(() => parseModInstallResult({ ...saved.data, formatVersion: 2 }), { code: 'INVALID_RECORD' });
    assert.throws(() => parseModInstallResult({ ...saved.data, state: 'completed' }), { code: 'INVALID_RECORD' });
  } finally { try { await service.close(); } finally { await f.close(); } }
});

test('lost result acknowledgement resolves only exact durable content and restarts without replay', async () => {
  const f = await fixture(); const write = f.storage().writeModResult.bind(f.storage());
  f.storage().writeModResult = async (...args) => { await write(...args); throw new WorkerError('TIMEOUT'); };
  const service = new ModInstallTaskService(f.storage(), { prepare: async () => { throw new ModContractError('FILES_CHANGED'); } }, f.make());
  try {
    const { taskId } = await service.confirm(confirmation(f)); assert.equal((await finished(service, taskId)).execution.state, 'failed');
    assert.equal((await f.storage().readModResult(taskId))!.data.errorCode, 'FILES_CHANGED');
    await service.close(); await f.reopen();
    const restored = new ModInstallTaskService(f.storage(), { prepare: async () => { throw new Error('NO_REPLAY'); } }, f.make());
    try { await restored.initialize(); assert.equal((await restored.get(taskId))!.execution.state, 'failed'); }
    finally { await restored.close(); }
  } finally { await service.close(); await f.close(); }
});

test('executor cancellation waits for preparation cleanup and leaves no transaction or instance change', async () => {
  const f = await fixture(); let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new ModInstallTaskService(f.storage(), { prepare: async (_input, consumerId, signal) => {
    entered(); await gate; assert.equal(signal?.aborted, true); return { ...f.prepared, consumerId };
  } }, f.make());
  try {
    const accepted = await service.confirm(confirmation(f)); await started;
    let settled = false; const cancelled = service.cancel(accepted.taskId).then(() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(settled, false); release(); await cancelled;
    assert.equal((await service.get(accepted.taskId))!.execution.state, 'cancelled');
    assert.equal(await f.storage().readModTransaction(accepted.taskId), undefined);
    assert.equal((await f.storage().readInstance(instanceId))!.revision, 1);
  } finally { release(); await service.close(); await f.close(); }
});

test('executor classifies a proven rollback as failed and never replays it after restart', async () => {
  const f = await fixture();
  const transaction = new ModTransactionService(f.repository(), { ...f.dependencies, checkpoint: async point => { if (point === 'linked') throw new Error('CONTROLLED_FAILURE'); } });
  const service = new ModInstallTaskService(f.storage(), { prepare: async (_input, consumerId) => ({ ...f.prepared, consumerId }) }, transaction);
  try {
    const { taskId } = await service.confirm(confirmation(f)); assert.equal((await finished(service, taskId)).execution.state, 'failed');
    assert.equal((await f.storage().readModTransaction(taskId))!.data.phase, 'rolledBack');
    assert.equal((await f.storage().readInstance(instanceId))!.revision, 1); await noLease(f.game);
    await service.close(); await f.reopen();
    const restored = new ModInstallTaskService(f.storage(), { prepare: async () => { throw new Error('NO_REPLAY'); } }, f.make());
    try { await restored.initialize(); assert.equal((await restored.get(taskId))!.execution.state, 'failed'); }
    finally { await restored.close(); }
  } finally { await service.close(); await f.close(); }
});

test('orphan confirmation without a transaction becomes needsRecovery without running preparation', async () => {
  const f = await fixture();
  try {
    const task = await f.storage().acceptModConfirmation(f.prepared.planRequestId, f.prepared.planId, true);
    await f.reopen(); const service = new ModInstallTaskService(f.storage(), { prepare: async () => { throw new Error('NO_REPLAY'); } }, f.make());
    try {
      await service.initialize(); assert.equal((await service.get(task.taskId))!.execution.state, 'needsRecovery');
      assert.equal((await service.confirm(confirmation(f))).taskId, task.taskId);
      assert.equal((await f.storage().readInstance(instanceId))!.revision, 1);
    } finally { await service.close(); }
  } finally { await f.close(); }
});

test('executor restores completion from a real committed transaction after the final task update was absent', async () => {
  const f = await fixture();
  try {
    let task = await f.storage().acceptModConfirmation(f.prepared.planRequestId, f.prepared.planId, true);
    task = await f.storage().update(rootId, task.taskId, task.execution.revision, { ...task.execution, state: 'committing', revision: task.execution.revision + 1 });
    await f.make().commit({ ...f.prepared, consumerId: task.taskId });
    await f.reopen();
    const service = new ModInstallTaskService(f.storage(), { prepare: async () => { throw new Error('NO_REPLAY'); } }, f.make());
    try {
      assert.equal((await service.get(task.taskId))!.execution.state, 'needsRecovery'); await service.initialize();
      assert.equal((await service.get(task.taskId))!.execution.state, 'completed');
      assert.equal((await f.storage().readInstance(instanceId))!.revision, 2); await noLease(f.game);
    } finally { await service.close(); }
  } finally { await f.close(); }
});

test('commit boundary rejects cancellation and close joins the actual transaction', async () => {
  const f = await fixture(); let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const transaction = new ModTransactionService(f.repository(), { ...f.dependencies, checkpoint: async point => { if (point === 'staged') { entered(); await gate; } } });
  const service = new ModInstallTaskService(f.storage(), { prepare: async (_input, consumerId) => ({ ...f.prepared, consumerId }) }, transaction);
  try {
    const { taskId } = await service.confirm(confirmation(f)); await started;
    await assert.rejects(service.cancel(taskId), { code: 'CANCEL_TOO_LATE' });
    let closed = false; const closing = service.close().then(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(closed, false); release(); await closing;
    assert.equal((await service.get(taskId))!.execution.state, 'completed');
  } finally { release(); await service.close(); await f.close(); }
});

test('add-only transaction commits real files and unique instance proof without exposing shared cache to Mod edits', async () => {
  const f = await fixture();
  try {
    const service = f.make(); const receipt = await service.commit(f.prepared); assert.equal(receipt.phase, 'committed');
    const instance = (await f.storage().readInstance(instanceId))!;
    assert.equal(instance.revision, 2); assert.equal(instance.data.modCommitId, f.prepared.consumerId);
    assert.equal((await f.storage().readInstances())?.data.items[0]?.revision, 2); await noLease(f.game);
    assert.deepEqual(await readdir(path.join(f.game, 'mods')), ['library.jar', 'root.jar']);
    for (const [name, bytes] of f.original) assert.deepEqual(await readFile(path.join(f.game, 'mods', name)), bytes);
    const file = f.prepared.files[0]!; await writeFile(path.join(f.game, 'mods', file.item.filename), 'player edit');
    assert.deepEqual(await readFile(path.join(f.games, 'store/objects/sha256', file.object.digest.slice(0, 2), file.object.digest)), f.original.get(file.item.filename));
    assert.deepEqual(await service.commit(f.prepared), receipt); assert.equal((await f.storage().readInstance(instanceId))?.revision, 2);
  } finally { await f.close(); }
});

test('mid-publication failure rolls back only owned files and retains all recovery materials', async () => {
  const f = await fixture(); f.dependencies.checkpoint = async point => { if (point === 'linked') throw new Error('injected failure'); };
  try {
    await assert.rejects(f.make().commit(f.prepared), { code: 'SCAN_FAILED' });
    assert.deepEqual(await readdir(path.join(f.game, 'mods')), []); await noLease(f.game);
    assert.equal((await f.storage().readInstance(instanceId))?.revision, 1);
    const receipt = (await f.storage().readModTransaction(f.prepared.consumerId))!; assert.equal(receipt.data.phase, 'rolledBack');
    const retained = await readdir(path.join(f.game, '.oucl-mod-staging', f.prepared.consumerId));
    assert.ok(retained.includes('root.jar') && retained.includes('library.jar') && retained.some(name => name.startsWith('rollback-')));
  } finally { await f.close(); }
});

test('an external edit to an owned new file is preserved and blocks unsafe rollback and launch', async () => {
  const f = await fixture(); f.dependencies.checkpoint = async (point, index) => {
    if (point === 'linked' && index === 0) { await writeFile(path.join(f.game, 'mods/root.jar'), 'external modification'); throw new Error('injected failure'); }
  };
  try {
    await assert.rejects(f.make().commit(f.prepared), { code: 'NEEDS_RECOVERY' });
    assert.equal(await readFile(path.join(f.game, 'mods/root.jar'), 'utf8'), 'external modification');
    assert.equal((await f.storage().readModTransaction(f.prepared.consumerId))?.data.phase, 'needsRecovery');
    assert.equal((await f.storage().readInstance(instanceId))?.revision, 1); assert.ok(await readFile(path.join(f.game, 'oucl.session.lock')));
    await assert.rejects(f.make().recover(f.prepared.consumerId), { code: 'NEEDS_RECOVERY' });
    assert.equal(await readFile(path.join(f.game, 'mods/root.jar'), 'utf8'), 'external modification');
  } finally { await f.close(); }
});

test('foreign replacement and renamed files are retained while remaining owned additions are rolled back', async () => {
  const f = await fixture(); f.dependencies.checkpoint = async (point, index) => {
    if (point === 'linked' && index === 0) {
      await rename(path.join(f.game, 'mods/root.jar'), path.join(f.game, 'mods/player-renamed.jar'));
      await writeFile(path.join(f.game, 'mods/root.jar'), 'foreign replacement');
    }
  };
  try {
    await assert.rejects(f.make().commit(f.prepared), { code: 'FILES_CHANGED' });
    assert.equal(await readFile(path.join(f.game, 'mods/root.jar'), 'utf8'), 'foreign replacement');
    assert.deepEqual(await readFile(path.join(f.game, 'mods/player-renamed.jar')), f.original.get('root.jar'));
    await assert.rejects(readFile(path.join(f.game, 'mods/library.jar')), { code: 'ENOENT' }); await noLease(f.game);
  } finally { await f.close(); }
});

test('pre-existing player files and session owners are never overwritten or cleared', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.game, 'oucl.session.lock'), 'foreign-owner');
    await assert.rejects(f.make().commit(f.prepared), { code: 'INSTANCE_BUSY' });
    assert.equal(await readFile(path.join(f.game, 'oucl.session.lock'), 'utf8'), 'foreign-owner');
    assert.equal((await f.storage().readModTransaction(f.prepared.consumerId))?.data.phase, 'rolledBack');
  } finally { await f.close(); }
  const collision = await fixture();
  try {
    await mkdir(path.join(collision.game, 'mods')); await writeFile(path.join(collision.game, 'mods/root.jar'), 'player file');
    await assert.rejects(collision.make().commit(collision.prepared), { code: 'FILES_CHANGED' });
    assert.equal(await readFile(path.join(collision.game, 'mods/root.jar'), 'utf8'), 'player file'); await noLease(collision.game);
  } finally { await collision.close(); }
});

test('cancellation before the JSON commit point rolls back; interruption after it reconciles a committed result', async () => {
  for (const point of ['staged', 'linked', 'instance-published'] as const) {
    const f = await fixture(); const abort = new AbortController();
    f.dependencies.checkpoint = async current => { if (current === point) { abort.abort(); if (point === 'instance-published') throw new Error('lost acknowledgement'); } };
    try {
      if (point === 'instance-published') {
        assert.equal((await f.make().commit(f.prepared, abort.signal)).phase, 'committed');
        assert.equal((await f.storage().readInstance(instanceId))?.revision, 2);
      } else {
        await assert.rejects(f.make().commit(f.prepared, abort.signal), { code: 'CANCELLED' });
        assert.equal((await f.storage().readInstance(instanceId))?.revision, 1);
        assert.equal((await f.storage().readModTransaction(f.prepared.consumerId))?.data.phase, 'rolledBack');
      }
      await noLease(f.game);
    } finally { await f.close(); }
  }
});

test('lost instance and journal acknowledgements reconcile from exact JSON proof without double publication', async () => {
  const f = await fixture();
  try {
    const service = f.make({ writeInstance: async (id, revision, data) => { await f.storage().writeInstance(id, revision, data); throw new WorkerError('TIMEOUT'); },
      writeModTransaction: async (id, revision, data) => { await f.storage().writeModTransaction(id, revision, data); throw new WorkerError('TIMEOUT'); } });
    assert.equal((await service.commit(f.prepared)).phase, 'committed');
    assert.equal((await f.storage().readInstance(instanceId))?.revision, 2); await noLease(f.game);
  } finally { await f.close(); }
});

test('cancellation during source verification joins the worker boundary and does not start a staged copy', async () => {
  const f = await fixture(); const scanner = f.dependencies.scanner;
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  f.dependencies.scanner = { read: async (file, signal) => {
    entered(); await gate; if (signal?.aborted) throw new ModArchiveError('CANCELLED'); return scanner.read(file, signal);
  } };
  const abort = new AbortController();
  try {
    const pending = f.make().commit(f.prepared, abort.signal); const cancelled = assert.rejects(pending, { code: 'CANCELLED' });
    await started; abort.abort(); release(); await cancelled;
    assert.deepEqual(await readdir(path.join(f.game, '.oucl-mod-staging', f.prepared.consumerId)), []); await noLease(f.game);
  } finally { release(); await f.close(); }
});

test('recovery finishes a published instance after index failure using its unique commit ID', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.make({ writeInstances: async () => { throw new WorkerError('TIMEOUT'); } }).commit(f.prepared), { code: 'NEEDS_RECOVERY' });
    assert.equal((await f.storage().readInstance(instanceId))?.data.modCommitId, f.prepared.consumerId);
    assert.equal((await f.storage().readInstances())?.data.items[0]?.revision, 1);
    await f.reopen(); assert.equal((await f.make().recover(f.prepared.consumerId)).phase, 'committed');
    assert.equal((await f.storage().readInstances())?.data.items[0]?.revision, 2); await noLease(f.game);
  } finally { await f.close(); }
});

test('interrupted pre-commit work recovers by rolling back owned files after a real storage restart', async () => {
  const f = await fixture(); let unavailable = false;
  f.dependencies.checkpoint = async point => { if (point === 'linked') { unavailable = true; throw new Error('interrupted'); } };
  try {
    await assert.rejects(f.make({ readInstance: async id => { if (unavailable) throw new WorkerError('WORKER_FAILED'); return f.storage().readInstance(id); } }).commit(f.prepared), { code: 'NEEDS_RECOVERY' });
    assert.ok((await readdir(path.join(f.game, 'mods'))).includes('root.jar'));
    await f.reopen(); assert.equal((await f.make().recover(f.prepared.consumerId)).phase, 'rolledBack');
    assert.deepEqual(await readdir(path.join(f.game, 'mods')), []); await noLease(f.game);
  } finally { await f.close(); }
});

test('transaction records reject future formats, arbitrary operations and changes to prepared evidence', async () => {
  const f = await fixture();
  try {
    const receipt = await f.make().commit(f.prepared); assert.deepEqual(parseModTransaction(receipt), receipt);
    for (const bad of [{ ...receipt, formatVersion: 2 }, { ...receipt, path: 'private' }, { ...receipt, phase: 'delete' },
      { ...receipt, files: [{ ...receipt.files[0]!, filename: '../private.jar' }] }]) assert.throws(() => parseModTransaction(bad), { code: 'INVALID_RECORD' });
    assert.throws(() => assertModTransactionTransition(receipt, { ...receipt, phase: 'applying' }), { code: 'INVALID_RECORD' });
    assert.throws(() => parseInstanceRecord({ ...f.instance, modCommitId: '../private' }), { code: 'INVALID_RECORD' });
    assert.throws(() => parseInstanceRecord({ ...f.instance, modCommitId: randomUUID(), phase: 'failed', summary: { ...f.instance.summary, state: 'failed' } }), { code: 'INVALID_RECORD' });
    await f.storage().close();
    const id = randomUUID(); const recordId = modTransactionRecordId(id); const store = await RecordStore.open(f.metadata);
    try { await store.recover(); await store.write(recordId, 0, { ...receipt, taskId: id, formatVersion: 2 }, value => value); }
    finally { await store.close(); }
    const file = path.join(f.metadata, `${recordId}.json`); const before = await readFile(file); await f.reopen();
    await assert.rejects(f.storage().readModTransaction(id), { code: 'INVALID_RECORD' });
    const next: ModTransaction = { ...receipt, taskId: id, phase: 'needsRecovery' };
    await assert.rejects(f.storage().writeModTransaction(id, 1, next), { code: 'INVALID_RECORD' }); assert.deepEqual(await readFile(file), before);
  } finally { await f.close(); }
});
