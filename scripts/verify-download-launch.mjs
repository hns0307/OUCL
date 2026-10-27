import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setInterval, clearInterval } from 'node:timers';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';
import { HashPool } from '../.test-build/src/services/workers/hash-pool.js';
import { NativeExtractor } from '../.test-build/src/services/workers/native-extractor.js';
import { ObjectStore } from '../.test-build/src/services/objects/store.js';
import { FileViewService } from '../.test-build/src/services/install/file-views.js';
import { artifactSpec } from '../.test-build/src/services/install/metadata-object.js';
import { restoreInstallMetadata } from '../.test-build/src/services/install/installer.js';
import { prepareInstanceDirectories, prepareInstanceNatives, viewTarget } from '../.test-build/src/services/install/instance-files.js';
import { planOfflineLaunch } from '../.test-build/src/core/launch/plan.js';
import { GameProcessService } from '../.test-build/src/services/launch/process.js';

// Runs only the dedicated official-game validation instance, never an arbitrary user game folder.
const executable = process.argv[2]; assert.ok(executable && path.isAbsolute(executable));
const source = JSON.parse(await readFile('docs/validation/DOWNLOADS-main/game/official-install.json', 'utf8'));
assert.equal(source.status, 'PASS'); assert.equal(source.fixture, false); assert.equal(source.versionId, '1.20.1');
assert.ok(source.dataKey === undefined || ['download-regression'].includes(source.dataKey));
const directory = path.resolve('.test-build', source.dataKey ?? 'official-game');
const entry = new URL('../.test-build/src/services/workers/entry.js', import.meta.url);
const evidence = 'docs/validation/DOWNLOADS-main/game'; await mkdir(evidence, { recursive: true });
let storage; let objects; let timer; let report; let stage = 'storage';
const hashes = new HashPool(entry); const extractor = new NativeExtractor(entry); const games = new GameProcessService();
try {
  storage = await StorageClient.open(entry, path.join(directory, 'metadata'));
  const installation = await storage.readInstallation(); assert.ok(installation && installation.data.rootId === source.rootId);
  assert.equal(installation.data.dataDirectory, path.join(directory, 'games'));
  const envelope = await storage.readInstance(source.instanceId); assert.ok(envelope && envelope.data.phase === 'ready');
  const record = envelope.data; const prepared = restoreInstallMetadata(record);
  stage = 'directories';
  const directories = await prepareInstanceDirectories(installation.data.dataDirectory, record.summary, prepared);
  assert.deepEqual(JSON.parse(await readFile(directories.layout.instanceJson, 'utf8')), envelope);
  stage = 'objects'; objects = await ObjectStore.open(directories.layout.storeDirectory, storage, hashes);
  const views = new FileViewService(directories.layout.storeDirectory, objects, hashes);
  const required = prepared.plan.views.filter(view => view.area !== 'assets' || view.path.startsWith('indexes/'));
  stage = 'dependencies'; for (const view of required) {
    const receipt = record.receipts.find(item => item.area === view.area && item.path === view.path && item.artifactId === view.artifactId); assert.ok(receipt);
    const artifact = prepared.plan.artifacts.find(item => item.artifactId === view.artifactId); const object = record.objects[view.artifactId]; assert.ok(artifact && object);
    const target = viewTarget(directories, view); await lstat(path.join(target.directory, target.relative));
    await views.materialize(target.directory, target.relative, artifactSpec(artifact), object, { mode: 'prefer-link', existing: {
      relativePath: target.relative, mode: receipt.mode, objectDigest: object.digest, size: object.size } });
  }
  stage = 'natives';
  const archives = prepared.plan.natives.map(native => {
    const object = record.objects[native.artifactId]; assert.ok(object);
    return { file: path.join(directories.layout.storeDirectory, 'objects', 'sha256', object.digest.slice(0, 2), object.digest),
      sha256: object.digest, size: object.size, exclude: native.exclude };
  });
  await prepareInstanceNatives(directories.layout.versionDirectory, archives, extractor, hashes, new globalThis.AbortController().signal);
  stage = 'plan';
  const plan = planOfflineLaunch({ version: prepared.version, layout: directories.layout, classpath: prepared.plan.classpath,
    java: { javaId: '00000000-0000-4000-8000-000000000017', major: 17, architecture: 'x64' },
    account: { gameName: 'OUCL_Test1', uuid: '00000000-0000-4000-8000-000000000001' },
    assets: prepared.assets, memoryMiB: 2048, launcherVersion: '0.2.3' });
  stage = 'spawn'; const session = await games.launch(source.instanceId, executable, 17, plan);
  report = { status: 'RUNNING', fixture: false, packagedPayload: false, versionId: '1.20.1', instanceId: source.instanceId,
    sessionId: session.sessionId, spawnObserved: true, dependenciesReverified: required.length, nativeTreeReverified: true,
    accountIsValidationFixture: true, productionAccountPolicyFrozen: false, menuVisuallyVerified: false, worldVisuallyVerified: false };
  await writeFile(path.join(evidence, 'official-launch.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  timer = setInterval(() => { console.log(JSON.stringify({ session: games.get(session.sessionId).state, milestones: games.diagnostics(session.sessionId) })); }, 10000);
  const exited = await games.wait(session.sessionId);
  report = { ...report, status: exited.state === 'exited' && exited.exitCode === 0 ? 'PASS' : 'FAIL', state: exited.state, exitCode: exited.exitCode,
    milestones: games.diagnostics(session.sessionId), timestamp: new Date().toISOString() };
  if (report.status !== 'PASS') process.exitCode = 1;
} catch (error) {
  report = { status: 'FAIL', fixture: false, packagedPayload: false, versionId: '1.20.1',
    stage, code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'LAUNCH_VERIFICATION_FAILED' }; process.exitCode = 1;
} finally {
  clearInterval(timer); await extractor.close(); await objects?.close(); await hashes.close(); await storage?.close();
}
await writeFile(path.join(evidence, 'official-launch.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
