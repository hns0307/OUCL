import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';
import { HashPool } from '../.test-build/src/services/workers/hash-pool.js';
import { NativeExtractor } from '../.test-build/src/services/workers/native-extractor.js';
import { CatalogService } from '../.test-build/src/services/catalog/service.js';
import { OfficialMetadataReader } from '../.test-build/src/services/catalog/transport.js';
import { InstallMetadataService } from '../.test-build/src/services/catalog/install-metadata.js';
import { HttpTransfer } from '../.test-build/src/services/download/http.js';
import { ArtifactTransfer } from '../.test-build/src/services/download/artifact-transfer.js';
import { ObjectStore } from '../.test-build/src/services/objects/store.js';
import { artifactSpec } from '../.test-build/src/services/install/metadata-object.js';

const root = await mkdtemp(path.join(tmpdir(), 'oucl-native-verify-'));
const entry = new URL('../.test-build/src/services/workers/entry.js', import.meta.url);
const pool = new HashPool(entry); const extractor = new NativeExtractor(entry);
let storage; let objects; let report;
try {
  const metadataDirectory = path.join(root, 'metadata'); const objectDirectory = path.join(root, 'store');
  await mkdir(metadataDirectory); await mkdir(objectDirectory);
  storage = await StorageClient.open(entry, metadataDirectory); objects = await ObjectStore.open(objectDirectory, storage, pool);
  const reader = new OfficialMetadataReader(); const catalog = new CatalogService(reader, storage);
  const metadata = new InstallMetadataService(catalog, reader);
  const transfer = new ArtifactTransfer(new HttpTransfer(), storage, objects); const samples = [];
  for (const versionId of ['1.20.1', '1.12.2']) {
    const prepared = await metadata.prepare(versionId, { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
    const archives = [];
    for (const native of prepared.plan.natives) {
      const artifact = prepared.plan.artifacts.find(value => value.artifactId === native.artifactId);
      if (!artifact) throw new Error('MISSING_NATIVE_ARTIFACT');
      const object = await transfer.run(artifactSpec(artifact));
      archives.push({ file: path.join(objectDirectory, 'objects', 'sha256', object.digest.slice(0, 2), object.digest),
        sha256: object.digest, size: object.size, exclude: native.exclude });
    }
    const output = path.join(root, versionId); await mkdir(output);
    const extracted = await extractor.run(output, archives);
    samples.push({ versionId, archives: archives.length, ...extracted, officialSha1Verified: true, sha256VerifiedBeforeExtraction: true, gameLaunched: false });
  }
  report = { status: 'PASS', timestamp: new Date().toISOString(), samples };
} catch (error) {
  report = { status: 'FAIL', timestamp: new Date().toISOString(), code: error && typeof error === 'object' && 'code' in error ? error.code : 'VERIFICATION_FAILED' };
  process.exitCode = 1;
} finally {
  await extractor.close(); await objects?.close(); await pool.close(); await storage?.close();
  if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('oucl-native-verify-')) await rm(root, { recursive: true, force: true });
}
await mkdir('docs/validation/A1-08-native-extraction', { recursive: true });
await writeFile('docs/validation/A1-08-native-extraction/official-natives.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
