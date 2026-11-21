import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';
import { CatalogService } from '../.test-build/src/services/catalog/service.js';
import { OfficialMetadataReader } from '../.test-build/src/services/catalog/transport.js';
import { InstallMetadataService } from '../.test-build/src/services/catalog/install-metadata.js';

const root = await mkdtemp(path.join(tmpdir(), 'oucl-install-plan-'));
const entry = new URL('../.test-build/src/services/workers/entry.js', import.meta.url);
let client; let report;
try {
  client = await StorageClient.open(entry, root);
  const reader = new OfficialMetadataReader(); const catalog = new CatalogService(reader, client);
  const metadata = new InstallMetadataService(catalog, reader); const samples = [];
  for (const id of ['1.21.1', '1.20.1', '1.12.2', '1.6.4']) {
    const prepared = await metadata.prepare(id, { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
    samples.push({ mcVersionId: id, javaMajor: prepared.version.javaMajor, assets: prepared.assets.objects.length,
      artifacts: prepared.plan.artifacts.length, views: prepared.plan.views.length, nativeArchives: prepared.plan.natives.length,
      classpathEntries: prepared.plan.classpath.length, totalBytes: prepared.plan.totalBytes,
      virtualAssets: prepared.assets.virtual, mapToResources: prepared.assets.mapToResources,
      assetIndexSha1: prepared.version.assetIndex.sha1, assetIndexBytes: Buffer.byteLength(prepared.assetIndexBody),
      assetIndexSourceVersion: prepared.version.assetIndexVersionId, gameDownloaded: false, gameLaunched: false });
  }
  report = { status: 'PASS', timestamp: new Date().toISOString(), source: 'Official HTTPS descriptors and SHA1-verified exact asset-index bytes', samples };
} catch (error) {
  report = { status: 'FAIL', timestamp: new Date().toISOString(), code: error && typeof error === 'object' && 'code' in error ? error.code : 'VERIFICATION_FAILED' };
  process.exitCode = 1;
} finally {
  await client?.close();
  if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('oucl-install-plan-')) await rm(root, { recursive: true, force: true });
}
await mkdir('docs/validation/A1-05-install-plan', { recursive: true });
await writeFile('docs/validation/A1-05-install-plan/official-plans.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
