import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { OfficialMetadataReader } from '../../src/services/catalog/transport.js';
import { CatalogService } from '../../src/services/catalog/service.js';
import { InstallMetadataService } from '../../src/services/catalog/install-metadata.js';
import { InstallerService } from '../../src/services/install/installer.js';
import { ResourceService } from '../../src/services/resources/service.js';
import { ModrinthModClient } from '../../src/services/mods/modrinth.js';
import { ModArchiveReader } from '../../src/services/workers/mod-archive-reader.js';
import { ModLibraryReader } from '../../src/services/mods/library.js';

// Dedicated generated root: this proof does not open existing players' metadata or instances.
const workspace = await mkdtemp(path.resolve('.test-build/mod-library-'));
const metadata = path.join(workspace, 'metadata'); const games = path.join(workspace, 'games'); await mkdir(metadata); await mkdir(games);
await writeFile('.test-build/mod-library-runtime-workspace.json', JSON.stringify({ workspace }));
const entry = path.resolve('dist/workers/entry.cjs'); const storage = await StorageClient.open(entry, metadata);
const official = new OfficialMetadataReader(); const installer = new InstallerService(storage, entry, new InstallMetadataService(new CatalogService(official, storage), official));
const resources = new ResourceService(storage, installer); const platform = new ModrinthModClient();
const reader = new ModLibraryReader(storage, new ModArchiveReader(entry), platform); const rootId = randomUUID();
try {
  await storage.createInstallation({ rootId, dataDirectory: games }); await installer.initialize(); await resources.initialize();
  for (const versionId of ['unerR5MN', 'DG5Fn9Sz', 'x7kQWVju']) {
    const version = await platform.version(versionId); const files = version.files.filter(file => file.primary);
    if (version.projectId !== 'uXXizFIs' || files.length !== 1) throw new Error('FIXED_TEST_SOURCE_MISMATCH');
    const selected = files[0]!; const input = { projectId: version.projectId, versionId, fileId: selected.sha1 };
    const task = await resources.download(randomUUID(), input); const deadline = Date.now() + 120000;
    for (;;) {
      const current = await resources.get(rootId, task.taskId); if (!current) throw new Error('TEST_TASK_MISSING');
      if (current.snapshot.state === 'completed') break;
      if (['failed', 'cancelled', 'needsRecovery'].includes(current.snapshot.state) || Date.now() > deadline) throw new Error('TEST_RESOURCE_NOT_COMPLETED');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const proof = await reader.read(input);
    console.log(JSON.stringify({ event: 'official-mod-library-verified', rootId, projectId: input.projectId, versionId,
      filename: proof.record.filename, size: proof.scan.size, sha256: proof.scan.sha256, sha512: proof.scan.sha512,
      declared: proof.scan.archives[0]?.declarations.flatMap(item => item.mods.map(mod => ({ format: item.format, id: mod.id, version: mod.version }))),
      platformVersion: proof.version.versionNumber, instanceWrites: false }));
  }
} finally { try { await resources.close(); } finally { try { await installer.close(); } finally { await storage.close(); } } }
