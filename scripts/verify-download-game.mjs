import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { clearInterval, setInterval } from 'node:timers';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';
import { CatalogService } from '../.test-build/src/services/catalog/service.js';
import { OfficialMetadataReader } from '../.test-build/src/services/catalog/transport.js';
import { InstallMetadataService } from '../.test-build/src/services/catalog/install-metadata.js';
import { InstallerService, restoreInstallMetadata } from '../.test-build/src/services/install/installer.js';
import { planGameLayout } from '../.test-build/src/core/path/layout.js';
import { ObjectStore } from '../.test-build/src/services/objects/store.js';
import { HashPool } from '../.test-build/src/services/workers/hash-pool.js';

// Dedicated retained validation data, never a user's existing game directory.
assert.ok(process.argv[2] === undefined || process.argv[2] === 'retry');
const dataKey = 'download-regression';
const directory = path.resolve('.test-build', dataKey);
const dataDirectory = path.join(directory, 'games');
const metadataDirectory = path.join(directory, 'metadata');
const evidence = 'docs/validation/DOWNLOADS-main/game';
await mkdir(dataDirectory, { recursive: true }); await mkdir(metadataDirectory, { recursive: true }); await mkdir(evidence, { recursive: true });
const space = await statfs(directory);
assert.ok(space.bavail * space.bsize > 3 * 1024 ** 3, 'INSUFFICIENT_VALIDATION_SPACE');
const entry = new URL('../.test-build/src/services/workers/entry.js', import.meta.url);
if (dataKey === 'official-game-retry') {
  // Fresh validation installation, independent metadata/root identity. Preserve the failed owner's evidence.
  await cp('docs/validation/A1-08-official-install/official-install.json', 'docs/validation/A1-08-official-install/initial-install.json', { errorOnExist: true, force: false });
  await mkdir(path.join(dataDirectory, 'store'));
  await cp(path.resolve('.test-build/official-game/games/store/objects'), path.join(dataDirectory, 'store', 'objects'), { recursive: true, dereference: false, errorOnExist: true, force: false });
}
let storage; let service; let timer; let taskId; let instanceId; let report;
let interrupted = false; const started = Date.now();
const interrupt = () => { interrupted = true; };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
try {
  storage = await StorageClient.open(entry, metadataDirectory);
  let installation = await storage.readInstallation();
  if (!installation) installation = await storage.createInstallation({ rootId: randomUUID(), dataDirectory });
  assert.equal(installation.data.dataDirectory, dataDirectory);
  const rootId = installation.data.rootId;
  if (dataKey === 'official-game-retry') {
    const hashes = new HashPool(entry); let objects;
    try { objects = await ObjectStore.open(path.join(dataDirectory, 'store'), storage, hashes); await objects.rebuildIndex(); }
    finally { await objects?.close(); await hashes.close(); }
  }
  const reader = new OfficialMetadataReader();
  service = new InstallerService(storage, entry, new InstallMetadataService(new CatalogService(reader, storage), reader));
  await service.initialize();
  const accepted = await service.create(randomUUID(), { rootId, mcVersionId: '1.20.1', displayName: `Official validation ${new Date().toISOString()}`, isolation: 'on' });
  taskId = accepted.taskId;
  let latest;
  timer = setInterval(() => {
    if (latest) console.log(JSON.stringify({ state: latest.task.execution.state, phase: latest.stage, bytesDone: latest.task.execution.bytesDone }));
  }, 10000);
  for (;;) {
    latest = await service.task(rootId, taskId);
    const state = latest.task.execution.state;
    if (['completed', 'failed', 'cancelled', 'needsRecovery'].includes(state)) break;
    if (interrupted || Date.now() - started > 30 * 60 * 1000) { await service.cancel(rootId, taskId); throw new Error('VALIDATION_INTERRUPTED'); }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(latest.task.execution.state, 'completed', 'INSTALL_NOT_COMPLETED');
  instanceId = latest.instance.instanceId;
  const record = await storage.readInstance(instanceId); assert.ok(record && record.data.phase === 'ready');
  const prepared = restoreInstallMetadata(record.data);
  const jarId = prepared.version.jarVersionId === prepared.version.id ? instanceId : `dep-${prepared.version.client.sha1}`;
  const layout = planGameLayout({ dataDirectory, rootId, instanceId, mcVersionId: '1.20.1', directoryId: instanceId, versionRecordId: instanceId,
    jar: { directoryId: jarId, versionRecordId: jarId }, isolation: { globalDefault: true, instance: 'on', pack: false } });
  assert.deepEqual(JSON.parse(await readFile(layout.instanceJson, 'utf8')), record);
  report = { status: 'PASS', fixture: false, gameLaunched: false, packagedPayload: false, versionId: '1.20.1', rootId, taskId, instanceId,
    dataKey, artifacts: prepared.plan.artifacts.length, totalBytes: prepared.plan.totalBytes, receipts: record.data.receipts.length,
    privateNativesPublished: true, localManifestMatchesRecord: true, dataRetainedForLaunchValidation: true };
} catch (error) {
  report = { status: 'FAIL', fixture: false, gameLaunched: false, packagedPayload: false, versionId: '1.20.1', taskId, instanceId,
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INSTALL_VERIFICATION_FAILED' };
  process.exitCode = 1;
} finally {
  clearInterval(timer); await service?.close(); await storage?.close();
  process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
}
report.timestamp = new Date().toISOString(); report.durationMs = Date.now() - started;
await writeFile(path.join(evidence, 'official-install.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));

