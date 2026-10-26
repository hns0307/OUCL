import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ParallelHttpTransfer } from '../src/services/download/parallel-http.js';
import { SourceTransfer, mirrorFetch } from '../src/services/download/source-transfer.js';
import { RequestBudget } from '../src/services/download/request-budget.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import { DEFAULT_DOWNLOAD_PREFERENCES } from '../src/shared/contracts/download-preferences.js';
import { bmclapiArtifactUrl, isMirrorArtifactUrl } from '../src/core/download/sources.js';
import type { TransferRecord } from '../src/services/download/types.js';

const bytes = Buffer.alloc(12 * 1024 ** 2); for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
function record(): TransferRecord {
  const expected = { algorithm: 'sha1' as const, digest: createHash('sha1').update(bytes).digest('hex'), size: bytes.length, provenanceId: 'fixture:parallel' };
  const anchor = { kind: 'mojang-version' as const, algorithm: 'sha1' as const, digest: 'a'.repeat(40) };
  return { url: 'https://piston-data.mojang.com/objects/fixture/client.jar', expected, anchor, key: sourceKey(expected, anchor),
    stagingId: '00000000-0000-4000-8000-000000000001', revision: 1, bytesDone: 0, state: 'partial' };
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-parallel-')); const file = path.join(directory, 'owned.part'); await writeFile(file, '');
  let current = record(); const checkpoints: number[] = [];
  return { file, get current() { return current; }, checkpoints, save: async (revision: number, next: TransferRecord) => {
    assert.equal(revision, current.revision); assert.equal(next.revision, revision + 1); current = next; checkpoints.push(next.bytesDone);
  } };
}
test('real HTTP parallel ranges join exact bytes and checkpoint only a complete contiguous prefix', async () => {
  const state = await fixture(); let active = 0; let peak = 0;
  const server = createServer((request, response) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? ''); assert.ok(range);
    const start = Number(range[1]); const end = Number(range[2]); active++; peak = Math.max(peak, active);
    response.once('close', () => { active--; });
    response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1, ETag: '"fixture"' });
    setTimeout(() => { response.end(bytes.subarray(start, end + 1)); }, start === 0 && end > 0 ? 80 : 10);
  }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const request: typeof fetch = (_url, init) => fetch(`http://127.0.0.1:${address.port}/file`, init);
  try {
    const result = await new ParallelHttpTransfer(request).run(state.file, state.current, state.save, {}, 3);
    assert.equal(result.state, 'complete'); assert.deepEqual(await readFile(state.file), bytes); assert.ok(peak >= 2 && peak <= 3);
    assert.ok(state.checkpoints.every(size => size === 0 || size === bytes.length));
  } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
});
test('unsupported ranges fall back to one stream, while mirror failure clears source validators', async () => {
  const state = await fixture(); const requests: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input); requests.push(url);
    if (url.includes('bmclapi')) return new Response(null, { status: 503 });
    assert.equal(new Headers(init?.headers).get('if-range'), null);
    return new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.length), ETag: '"official"' } });
  };
  const result = await new SourceTransfer(() => ({ ...DEFAULT_DOWNLOAD_PREFERENCES, source: 'bmclapi' }), request).run(state.file, state.current, state.save);
  assert.equal(result.transportSource, 'official'); assert.equal(result.state, 'complete'); assert.deepEqual(await readFile(state.file), bytes);
  assert.ok(requests[0]!.includes('bmclapi2')); assert.ok(requests.slice(1).every(url => url.startsWith('https://piston-data.mojang.com/')));
});
test('a failed parallel checkpoint has recovery precedence and never reports complete', async () => {
  const state = await fixture();
  const request: typeof fetch = async (_url, init) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '')!;
    const start = Number(range[1]); const end = Number(range[2]);
    return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: '"fixture"' } });
  };
  await assert.rejects(new ParallelHttpTransfer(request).run(state.file, state.current, async () => { throw new Error('lost acknowledgement'); }), { code: 'NEEDS_RECOVERY' });
  assert.equal(state.current.state, 'partial'); assert.equal(state.current.bytesDone, 0);
});
test('global and per-host request budgets apply through body completion and queued cancellation', async () => {
  const budget = new RequestBudget(3, 2); let active = 0; let peak = 0; let hostA = 0; let peakA = 0;
  const abort = new AbortController(); let cancelledRan = false; let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const jobs = Array.from({ length: 8 }, (_, index) => budget.run(index < 6 ? 'a' : 'b', undefined, async () => {
    active++; peak = Math.max(peak, active); if (index < 6) { hostA++; peakA = Math.max(peakA, hostA); }
    await hold; active--; if (index < 6) hostA--;
  }));
  const cancelled = budget.run('a', abort.signal, async () => { cancelledRan = true; }); abort.abort();
  await assert.rejects(cancelled, { code: 'CANCELLED' }); release(); await Promise.all(jobs);
  assert.equal(cancelledRan, false); assert.equal(active, 0); assert.equal(peak, 3); assert.equal(peakA, 2);
});
test('mirror redirects remain fixed HTTPS routes and cannot reach arbitrary hosts or credentials', async () => {
  assert.equal(bmclapiArtifactUrl('https://libraries.minecraft.net/a.jar'), 'https://bmclapi2.bangbang93.com/maven/a.jar');
  assert.equal(bmclapiArtifactUrl('https://cdn.modrinth.com/data/a.jar'), undefined);
  for (const url of ['http://bmclapi2.bangbang93.com/maven/a', 'https://evil.invalid/maven/a', 'https://bmclapi2.bangbang93.com:444/maven/a', 'https://mirrors.qlu.edu.cn/private/a']) assert.equal(isMirrorArtifactUrl(url), false);
  let calls = 0;
  await assert.rejects(mirrorFetch(async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }); })('https://bmclapi2.bangbang93.com/maven/a'), { code: 'BAD_RESPONSE' });
  assert.equal(calls, 1);
});

test('parallel cancellation joins stalled bodies and leaves only the contiguous prefix for resume', async () => {
  const state = await fixture(); const abort = new AbortController(); let cancelled = 0; let opened = 0;
  const request: typeof fetch = async (_url, init) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '')!;
    const start = Number(match[1]); const end = Number(match[2]);
    const headers = { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: '"fixture"' };
    if (start === end) return new Response(bytes.subarray(start, end + 1), { status: 206, headers });
    opened++;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      if (start > 0) { controller.enqueue(bytes.subarray(start, end + 1)); controller.close(); }
      if (opened === 3) setTimeout(() => abort.abort(), 30);
    }, cancel() { cancelled++; } }), { status: 206, headers });
  };
  await assert.rejects(new ParallelHttpTransfer(request).run(state.file, state.current, state.save, { signal: abort.signal }, 3), { code: 'CANCELLED' });
  assert.equal(cancelled, 1); assert.equal(state.current.bytesDone, 0); assert.equal(state.current.state, 'partial');
  // The sparse tail from completed later pieces is discarded before the resumed write.
  const resumed: typeof fetch = async (_url, init) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '')!;
    const start = Number(match[1]); const end = Number(match[2]);
    return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: '"fixture"' } });
  };
  await new ParallelHttpTransfer(resumed).run(state.file, state.current, state.save, {}, 3);
  assert.deepEqual(await readFile(state.file), bytes);
});

test('changed entity in a parallel lane aborts all lanes then restarts through the serial validator', async () => {
  const state = await fixture(); let ranged = 0; let serial = 0;
  const request: typeof fetch = async (_url, init) => {
    const range = new Headers(init?.headers).get('range');
    if (!range) { serial++; return new Response(bytes, { headers: { ETag: '"new"' } }); }
    ranged++; const match = /^bytes=(\d+)-(\d+)$/.exec(range)!; const start = Number(match[1]); const end = Number(match[2]);
    return new Response(bytes.subarray(start, end + 1), { status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: start === end ? '"old"' : '"new"' } });
  };
  const result = await new SourceTransfer(() => DEFAULT_DOWNLOAD_PREFERENCES, request).run(state.file, state.current, state.save);
  assert.ok(ranged >= 2); assert.equal(serial, 1); assert.equal(result.state, 'complete');
  assert.deepEqual(await readFile(state.file), bytes);
});

test('parallel idle timeout cancels a stalled body even when a mock transport ignores abort', async () => {
  const state = await fixture(); let cancelled = 0;
  const request: typeof fetch = async (_url, init) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '')!;
    const start = Number(match[1]); const end = Number(match[2]);
    return new Response(start === end ? bytes.subarray(start, end + 1) : new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }),
      { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, ETag: '"fixture"' } });
  };
  await assert.rejects(new ParallelHttpTransfer(request, new RequestBudget(), 1000, 20).run(state.file, state.current, state.save, {}, 3), { code: 'TIMEOUT' });
  assert.equal(cancelled, 3); assert.equal(state.current.bytesDone, 0);
});
