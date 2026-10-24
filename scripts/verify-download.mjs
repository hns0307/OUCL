import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { StorageClient } from '../.test-build/src/services/workers/storage-client.js';
import { HashPool } from '../.test-build/src/services/workers/hash-pool.js';
import { ObjectStore } from '../.test-build/src/services/objects/store.js';
import { sourceKey } from '../.test-build/src/services/objects/provenance.js';
import { CatalogService } from '../.test-build/src/services/catalog/service.js';
import { OfficialMetadataReader } from '../.test-build/src/services/catalog/transport.js';
import { HttpTransfer } from '../.test-build/src/services/download/http.js';
import { ArtifactTransfer } from '../.test-build/src/services/download/artifact-transfer.js';

const root = await mkdtemp(path.join(tmpdir(), 'oucl-download-live-'));
const metadata = path.join(root, 'metadata'); const objectRoot = path.join(root, 'store');
await mkdir(metadata); await mkdir(objectRoot);
const entry = new URL('../.test-build/src/services/workers/entry.js', import.meta.url);
const pool = new HashPool(entry);
let client; let objects; let report;
const requests = [];
try {
  client = await StorageClient.open(entry, metadata); objects = await ObjectStore.open(objectRoot, client, pool);
  const catalog = new CatalogService(new OfficialMetadataReader(), client);
  const resolved = await catalog.resolve('1.21.1', { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
  const artifact = resolved.version.client;
  const spec = { url: artifact.url, expected: { algorithm: 'sha1', digest: artifact.sha1, size: artifact.size,
    provenanceId: `mojang:client:${resolved.metadataSha1}:${artifact.sha1}` },
    anchor: { kind: 'mojang-version', algorithm: 'sha1', digest: resolved.metadataSha1ByVersion[resolved.version.jarVersionId] } };
  const key = sourceKey(spec.expected, spec.anchor);
  const http = new HttpTransfer(async (url, init) => {
    const headers = new globalThis.Headers(init?.headers); const response = await fetch(url, init);
    requests.push({ range: headers.get('range'), ifRange: headers.get('if-range'), status: response.status,
      etag: response.headers.get('etag'), contentRange: response.headers.get('content-range') });
    return response;
  });
  const abort = new globalThis.AbortController(); let cancelled = false;
  try { await new ArtifactTransfer(http, client, objects).run(spec, { signal: abort.signal, onProgress: done => { if (done > 0) abort.abort(); } }); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'CANCELLED') cancelled = true; else throw error; }
  if (!cancelled) throw new Error('CANCELLATION_NOT_EXERCISED');
  const interrupted = await client.getTransfer(key);
  if (!interrupted || interrupted.bytesDone <= 0 || interrupted.state !== 'partial') throw new Error('DURABLE_PREFIX_NOT_PROVEN');
  await objects.close(); objects = undefined; await client.close(); client = undefined;
  client = await StorageClient.open(entry, metadata); objects = await ObjectStore.open(objectRoot, client, pool);
  const transfer = new ArtifactTransfer(http, client, objects);
  const object = await transfer.run(spec);
  const after = await client.getTransfer(key);
  const count = requests.length; const reused = await transfer.run(spec);
  if (after?.state !== 'committed' || after.objectDigest !== object.digest || reused.digest !== object.digest || requests.length !== count) throw new Error('FINAL_OBJECT_NOT_PROVEN');
  report = { status: 'PASS', timestamp: new Date().toISOString(), mcVersionId: '1.21.1', artifactUrl: artifact.url,
    expectedSha1: artifact.sha1, expectedSize: artifact.size, objectSha256: object.digest,
    sourceMetadataSha1: spec.anchor.digest, cancellationJoined: true, persistedPrefixBytes: interrupted.bytesDone,
    resumedAfterWorkerRestart: true, transferCommitted: true, verifiedObjectReusedWithoutNetwork: true,
    gameDownloaded: true, gameLaunched: false, requests };
} catch (error) {
  report = { status: 'FAIL', timestamp: new Date().toISOString(), code: error && typeof error === 'object' && 'code' in error ? error.code : 'VERIFICATION_FAILED', requests };
  process.exitCode = 1;
} finally {
  await objects?.close(); await client?.close(); await pool.close();
  if (path.dirname(root) === path.resolve(tmpdir()) && path.basename(root).startsWith('oucl-download-live-')) await rm(root, { recursive: true, force: true });
}
await mkdir('docs/validation/A1-05-transfer', { recursive: true });
await writeFile('docs/validation/A1-05-transfer/official-download.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
