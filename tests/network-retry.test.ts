import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SourceTransfer } from '../src/services/download/source-transfer.js';
import { DownloadError } from '../src/services/download/types.js';
import type { TransferRecord } from '../src/services/download/types.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import { DEFAULT_DOWNLOAD_PREFERENCES } from '../src/shared/contracts/download-preferences.js';
import { OfficialMetadataReader, MANIFEST_URL } from '../src/services/catalog/transport.js';

const bytes = Buffer.from('verified payload');
async function fixture() {
  const directory = await mkdtemp(path.resolve('.test-build/network-retry-'));
  const file = path.join(directory, 'owned.part'); await writeFile(file, '');
  const expected = { algorithm: 'sha1' as const, digest: createHash('sha1').update(bytes).digest('hex'), size: bytes.length, provenanceId: 'retry:fixture' };
  const anchor = { kind: 'mojang-version' as const, algorithm: 'sha1' as const, digest: 'a'.repeat(40) };
  let current: TransferRecord = { url: 'https://piston-data.mojang.com/objects/fixture/client.jar', expected, anchor, key: sourceKey(expected, anchor), stagingId: '00000000-0000-4000-8000-000000000001', revision: 1, bytesDone: 0, state: 'partial' };
  return { directory, file, get current() { return current; }, save: async (revision: number, next: TransferRecord) => { assert.equal(revision, current.revision); current = next; } };
}
const full = () => new Response(bytes, { headers: { 'content-length': String(bytes.length), etag: '"stable"' } });

test('transient connection failures and 502 responses retry within a three-attempt budget', async () => {
  const f = await fixture(); let calls = 0;
  const request: typeof fetch = async () => { calls++; if (calls === 1) throw new TypeError('connection failed'); if (calls === 2) return new Response(null, { status: 502 }); return full(); };
  try { await new SourceTransfer(() => DEFAULT_DOWNLOAD_PREFERENCES, request).run(f.file, f.current, f.save); assert.equal(calls, 3); assert.deepEqual(await readFile(f.file), bytes); assert.equal(f.current.state, 'complete'); }
  finally { await rm(f.directory, { recursive: true }); }
});

test('a body disconnect resumes the latest fsynced prefix using Range and If-Range', async () => {
  const f = await fixture(); let calls = 0;
  const request: typeof fetch = async (_url, init) => {
    if (++calls === 1) { let sent = false; return new Response(new ReadableStream<Uint8Array>({ async pull(controller) { if (!sent) { sent = true; controller.enqueue(bytes.subarray(0, 5)); } else { await new Promise(resolve => setTimeout(resolve, 20)); controller.error(new Error('disconnected')); } } }), { headers: { 'content-length': String(bytes.length), etag: '"stable"' } }); }
    const headers = new Headers(init?.headers); assert.equal(headers.get('range'), 'bytes=5-'); assert.equal(headers.get('if-range'), '"stable"'); assert.equal(f.current.bytesDone, 5);
    return new Response(bytes.subarray(5), { status: 206, headers: { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}`, 'content-length': String(bytes.length - 5), etag: '"stable"' } });
  };
  try { await new SourceTransfer(() => DEFAULT_DOWNLOAD_PREFERENCES, request).run(f.file, f.current, f.save); assert.equal(calls, 2); assert.deepEqual(await readFile(f.file), bytes); }
  finally { await rm(f.directory, { recursive: true }); }
});

test('permanent HTTP errors, long Retry-After and lost journal acknowledgements are not retried', async () => {
  for (const kind of ['not-found', 'rate-limit', 'journal', 'journal-cancel']) {
    const f = await fixture(); let calls = 0; const controller = new AbortController();
    const request: typeof fetch = async () => { calls++; return kind === 'not-found' ? new Response(null, { status: 404 }) : kind === 'rate-limit' ? new Response(null, { status: 429, headers: { 'retry-after': '60' } }) : full(); };
    try {
      await assert.rejects(new SourceTransfer(() => DEFAULT_DOWNLOAD_PREFERENCES, request).run(f.file, f.current, async (revision, next) => { if (kind.startsWith('journal')) { if (kind === 'journal-cancel') controller.abort(); throw Error('lost ack'); } await f.save(revision, next); }, { signal: controller.signal }), { code: kind.startsWith('journal') ? 'NEEDS_RECOVERY' : kind === 'rate-limit' ? 'RETRY_LATER' : 'BAD_RESPONSE' });
      // Existing parallel-to-serial fallback permits a second read on BAD_RESPONSE; no transient retry cycle follows it.
      assert.equal(calls, kind === 'not-found' ? 2 : 1);
    } finally { await rm(f.directory, { recursive: true }); }
  }
});

test('cancellation during backoff starts no next request; permanent outages stop after three attempts', async () => {
  for (const cancel of [false, true]) {
    const f = await fixture(); const controller = new AbortController(); let calls = 0;
    const request: typeof fetch = async () => { calls++; if (cancel) setTimeout(() => controller.abort(), 20); throw new DownloadError('NETWORK_FAILED'); };
    try { await assert.rejects(new SourceTransfer(() => DEFAULT_DOWNLOAD_PREFERENCES, request).run(f.file, f.current, f.save, { signal: controller.signal }), { code: cancel ? 'CANCELLED' : 'NETWORK_FAILED' }); assert.equal(calls, cancel ? 1 : 3); }
    finally { await rm(f.directory, { recursive: true }); }
  }
});

test('metadata retries fresh responses for transient failure but not invalid trust or permanent HTTP status', async () => {
  let calls = 0;
  const reader = new OfficialMetadataReader(async () => { if (++calls === 1) throw new TypeError('reset'); if (calls === 2) return new Response(null, { status: 503 }); return new Response('{}'); });
  assert.equal((await reader.read(MANIFEST_URL)).body, '{}'); assert.equal(calls, 3);
  for (const status of [403, 404, 429]) { calls = 0; await assert.rejects(new OfficialMetadataReader(async () => { calls++; return new Response(null, { status }); }).read(MANIFEST_URL), { code: 'CATALOG_UNAVAILABLE' }); assert.equal(calls, 1); }
  calls = 0; await assert.rejects(new OfficialMetadataReader(async () => { calls++; return new Response('{}'); }).read(MANIFEST_URL, '0'.repeat(40)), { code: 'UNTRUSTED_MANIFEST' }); assert.equal(calls, 1);
});
test('an acknowledged mirror prefix retains its validator when re-entering the same source', async () => {
  const f = await fixture(); await writeFile(f.file, bytes.subarray(0, 5));
  const record = { ...f.current, transportSource: 'bmclapi' as const, etag: '"stable"', bytesDone: 5, revision: 2 };
  await f.save(1, record); let calls = 0;
  const request: typeof fetch = async (input, init) => {
    calls++; assert.ok(String(input).includes('bmclapi')); const headers = new Headers(init?.headers);
    assert.equal(headers.get('range'), 'bytes=5-'); assert.equal(headers.get('if-range'), '"stable"');
    return new Response(bytes.subarray(5), { status: 206, headers: { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}`, 'content-length': String(bytes.length - 5), etag: '"stable"' } });
  };
  try { await new SourceTransfer(() => ({ ...DEFAULT_DOWNLOAD_PREFERENCES, source: 'bmclapi' }), request).run(f.file, f.current, f.save); assert.equal(calls, 1); assert.deepEqual(await readFile(f.file), bytes); }
  finally { await rm(f.directory, { recursive: true }); }
});
