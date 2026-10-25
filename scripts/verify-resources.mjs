import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';
import { ResourceService } from '../.test-build/src/services/resources/service.js';
import { InstallerService } from '../.test-build/src/services/install/installer.js';
import { OfficialMetadataReader } from '../.test-build/src/services/catalog/transport.js';
import { CatalogService } from '../.test-build/src/services/catalog/service.js';
import { InstallMetadataService } from '../.test-build/src/services/catalog/install-metadata.js';

const evidence = path.resolve('docs/validation/UI-0.2.0'); await mkdir(evidence, { recursive: true });
const root = await mkdtemp(path.resolve('.test-build/v02-resources-')); const metadata = path.join(root, 'metadata'); const games = path.join(root, 'games'); await mkdir(metadata); await mkdir(games);
const entry = new URL('../.test-build/src/services/workers/entry.js', import.meta.url); const rootId = randomUUID();
let storage; let installer; let resources;
const report = { timestamp: new Date().toISOString(), status: 'RUNNING', root: path.relative(process.cwd(), root), samples: [] };
const make = repository => { const reader = new OfficialMetadataReader(); return new InstallerService(repository, entry, new InstallMetadataService(new CatalogService(reader, repository), reader)); };
try {
  storage = await StorageClient.open(entry, metadata); await storage.createInstallation({ rootId, dataDirectory: games });
  installer = make(storage); resources = new ResourceService(storage, installer); await resources.initialize();
  await storage.writeSettings(0, { memoryMiB: 3072, isolationDefault: false });
  for (const kind of ['mod', 'resourcepack', 'shader']) {
    const search = await resources.client.search({ kind, query: '', gameVersion: '', loader: '', offset: 0 }); assert.ok(search.items.length);
    let selected;
    for (const project of search.items.slice(0, 5)) {
      const versions = await resources.client.versions({ projectId: project.projectId, gameVersion: '', loader: '' });
      const version = versions.items.find(v => v.files.some(f => f.size < 8 * 1024 ** 2)); if (!version) continue;
      const file = version.files.filter(f => f.size < 8 * 1024 ** 2).sort((a, b) => Number(b.primary) - Number(a.primary) || a.size - b.size)[0]; selected = { project, version, file }; break;
    }
    assert.ok(selected, `NO_SMALL_SAMPLE:${kind}`); const { project, version, file } = selected;
    const accepted = await resources.download(randomUUID(), { projectId: project.projectId, versionId: version.versionId, fileId: file.fileId });
    const deadline = Date.now() + 180000;
    let task;
    do { task = await resources.get(rootId, accepted.taskId); if (['completed', 'failed', 'cancelled', 'needsRecovery'].includes(task.snapshot.state)) break; await new Promise(resolve => setTimeout(resolve, 300)); } while (Date.now() < deadline);
    if (task.snapshot.state !== 'completed') console.log(await resources.library());
    assert.equal(task.snapshot.state, 'completed');
    const item = (await resources.library()).items.find(i => i.taskId === accepted.taskId); assert.ok(item?.downloaded);
    const local = path.join(games, 'resource-library', kind, item.taskId, item.filename); const content = await readFile(local);
    assert.equal(createHash('sha1').update(content).digest('hex'), file.fileId); assert.equal(content.length, file.size);
    report.samples.push({ kind, projectId: project.projectId, project: project.title, versionId: version.versionId, version: version.name, filename: file.filename, bytes: content.length, sha1: file.fileId, independentlyVerified: true });
    console.log(`VERIFIED ${kind}: ${project.title} (${content.length} bytes)`);
    await writeFile(path.join(evidence, 'real-resources.json'), JSON.stringify(report, null, 2));
  }
  const before = await resources.library(); await resources.close(); resources = undefined; await installer.close(); installer = undefined; await storage.close();
  storage = await StorageClient.open(entry, metadata); installer = make(storage); resources = new ResourceService(storage, installer); await resources.initialize();
  assert.deepEqual(await resources.library(), before); assert.deepEqual((await storage.readSettings()).data, { memoryMiB: 3072, isolationDefault: false });
  report.status = 'PASS'; report.workerReopenPreservesResources = true; report.workerReopenPreservesSettings = true;
} catch (error) { report.status = 'FAIL'; report.error = error.code ?? error.message; process.exitCode = 1; console.error(error); }
finally { await resources?.close(); await installer?.close(); await storage?.close(); await writeFile(path.join(evidence, 'real-resources.json'), JSON.stringify(report, null, 2)); }
