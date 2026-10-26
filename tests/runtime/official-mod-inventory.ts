import path from 'node:path';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { ModArchiveReader } from '../../src/services/workers/mod-archive-reader.js';
import { ModInventoryService } from '../../src/services/mods/inventory.js';
import { modInventoryContext } from '../../src/services/mods/context.js';
import { ModInspectionService } from '../../src/services/mods/inspection.js';
import { ModrinthModClient } from '../../src/services/mods/modrinth.js';
import { InstalledLanguageReader } from '../../src/services/mods/languages.js';
import { publicModReport } from '../../src/services/mods/report.js';

const workspace = path.resolve(process.env.OUCL_LOADER_TEST_WORKSPACE ?? '');
if (path.dirname(workspace) !== path.resolve('.test-build') || !/^official-loader-[A-Za-z0-9]+$/.test(path.basename(workspace))) throw new Error('INVALID_TEST_WORKSPACE');
const entry = path.resolve('dist/workers/entry.cjs'); const storage = await StorageClient.open(entry, path.join(workspace, 'metadata'));
try {
  const root = await storage.readInstallation();
  if (!root || root.data.dataDirectory !== path.join(workspace, 'games')) throw new Error('INVALID_TEST_ROOT');
  const context = modInventoryContext(storage, new InstalledLanguageReader(new ModArchiveReader(entry)));
  const service = new ModInventoryService(context, new ModArchiveReader(entry));
  const inspections = new ModInspectionService(context, service, new ModrinthModClient());
  const instances = await storage.readInstances();
  for (const instance of instances?.data.items.filter(item => item.state === 'ready') ?? []) {
    const resolved = await context(instance.instanceId);
    if (!resolved.modsDirectory.startsWith(path.join(workspace, 'games') + path.sep)) throw new Error('TEST_ROOT_ESCAPE');
    const result = await service.scan(instance.instanceId, instance.revision);
    console.log(JSON.stringify({ event: 'instance-mod-inventory', instanceId: instance.instanceId, revision: instance.revision,
      loader: resolved.environment.loader, files: result.items.length, fingerprint: result.fingerprint, local: result.local.state }));
    if (process.env.OUCL_MOD_TEST_PLATFORM === '1') {
      const inspection = await inspections.check(instance.instanceId, instance.revision);
      const report = publicModReport(inspection.inventory, inspection);
      console.log(JSON.stringify({ event: 'instance-mod-double-check', instanceId: instance.instanceId,
        local: inspection.inventory.local.state, localIssues: inspection.inventory.local.issues.map(issue => issue.code),
        state: inspection.platform.state, reportFormat: report.formatVersion, reportMode: report.mode, platformFailures: inspection.platformFailures,
        files: inspection.platform.files.map(file => ({ status: file.status, projectId: file.version?.projectId, versionId: file.version?.versionId })) }));
    }
  }
} finally { await storage.close(); }
