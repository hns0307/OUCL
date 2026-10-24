import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { digest } from './fixture.mjs';

const records = [];
async function fetchBytes(url, expectedSha1, size) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['piston-meta.mojang.com', 'resources.download.minecraft.net'].includes(parsed.hostname)) {
    throw new Error('UNAPPROVED_HOST');
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length <= 8 * 1024 * 1024, 'SIZE_LIMIT');
  const sha1 = digest(bytes, 'sha1');
  if (expectedSha1) assert.equal(sha1, expectedSha1);
  if (size !== undefined) assert.equal(bytes.length, size);
  records.push({ url, sha1, size: bytes.length, expectedSha1: expectedSha1 ?? null });
  return bytes;
}
let failure;
try {
  const manifest = JSON.parse(await fetchBytes('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'));
  const version = manifest.versions.find(item => item.id === '1.21.1');
  assert.ok(version);
  const metadata = JSON.parse(await fetchBytes(version.url, version.sha1));
  const index = JSON.parse(await fetchBytes(metadata.assetIndex.url, metadata.assetIndex.sha1, metadata.assetIndex.size));
  const asset = Object.values(index.objects).find(item => item.size > 0 && item.size < 8192);
  assert.ok(asset);
  await fetchBytes(`https://resources.download.minecraft.net/${asset.hash.slice(0, 2)}/${asset.hash}`, asset.hash, asset.size);
} catch (error) { failure = { name: error.name, message: error.message }; }
const directory = new URL('./results/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('live-trust.json', directory), JSON.stringify({ timestamp: new Date().toISOString(), status: failure ? 'BLOCKED' : 'PASS', records, failure }, null, 2));
console.log(JSON.stringify({ status: failure ? 'BLOCKED' : 'PASS', verifiedResponses: records.length }));
if (failure) process.exitCode = 1;
