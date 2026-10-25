import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';
import { InstallerService } from '../.test-build/src/services/install/installer.js';
import { OfficialMetadataReader } from '../.test-build/src/services/catalog/transport.js';
import { CatalogService } from '../.test-build/src/services/catalog/service.js';
import { InstallMetadataService } from '../.test-build/src/services/catalog/install-metadata.js';
import { ProfileService } from '../.test-build/src/services/launch/profiles.js';
import { JavaRuntimeService, JAVA_INDEX, isJavaMetadataUrl, parseJavaPackage } from '../.test-build/src/services/java/runtime.js';
const root = await mkdtemp(path.resolve('.test-build/official-java-'));
const metadata = path.join(root, 'metadata'), games = path.join(root, 'games'); await mkdir(metadata); await mkdir(games);
const entry = new URL('../.test-build/src/services/workers/entry.js', import.meta.url);
const evidence = path.resolve('docs/validation/BOOTSTRAP-0.2.1'); await mkdir(evidence, { recursive: true });
const report = { status: 'RUNNING', root: path.relative(process.cwd(), root), samples: [] };
let storage, installer, profiles;
const make = storage => { const reader = new OfficialMetadataReader(); return new InstallerService(storage, entry, new InstallMetadataService(new CatalogService(reader, storage), reader)); };
try {
  storage = await StorageClient.open(entry, metadata); await storage.createInstallation({ rootId: randomUUID(), dataDirectory: games });
  installer = make(storage); profiles = new ProfileService(storage);
  const service = new JavaRuntimeService(profiles, installer, undefined, undefined, {});
  for (const major of (process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [17])) {
    const start = Date.now(); console.log(`Preparing official Java ${major}, no discovered system candidates`);
    const java = await service.ensure(major, randomUUID(), new globalThis.AbortController().signal); assert.equal(java.major, major);
    const reader = new OfficialMetadataReader(fetch, isJavaMetadataUrl); const index = JSON.parse((await reader.read(JAVA_INDEX)).body);
    const component = { 8: 'jre-legacy', 17: 'java-runtime-gamma', 21: 'java-runtime-delta' }[major]; const info = index['windows-x64'][component][0].manifest;
    const pack = parseJavaPackage(JSON.parse((await reader.read(info.url, info.sha1)).body), info.sha1);
    const directory = path.dirname(path.dirname(java.executable)); let bytes = 0;
    for (const file of pack.files) {
      const content = await readFile(path.join(directory, file.relative)); assert.equal(content.length, file.spec.expected.size);
      assert.equal(createHash('sha1').update(content).digest('hex'), file.spec.expected.digest); bytes += content.length;
    }
    report.samples.push({ major, measuredVersion: java.version, vendor: java.vendor, files: pack.files.length, bytes, elapsedMs: Date.now() - start, manifestSha1: info.sha1, independentFileHashes: true });
    console.log(JSON.stringify(report.samples.at(-1))); await writeFile(path.join(evidence, 'official-java.json'), JSON.stringify(report, null, 2));
  }
  const before = await profiles.list(); await profiles.close(); await installer.close(); installer = undefined; await storage.close();
  storage = await StorageClient.open(entry, metadata); installer = make(storage); profiles = new ProfileService(storage);
  const offline = new JavaRuntimeService(profiles, installer, { read: async () => { throw new Error('NETWORK_MUST_NOT_BE_USED'); } }, undefined, {});
  for (const sample of report.samples) assert.equal((await offline.ensure(sample.major, randomUUID(), new globalThis.AbortController().signal)).major, sample.major);
  assert.deepEqual((await profiles.list()).accounts, before.accounts);
  report.status = 'PASS'; report.normalReopenWithoutNetwork = true;
} catch (error) { report.status = 'FAIL'; report.code = error.code ?? error.message; console.error(error); process.exitCode = 1; }
finally { await profiles?.close(); await installer?.close(); await storage?.close(); await writeFile(path.join(evidence, 'official-java.json'), JSON.stringify(report, null, 2)); }
