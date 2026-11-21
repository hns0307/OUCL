import assert from 'node:assert/strict';
import test from 'node:test';
import { ModrinthModClient } from '../src/services/mods/modrinth.js';
const sha1 = 'a'.repeat(40); const sha512 = 'b'.repeat(128);
const raw = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'version1', project_id: 'project1', name: 'Example release',
  version_number: '1.0', date_published: '2026-10-20T12:00:00Z', version_type: 'release', loaders: ['fabric'], game_versions: ['1.20.1'],
  dependencies: [{ project_id: 'project2', version_id: 'version2', file_name: null, dependency_type: 'required' },
    { project_id: 'project3', version_id: null, file_name: null, dependency_type: 'optional' }],
  files: [{ filename: 'example.jar', url: 'https://cdn.modrinth.com/data/project1/versions/version1/example.jar', size: 100, primary: true, hashes: { sha1, sha512 } }], ...extra });
const response = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('SHA512 association sends only bounded hashes and preserves exact project/version prerequisites and evidence', async () => {
  const client = new ModrinthModClient(async (url, options) => {
    assert.equal(url, 'https://api.modrinth.com/v2/version_files'); assert.equal(options?.method, 'POST');
    assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit');
    assert.deepEqual(JSON.parse(String(options?.body)), { hashes: [sha512], algorithm: 'sha512' }); return response({ [sha512]: raw() });
  });
  const matched = (await client.byHashes([sha512])).get(sha512)!;
  assert.equal(matched.projectId, 'project1'); assert.equal(matched.versionId, 'version1');
  assert.equal(matched.dependencies[0]!.versionId, 'version2'); assert.equal(matched.dependencies[1]!.versionId, null);
  assert.equal(matched.dependencies[1]!.type, 'optional'); assert.equal(matched.evidence.sha256.length, 64);
  assert.equal(matched.environment, 'unknown');
  assert.equal((await new ModrinthModClient(async () => response({})).byHashes([sha512])).size, 0);
});
test('candidates sort release first then publication and ID, while pinned lookups remain exact', async () => {
  const values = [raw({ id: 'version3', version_type: 'beta', date_published: '2026-10-25T12:00:00Z' }),
    raw({ id: 'version2' }), raw({ id: 'version1' }), raw({ id: 'version4', date_published: '2026-10-24T12:00:00Z' })];
  const client = new ModrinthModClient(async url => {
    const value = new URL(String(url)); assert.equal(value.pathname, '/v2/project/project1/version');
    assert.equal(value.searchParams.get('loaders'), '["fabric"]'); return response(values);
  });
  assert.deepEqual((await client.candidates('project1', '1.20.1', 'fabric')).map(item => item.versionId), ['version4', 'version1', 'version2', 'version3']);
  assert.equal((await new ModrinthModClient(async () => response(raw())).version('version1')).versionId, 'version1');
  await assert.rejects(new ModrinthModClient(async () => response(raw({ id: 'version2' }))).version('version1'), { code: 'UNTRUSTED_METADATA' });
});
test('platform adapter rejects unsafe selectors, forged hash associations, project drift and invalid file proof', async () => {
  const client = new ModrinthModClient(async () => response({}));
  for (const hashes of [[], [sha512, sha512], ['bad'], Array.from({ length: 65 }, (_, i) => i.toString(16).padStart(128, '0'))]) await assert.rejects(client.byHashes(hashes), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(client.version('../path'), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(client.candidates('project1', '../mc', 'fabric'), { code: 'INVALID_ARGUMENT' });
  for (const value of [{ wrong: raw() }, { [sha512]: raw({ files: [] }) }, { [sha512]: raw({ files: [{ filename: 'bad.jar', url: 'https://evil.invalid/jar', size: 1, primary: true, hashes: { sha1, sha512 } }] }) },
    { [sha512]: raw({ files: [{ filename: 'bad.jar', url: 'https://cdn.modrinth.com/data/project2/jar', size: 1, primary: true, hashes: { sha1, sha512 } }] }) },
    { [sha512]: raw({ date_published: 'not date' }) }, { [sha512]: raw({ version_type: 'future' }) },
    { [sha512]: raw({ dependencies: [{ project_id: null, version_id: null, file_name: null, dependency_type: 'future' }] }) },
    { [sha512]: raw({ loaders: ['fabric', 'fabric'] }) }]) await assert.rejects(new ModrinthModClient(async () => response(value)).byHashes([sha512]), { code: 'UNTRUSTED_METADATA' });
  await assert.rejects(new ModrinthModClient(async () => response([raw({ project_id: 'project2' })])).candidates('project1', '1.20.1', 'fabric'), { code: 'UNTRUSTED_METADATA' });
  await assert.rejects(new ModrinthModClient(async () => response(Array(513).fill(raw()))).candidates('project1', '1.20.1', 'fabric'), { code: 'PLATFORM_LIMIT' });
});
test('platform transport bounds status, rate-limit cooldown, malformed text, cancellation and concurrency', async () => {
  for (const [status, code] of [[404, 'NOT_FOUND'], [500, 'NETWORK_FAILED']] as const) await assert.rejects(new ModrinthModClient(async () => new Response(null, { status })).version('version1'), { code });
  let calls = 0; const rate = new ModrinthModClient(async () => { calls++; return new Response(null, { status: 429, headers: { 'retry-after': '300' } }); });
  await assert.rejects(rate.version('version1'), { code: 'RETRY_LATER' }); await assert.rejects(rate.version('version1'), { code: 'RETRY_LATER' }); assert.equal(calls, 1);
  await assert.rejects(new ModrinthModClient(async () => new Response('bad json')).version('version1'), { code: 'UNTRUSTED_METADATA' });
  await assert.rejects(new ModrinthModClient(async () => new Response(Buffer.from([0xff]))).version('version1'), { code: 'UNTRUSTED_METADATA' });
  await assert.rejects(new ModrinthModClient(async () => new Response('x', { headers: { 'content-length': '9000000' } })).version('version1'), { code: 'PLATFORM_LIMIT' });
  const controller = new AbortController(); controller.abort(); await assert.rejects(new ModrinthModClient().version('version1', controller.signal), { code: 'CANCELLED' });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = new ModrinthModClient(async () => { await gate; return response(raw()); });
  const pending = Array.from({ length: 4 }, () => slow.version('version1'));
  await assert.rejects(slow.version('version1'), { code: 'PLATFORM_LIMIT' }); release(); await Promise.all(pending);
  const during = new AbortController(); const cancelling = new ModrinthModClient(async () => { during.abort(); throw new Error('private path'); });
  await assert.rejects(cancelling.version('version1', during.signal), { code: 'CANCELLED' });
});

test('transient platform failures retry once and cancellation stops the retry', async () => {
  let calls = 0;
  const client = new ModrinthModClient(async () => { if (++calls === 1) throw new Error('connection closed'); return response(raw()); });
  assert.equal((await client.version('version1')).versionId, 'version1'); assert.equal(calls, 2);
  let failures = 0;
  await assert.rejects(new ModrinthModClient(async () => { failures++; throw new Error('offline'); }).version('version1'), { code: 'NETWORK_FAILED' });
  assert.equal(failures, 2);
  const controller = new AbortController(); let cancelledCalls = 0;
  const cancelled = new ModrinthModClient(async () => { cancelledCalls++; setTimeout(() => controller.abort(), 10); throw new Error('offline'); });
  await assert.rejects(cancelled.version('version1', controller.signal), { code: 'CANCELLED' }); assert.equal(cancelledCalls, 1);
});
