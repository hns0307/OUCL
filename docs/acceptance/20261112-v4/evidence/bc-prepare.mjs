import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const base = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(base, '../..');
const profile = path.join(base, 'profile'); const games = path.join(base, 'synthetic-games');
const manifestPath = path.join(base, 'seed.json');
try { await access(manifestPath); throw new Error('ALREADY_PREPARED: reuse existing profile; do not overwrite a GUI run'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await cp(path.join(repository, 'acceptance-results/product'), path.join(base, 'product'), { recursive: true, errorOnExist: true, force: false });
const exports = {
  StorageClient: 'src/services/workers/storage-client.ts', ModTaskService: 'src/services/mods/tasks.ts',
  ModArchiveReader: 'src/services/workers/mod-archive-reader.ts', InstalledLanguageReader: 'src/services/mods/languages.ts',
  InstalledJavaFacts: 'src/services/mods/java-facts.ts', ProfileService: 'src/services/launch/profiles.ts',
  modInventoryContext: 'src/services/mods/context.ts', ModInventoryService: 'src/services/mods/inventory.ts',
  ModInspectionService: 'src/services/mods/inspection.ts', ModrinthModClient: 'src/services/mods/modrinth.ts',
  modReadyInstance: 'tests/fixtures/mod-ready-instance.ts', modZip: 'tests/fixtures/mod-zip.ts',
  restoreInstallMetadata: 'src/services/install/installer.ts', instanceGameLayout: 'src/services/install/instance-files.ts',
  ModMaintenancePreviewService: 'src/services/mods/maintenance-preview.ts', presentMaintenancePreview: 'src/services/mods/maintenance-presentation.ts',
};
await build({ absWorkingDir: repository, stdin: { contents: Object.entries(exports).map(([name, file]) => `export {${name}} from './${file}';`).join('\n'),
  resolveDir: repository }, bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(base, 'services.cjs') });
const s = createRequire(import.meta.url)(path.join(base, 'services.cjs'));
await mkdir(path.join(profile, 'metadata'), { recursive: true }); await mkdir(games, { recursive: true });
const rootId = '40000000-0000-4000-8000-000000000001';
const ids = ['40000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003'];
const worker = path.join(base, 'product/workers/entry.cjs');
const storage = await s.StorageClient.open(worker, path.join(profile, 'metadata'));
const profiles = new s.ProfileService(storage);
const scanner = new s.ModArchiveReader(worker);
const context = s.modInventoryContext(storage, new s.InstalledLanguageReader(scanner), new s.InstalledJavaFacts(profiles));
const inventory = new s.ModInventoryService(context, scanner);
let rejectedRequests = 0;
const platform = new s.ModrinthModClient(async () => { rejectedRequests++; throw new TypeError('CONTROLLED_OFFLINE'); });
const inspections = new s.ModInspectionService(context, inventory, platform);
const tasks = new s.ModTaskService(storage, inventory, inspections);
const records = []; const output = [];
try {
  await storage.createInstallation({ rootId, dataDirectory: games });
  for (const [index, id] of ids.entries()) {
    const record = s.modReadyInstance(rootId, id);
    record.summary.displayName = index === 0 ? 'BC-A Synthetic Fabric' : 'BC-B Synthetic Fabric';
    const layout = s.instanceGameLayout(games, record.summary, s.restoreInstallMetadata(record));
    const mods = path.join(layout.gameDirectory, 'mods'); await mkdir(mods, { recursive: true });
    const prefix = index === 0 ? 'alpha' : 'beta';
    const declarations = [
      [`${prefix}-provider.jar`, { schemaVersion: 1, id: `${prefix}_provider`, version: '1.0.0', name: `${prefix} provider (synthetic)` }],
      [`${prefix}-dependent.jar`, { schemaVersion: 1, id: `${prefix}_dependent`, version: '1.0.0', name: `${prefix} dependent (synthetic)`,
        depends: { [`${prefix}_provider`]: index === 0 ? '>=1.0.0' : '>=2.0.0' } }],
      [`${prefix}-standalone.jar`, { schemaVersion: 1, id: `${prefix}_standalone`, version: '1.0.0', name: `${prefix} standalone (synthetic)` }],
    ];
    for (const [name, declaration] of declarations) await writeFile(path.join(mods, name), s.modZip([['fabric.mod.json', JSON.stringify(declaration)]]));
    await storage.writeInstance(id, 0, record); records.push(record);
  }
  await storage.writeInstances(0, { items: records.map(record => record.summary) });
  await tasks.initialize();
  for (const [index, id] of ids.entries()) {
    const requestId = randomUUID(); const accepted = await tasks.start(requestId, 'check', { instanceId: id, expectedRevision: 1 });
    const deadline = Date.now() + 30000; let report;
    while (Date.now() < deadline) {
      const status = await tasks.get(rootId, accepted.taskId);
      if (status?.snapshot.state === 'completed') { report = (await tasks.report(accepted.taskId)).report; break; }
      if (status && ['failed', 'cancelled', 'needsRecovery'].includes(status.snapshot.state)) throw new Error(`CHECK_FAILED:${status.snapshot.state}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!report) throw new Error('CHECK_DEADLINE');
    output.push({ instanceId: id, displayName: records[index].summary.displayName, requestId, taskId: accepted.taskId,
      state: report.state, localState: report.localState, report });
  }
  const preview = new s.ModMaintenancePreviewService(async (instanceId, signal) => ({ rootId, inventory: await context(instanceId, signal) }), inspections);
  const expectedPreviews = [];
  for (const item of output) for (const file of item.report.files.filter(file => /provider|standalone/.test(file.filename))) {
    const result = s.presentMaintenancePreview(await preview.preview({ rootId, instanceId: item.instanceId, expectedRevision: 1,
      expectedFingerprint: item.report.fingerprint, fileId: file.fileId, action: 'disable' }));
    expectedPreviews.push({ instanceId: item.instanceId, filename: file.filename, fileId: file.fileId, state: result.state,
      directRequiredBy: result.directRequiredBy, platformFailures: result.platformFailures });
  }
  await writeFile(manifestPath, JSON.stringify({ candidate: 'v3 / coordinator commit bc01f07; source copy has no .git', synthetic: true,
    profile, games, rootId, instances: output, expectedPreviews, rejectedRequests,
    limits: 'No Minecraft client or Java installed; JARs contain only generated JSON, never launch games. Reports from real services; network transport rejects every request.' }, null, 2));
} finally { await tasks.close(); await profiles.close(); await storage.close(); }
// A second actual worker / ModTaskService proves the persisted reports can be recovered before GUI handoff.
const reopened = await s.StorageClient.open(worker, path.join(profile, 'metadata'));
try {
  const restored = new s.ModTaskService(reopened, inventory, inspections); await restored.initialize();
  try { for (const item of output) {
    const target = await reopened.readModTargets({ rootId, rootRevision: 1, instanceId: item.instanceId, kinds: ['mod-check'] });
    if (target.items.length !== 1 || target.items[0].task.taskId !== item.taskId || !(await restored.report(item.taskId)).report) throw new Error('REOPEN_MISMATCH');
  } } finally { await restored.close(); }
} finally { await reopened.close(); }
async function hashes(directory, prefix = '') {
  const rows = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name), target = path.join(directory, item.name);
    if (item.isDirectory()) rows.push(...await hashes(target, relative));
    else rows.push({ path: relative, sha256: createHash('sha256').update(await readFile(target)).digest('hex') });
  }
  return rows;
}
await writeFile(path.join(base, 'product-manifest.json'), JSON.stringify(await hashes(path.join(base, 'product')), null, 2));
console.log(JSON.stringify({ status: 'PREPARED', profile, manifest: manifestPath, workerReopen: 'PASS', instances: output.map(({ instanceId, displayName, taskId, state }) => ({ instanceId, displayName, taskId, state })) }, null, 2));
