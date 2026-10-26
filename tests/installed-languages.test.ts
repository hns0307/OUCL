import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { InstalledLanguageReader } from '../src/services/mods/languages.js';
import type { InstanceRecord } from '../src/services/storage/instance-records.js';
import type { DownloadSpec } from '../src/services/download/types.js';
import type { ModArchiveScan } from '../src/services/mods/archive.js';
const sha1 = 'a'.repeat(40); const sha256 = 'b'.repeat(64);
const spec: DownloadSpec = { url: 'https://maven.minecraftforge.net/net/minecraftforge/javafmllanguage/1.20.1-47.4.28/javafmllanguage-1.20.1-47.4.28.jar',
  expected: { algorithm: 'sha1', digest: sha1, size: 100, provenanceId: 'test-language' }, anchor: { kind: 'loader-profile', algorithm: 'sha256', digest: 'c'.repeat(64) } };
function record(): InstanceRecord {
  return { summary: { instanceId: '00000000-0000-4000-8000-000000000001', rootId: '00000000-0000-4000-8000-000000000002',
    taskId: '00000000-0000-4000-8000-000000000003', displayName: 'Test', mcVersionId: '1.20.1', isolation: 'on', state: 'ready', revision: 1 },
  phase: 'ready', metadata: { versionDocuments: {}, metadataSha1ByVersion: {}, assetIndexBody: '{}', loader: {
    kind: 'forge', version: '47.4.28', catalogSourceUrl: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', catalogSha256: 'c'.repeat(64),
    installer: { sourceUrl: spec.url, spec, object: { digest: sha256, size: 100, sourceKey: 'c'.repeat(64) } }, profileBody: '{}', profileSha256: 'c'.repeat(64), versionBody: '{}', versionSha256: 'd'.repeat(64),
    libraries: [{ path: 'net/minecraftforge/javafmllanguage/1.20.1-47.4.28/javafmllanguage-1.20.1-47.4.28.jar', spec }] } }, objects: { [`sha1-${sha1}`]: { digest: sha256, size: 100, sourceKey: 'c'.repeat(64) } } };
}
const scan = (): ModArchiveScan => ({ size: 100, sha1, sha256, sha512: 'e'.repeat(128), archives: [] });
test('installed language versions are admitted only after the actual object matches upstream SHA1 and recorded SHA256', async () => {
  const root = path.resolve('language-tests'); let reads = 0;
  const reader = new InstalledLanguageReader({ read: async file => { reads++; assert.equal(file, path.join(root, 'store/objects/sha256/bb', sha256)); return scan(); } });
  assert.deepEqual(await reader.read(root, record()), { javafml: '47' }); assert.equal(reads, 1);
  for (const altered of [{ ...scan(), sha1: 'f'.repeat(40) }, { ...scan(), sha256: 'f'.repeat(64) }, { ...scan(), size: 101 }]) {
    await assert.rejects(new InstalledLanguageReader({ read: async () => altered }).read(root, record()), { code: 'SCAN_FAILED' });
  }
  const missing = record(); missing.objects = {};
  await assert.rejects(reader.read(root, missing), { code: 'SCAN_FAILED' });
  const vanilla = record(); delete vanilla.metadata; assert.deepEqual(await reader.read(root, vanilla), {});
});
