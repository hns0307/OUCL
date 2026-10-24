import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CatalogService } from '../.test-build/src/services/catalog/service.js';
import { CatalogError, OfficialMetadataReader } from '../.test-build/src/services/catalog/transport.js';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';

const root = await mkdtemp(path.join(tmpdir(), 'oucl-catalog-live-'));
const entry = new URL('../.test-build/src/services/workers/entry.js', import.meta.url);
let client;
const records = [];
let report;
try {
  client = await StorageClient.open(entry, root);
  const network = new OfficialMetadataReader();
  const reader = { async read(url, expectedSha1) {
    const document = await network.read(url, expectedSha1);
    records.push({ url, sha1: document.sha1, expectedSha1: expectedSha1 ?? null, bytes: Buffer.byteLength(document.body) });
    return document;
  } };
  const service = new CatalogService(reader, client);
  const catalog = await service.list({ channel: 'release', limit: 20 });
  const storedManifest = JSON.parse((await client.readCatalog()).data.body);
  const samples = [];
  for (const id of ['1.21.1', '1.12.2', '1.6.4', '3D Shareware v1.34']) {
    const resolved = await service.resolve(id, { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
    samples.push({ id, javaMajor: resolved.version.javaMajor, libraries: resolved.version.libraries.length,
      metadataSha1: resolved.metadataSha1, parsed: true, gameDownloaded: false, gameLaunched: false });
  }
  await client.close(); client = await StorageClient.open(entry, root);
  const offline = new CatalogService({ async read() { throw new CatalogError('CATALOG_UNAVAILABLE'); } }, client);
  const restored = await offline.list({ channel: 'release', limit: 20 });
  if (!restored.cached || restored.fetchedAt !== catalog.fetchedAt) throw new Error('CACHE_RESTORE_FAILED');
  report = { status: 'PASS', timestamp: new Date().toISOString(), fetchedAt: catalog.fetchedAt, firstPage: catalog.page.items,
    catalogEntryCount: storedManifest.versions.length, historicalNamesWithSpaces: storedManifest.versions.filter(item => item.id.includes(' ')).length,
    hasMore: !!catalog.page.nextCursor, persistedCacheRestored: true, samples, records };
} catch (error) {
  report = { status: 'FAIL', timestamp: new Date().toISOString(), code: error && typeof error === 'object' && 'code' in error ? error.code : 'VERIFICATION_FAILED', records };
  process.exitCode = 1;
} finally {
  await client?.close();
  if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('oucl-catalog-live-')) await rm(root, { recursive: true, force: true });
}
await mkdir('docs/validation/A1-05-catalog', { recursive: true });
await writeFile('docs/validation/A1-05-catalog/official-live.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, code: report.code, samples: report.samples, persistedCacheRestored: report.persistedCacheRestored }));
