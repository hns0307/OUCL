import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolveClientVersion } from '../.test-build/src/core/version/resolve.js';

const records = [];
async function officialJson(url, expectedSha1) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'piston-meta.mojang.com') throw new Error('UNTRUSTED_METADATA_ORIGIN');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (response.status !== 200) throw new Error('METADATA_UNAVAILABLE');
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > 2 * 1024 * 1024) throw new Error('METADATA_TOO_LARGE');
  const sha1 = createHash('sha1').update(body).digest('hex');
  if (expectedSha1 !== undefined && expectedSha1 !== sha1) throw new Error('METADATA_HASH_MISMATCH');
  records.push({ url, sha1, size: body.length, expectedSha1: expectedSha1 ?? null });
  return JSON.parse(body);
}
const manifest = await officialJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
const samples = [];
for (const id of ['1.21.1', '1.12.2', '1.6.4']) {
  const documents = {};
  let next = id;
  while (next !== undefined) {
    if (Object.hasOwn(documents, next) || Object.keys(documents).length >= 32) throw new Error('INVALID_SAMPLE_INHERITANCE');
    const entry = manifest.versions.find(version => version.id === next);
    if (!entry) throw new Error('SAMPLE_NOT_FOUND');
    const descriptor = await officialJson(entry.url, entry.sha1);
    documents[next] = descriptor; next = descriptor.inheritsFrom;
  }
  const resolved = resolveClientVersion(id, documents, { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} });
  samples.push({ id, mainClass: resolved.mainClass, javaMajor: resolved.javaMajor,
    jarVersionId: resolved.jarVersionId, selectedLibraries: resolved.libraries.length,
    gameArgumentCount: resolved.gameArguments.length, jvmArgumentCount: resolved.jvmArguments.length,
    metadataParsed: true, gameLaunched: false });
}
await mkdir('docs/validation/A1-01', { recursive: true });
const report = { timestamp: new Date().toISOString(), status: 'PASS', source: 'official HTTPS manifest with per-version SHA1', samples, records };
await writeFile('docs/validation/A1-01/official-samples.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, samples }));
