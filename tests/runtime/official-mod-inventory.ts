import path from 'node:path';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { ModArchiveReader } from '../../src/services/workers/mod-archive-reader.js';
import { ModInventoryService } from '../../src/services/mods/inventory.js';
import { modInventoryContext } from '../../src/services/mods/context.js';

const workspace = path.resolve(process.env.OUCL_LOADER_TEST_WORKSPACE ?? '');
if (path.dirname(workspace) !== path.resolve('.test-build') || !/^official-loader-[A-Za-z0-9]+$/.test(path.basename(workspace))) throw new Error('INVALID_TEST_WORKSPACE');
const entry = path.resolve('dist/workers/entry.cjs'); const storage = await StorageClient.open(entry, path.join(workspace, 'metadata'));
try {
  const root = await storage.readInstallation();
  if (!root || root.data.dataDirectory !== path.join(workspace, 'games')) throw new Error('INVALID_TEST_ROOT');
  const context = modInventoryContext(storage); const service = new ModInventoryService(context, new ModArchiveReader(entry));
  const instances = await storage.readInstances();
  for (const instance of instances?.data.items.filter(item => item.state === 'ready') ?? []) {
    const resolved = await context(instance.instanceId);
    if (!resolved.modsDirectory.startsWith(path.join(workspace, 'games') + path.sep)) throw new Error('TEST_ROOT_ESCAPE');
    const result = await service.scan(instance.instanceId, instance.revision);
    console.log(JSON.stringify({ event: 'instance-mod-inventory', instanceId: instance.instanceId, revision: instance.revision,
      loader: resolved.environment.loader, files: result.items.length, fingerprint: result.fingerprint, local: result.local.state }));
  }
} finally { await storage.close(); }
