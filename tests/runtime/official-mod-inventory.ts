import path from 'node:path';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { ModArchiveReader } from '../../src/services/workers/mod-archive-reader.js';
import { ModInventoryService } from '../../src/services/mods/inventory.js';
import { modInventoryContext } from '../../src/services/mods/context.js';
import { ModInspectionService } from '../../src/services/mods/inspection.js';
import { ModrinthModClient } from '../../src/services/mods/modrinth.js';
import { InstalledLanguageReader } from '../../src/services/mods/languages.js';
import { publicModReport } from '../../src/services/mods/report.js';
import { ModTaskService } from '../../src/services/mods/tasks.js';
import { randomUUID } from 'node:crypto';

const workspace = path.resolve(process.env.OUCL_LOADER_TEST_WORKSPACE ?? '');
if (path.dirname(workspace) !== path.resolve('.test-build') || !/^official-loader-[A-Za-z0-9]+$/.test(path.basename(workspace))) throw new Error('INVALID_TEST_WORKSPACE');
const entry = path.resolve('dist/workers/entry.cjs'); const storage = await StorageClient.open(entry, path.join(workspace, 'metadata'));
let tasks: ModTaskService | undefined;
try {
  const root = await storage.readInstallation();
  if (!root || root.data.dataDirectory !== path.join(workspace, 'games')) throw new Error('INVALID_TEST_ROOT');
  const context = modInventoryContext(storage, new InstalledLanguageReader(new ModArchiveReader(entry)));
  const service = new ModInventoryService(context, new ModArchiveReader(entry));
  if (process.env.OUCL_MOD_TEST_TASKS_REOPEN === '1') globalThis.fetch = async () => { throw new Error('UNEXPECTED_REOPEN_NETWORK'); };
  const inspections = new ModInspectionService(context, service, new ModrinthModClient());
  if (process.env.OUCL_MOD_TEST_TASKS === '1') { tasks = new ModTaskService(storage, service, inspections); await tasks.initialize(); }
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
    if (tasks) {
      const existing = process.env.OUCL_MOD_TEST_TASKS_REOPEN === '1' ? (await storage.readModJobs())?.data.items.findLast(item => item.instanceId === instance.instanceId && item.mode === 'check') : undefined;
      if (process.env.OUCL_MOD_TEST_TASKS_REOPEN === '1' && !existing) throw new Error('MISSING_TEST_MOD_REPORT');
      const accepted = existing ?? await tasks.start(randomUUID(), 'check', { instanceId: instance.instanceId, expectedRevision: instance.revision });
      const deadline = Date.now() + 120000;
      for (;;) {
        const task = await tasks.get(root.data.rootId, accepted.taskId); if (!task) throw new Error('MISSING_TEST_MOD_TASK');
        if (task.snapshot.state === 'completed') break;
        if (['failed', 'cancelled', 'needsRecovery'].includes(task.snapshot.state)) throw new Error('TEST_MOD_TASK_FAILED');
        if (Date.now() > deadline) { await tasks.cancel(root.data.rootId, accepted.taskId); throw new Error('TEST_MOD_TASK_TIMEOUT'); }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const saved = await tasks.report(accepted.taskId); if (!saved.report) throw new Error('MISSING_TEST_MOD_REPORT');
      console.log(JSON.stringify({ event: 'instance-mod-durable-report', taskId: accepted.taskId, instanceId: instance.instanceId,
        state: saved.report.state, mode: saved.report.mode, reopened: Boolean(existing), sources: saved.report.files.map(file => file.source) }));
    }
  }
} finally { try { if (tasks) await tasks.close(); } finally { await storage.close(); } }
