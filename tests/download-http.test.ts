import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { HttpTransfer } from '../src/services/download/http.js';
import { parseTransferRecord } from '../src/services/download/types.js';
import type { TransferRecord } from '../src/services/download/types.js';
import { sourceKey } from '../src/services/objects/provenance.js';
import { hasCode } from '../src/services/storage/files.js';

const content = Buffer.from('download fixture data');
const spec = { url: 'https://piston-data.mojang.com/fixture/client.jar',
  expected: { algorithm: 'sha1' as const, digest: createHash('sha1').update(content).digest('hex'), size: content.length, provenanceId: 'fixture:client' },
  anchor: { kind: 'mojang-version' as const, algorithm: 'sha1' as const, digest: 'a'.repeat(40) } };
function record(changes: Partial<TransferRecord> = {}): TransferRecord {
  return { ...spec, key: sourceKey(spec.expected, spec.anchor), stagingId: '00000000-0000-4000-8000-000000000001',
    revision: 1, bytesDone: 0, state: 'partial', ...changes };
}
async function fixture(work: (file: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-http-')); const file = path.join(root, 'fixture.part'); await writeFile(file, '');
  try { await work(file); } finally { await rm(root, { recursive: true, force: true }); }
}
function journal(initial: TransferRecord) {
  const state = { row: initial, calls: 0 };
  return { state, checkpoint: async (revision: number, next: TransferRecord): Promise<void> => {
    assert.equal(revision, state.row.revision); assert.equal(next.revision, revision + 1);
    state.row = parseTransferRecord(next); state.calls++;
  } };
}
function response(bytes: Uint8Array, extra: HeadersInit = {}, status = 200): Response {
  return new Response(new Uint8Array(bytes).buffer, { status, headers: { 'content-length': String(bytes.byteLength), ...extra } });
}

test('full transfer streams real bytes and commits progress only after the file is visible', async () => fixture(async file => {
  const state = journal(record());
  const request: typeof fetch = async (_url, options) => {
    assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit'); assert.equal(new Headers(options?.headers).get('accept-encoding'), 'identity');
    return response(content, { etag: '"one"' });
  };
  const result = await new HttpTransfer(request).run(file, state.state.row, async (revision, next) => {
    assert.ok((await readFile(file)).length >= next.bytesDone); await state.checkpoint(revision, next);
  });
  assert.equal(result.state, 'complete'); assert.equal(result.bytesDone, content.length); assert.equal(result.etag, '"one"');
  assert.deepEqual(await readFile(file), content);
}));

test('206 resumes a durable prefix and truncates an uncommitted disk tail before requesting', async () => fixture(async file => {
  const prefix = 5; await writeFile(file, Buffer.concat([content.subarray(0, prefix), Buffer.from('unsynced tail')]));
  const state = journal(record({ bytesDone: prefix, etag: '"one"' }));
  const request: typeof fetch = async (_url, options) => {
    const headers = new Headers(options?.headers); assert.equal(headers.get('range'), `bytes=${prefix}-`); assert.equal(headers.get('if-range'), '"one"');
    assert.deepEqual(await readFile(file), content.subarray(0, prefix));
    return response(content.subarray(prefix), { etag: '"one"', 'content-range': `bytes ${prefix}-${content.length - 1}/${content.length}` }, 206);
  };
  assert.equal((await new HttpTransfer(request).run(file, state.state.row, state.checkpoint)).state, 'complete');
  assert.deepEqual(await readFile(file), content);
}));

test('a server ignoring Range replaces the old prefix with a full verified-size response', async () => fixture(async file => {
  await writeFile(file, 'wrong'); const state = journal(record({ bytesDone: 5, etag: '"old"' }));
  const result = await new HttpTransfer(async () => response(content, { etag: '"new"' })).run(file, state.state.row, state.checkpoint);
  assert.equal(result.etag, '"new"'); assert.deepEqual(await readFile(file), content);
}));

test('reset sync failure cannot restore a durable prefix after its file was truncated', async context => fixture(async file => {
  await writeFile(file, content.subarray(0, 5));
  const state = journal(record({ bytesDone: 5, etag: '"old"' }));
  const sample = await open(file, 'r+');
  const prototype = Object.getPrototypeOf(sample) as { sync: FileHandle['sync'] };
  const original = prototype.sync; await sample.close();
  let syncCalls = 0;
  context.mock.method(prototype, 'sync', async function (this: FileHandle): Promise<void> {
    syncCalls++;
    if (syncCalls === 2) throw Object.assign(new Error('injected reset flush failure'), { code: 'ENOSPC' });
    await original.call(this);
  });
  try {
    await assert.rejects(new HttpTransfer(async () => response(content)).run(file, state.state.row, state.checkpoint), { code: 'DISK_FULL' });
    assert.equal((await readFile(file)).length, 0);
    assert.equal(state.state.row.bytesDone, 0);
    assert.equal(state.state.row.etag, undefined);
    assert.equal(state.state.calls, 1);
    assert.equal(syncCalls, 2);
  } finally { context.mock.restoreAll(); }
}));

test('changed ETag and invalid range response reset once, then reject repeated protocol failure', async () => {
  for (const recover of [true, false]) await fixture(async file => {
    await writeFile(file, content.subarray(0, 5)); const state = journal(record({ bytesDone: 5, etag: '"old"' })); let calls = 0;
    const request: typeof fetch = async (_url, options) => {
      calls++; const headers = new Headers(options?.headers);
      if (calls === 2) { assert.equal(headers.get('range'), null); if (recover) return response(content, { etag: '"new"' }); }
      return response(content.subarray(5), { etag: '"changed"', 'content-range': `bytes 5-${content.length - 1}/${content.length}` }, 206);
    };
    const promise = new HttpTransfer(request).run(file, state.state.row, state.checkpoint);
    if (recover) { await promise; assert.deepEqual(await readFile(file), content); }
    else await assert.rejects(promise, { code: 'BAD_RESPONSE' });
    assert.equal(calls, 2);
  });
});

test('416 accepts exactly complete durable bytes and otherwise performs one clean restart', async () => {
  for (const complete of [true, false]) await fixture(async file => {
    const prefix = complete ? content.length : 4; await writeFile(file, content.subarray(0, prefix));
    const state = journal(record({ bytesDone: prefix, etag: '"one"' })); let calls = 0;
    const request: typeof fetch = async () => ++calls === 1 ? new Response(null, { status: 416, headers: { 'content-range': `bytes */${content.length}` } }) : response(content);
    assert.equal((await new HttpTransfer(request).run(file, state.state.row, state.checkpoint)).state, 'complete');
    assert.equal(calls, complete ? 1 : 2); assert.deepEqual(await readFile(file), content);
  });
});

test('weak or missing validator causes a full restart; Last-Modified can safely resume', async () => {
  await fixture(async file => {
    await writeFile(file, content.subarray(0, 3)); const state = journal(record({ bytesDone: 3 }));
    await new HttpTransfer(async (_url, options) => { assert.equal(new Headers(options?.headers).get('range'), null); return response(content, { etag: 'W/"weak"' }); }).run(file, state.state.row, state.checkpoint);
    assert.equal(state.state.row.etag, undefined); assert.deepEqual(await readFile(file), content);
  });
  await fixture(async file => {
    const modified = 'Sat, 24 Oct 2026 00:00:00 GMT'; await writeFile(file, content.subarray(0, 3));
    const state = journal(record({ bytesDone: 3, lastModified: modified }));
    await new HttpTransfer(async (_url, options) => {
      assert.equal(new Headers(options?.headers).get('if-range'), modified);
      return response(content.subarray(3), { etag: '"now-available"', 'last-modified': modified, 'content-range': `bytes 3-${content.length - 1}/${content.length}` }, 206);
    }).run(file, state.state.row, state.checkpoint);
    assert.deepEqual(await readFile(file), content);
  });
});

test('network interruption preserves and checkpoints the received prefix for the next attempt', async () => fixture(async file => {
  const state = journal(record()); let count = 0;
  const request: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (count++ === 0) controller.enqueue(content.subarray(0, 5)); else controller.error(new Error('connection lost'));
  } }), { headers: { etag: '"one"' } });
  await assert.rejects(new HttpTransfer(request).run(file, state.state.row, state.checkpoint), { code: 'NETWORK_FAILED' });
  assert.equal(state.state.row.bytesDone, 5); assert.deepEqual(await readFile(file), content.subarray(0, 5));
  await new HttpTransfer(async () => response(content.subarray(5), { etag: '"one"', 'content-range': `bytes 5-${content.length - 1}/${content.length}` }, 206)).run(file, state.state.row, state.checkpoint);
  assert.deepEqual(await readFile(file), content);
}));

test('cancellation waits for the durable prefix and closes the staging handle', async () => fixture(async file => {
  const state = journal(record()); const controller = new AbortController();
  const request: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({ start(source) { source.enqueue(content.subarray(0, 5)); } }), { headers: { etag: '"one"' } });
  await assert.rejects(new HttpTransfer(request).run(file, state.state.row, state.checkpoint, { signal: controller.signal, onProgress: () => { controller.abort(); } }), { code: 'CANCELLED' });
  assert.equal(state.state.row.bytesDone, 5); assert.deepEqual(await readFile(file), content.subarray(0, 5)); await rm(file);
}));

test('overlong body, encoding, length and retry responses cannot produce complete state', async () => {
  for (const item of [new Response(Buffer.alloc(content.length + 1)), response(content, { 'content-encoding': 'gzip' }), response(content, { 'content-length': 'bad' }), response(content, { 'content-length': '1' })]) await fixture(async file => {
    const state = journal(record()); await assert.rejects(new HttpTransfer(async () => item).run(file, state.state.row, state.checkpoint), { code: 'BAD_RESPONSE' });
    assert.equal(state.state.row.state, 'partial');
  });
  await fixture(async file => {
    const state = journal(record());
    await assert.rejects(new HttpTransfer(async () => new Response(null, { status: 429, headers: { 'retry-after': '12' } })).run(file, state.state.row, state.checkpoint), { code: 'RETRY_LATER', retryAfterMs: 12000 });
  });
});

test('header and idle timers are bounded and redact the original network exception', async () => {
  await fixture(async file => {
    const request: typeof fetch = async (_url, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => { reject(new Error('private transport details')); }); });
    const state = journal(record()); await assert.rejects(new HttpTransfer(request, { headersMs: 20 }).run(file, state.state.row, state.checkpoint), { code: 'TIMEOUT' });
  });
  await fixture(async file => {
    const state = journal(record());
    await assert.rejects(new HttpTransfer(async () => new Response(new ReadableStream<Uint8Array>()), { idleMs: 20 }).run(file, state.state.row, state.checkpoint), { code: 'TIMEOUT' });
  });
});

test('missing durable bytes and checkpoint failures stop without false completion', async () => {
  await fixture(async file => {
    const state = journal(record({ bytesDone: 3, etag: '"one"' })); await assert.rejects(new HttpTransfer().run(file, state.state.row, state.checkpoint), { code: 'NEEDS_RECOVERY' });
  });
  await fixture(async file => {
    const state = journal(record()); await assert.rejects(new HttpTransfer(async () => response(content)).run(file, state.state.row, async () => { throw new Error('checkpoint unavailable'); }), { code: 'NEEDS_RECOVERY' });
  });
});

test('linked staging files are refused when file symlink privilege is available', async context => {
  await fixture(async file => {
    const link = file + '.link';
    try { await symlink(file, link); }
    catch (error) {
      if (hasCode(error, 'EPERM') || hasCode(error, 'EACCES')) { context.skip('File symlink privilege unavailable; no system policy changed.'); return; }
      throw error;
    }
    await assert.rejects(new HttpTransfer().run(link, record(), async () => {}), { code: 'NEEDS_RECOVERY' });
  });
});

test('production HTTPS policy can be exercised through a local HTTP fetch adapter', async () => fixture(async file => {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(request.headers.range ?? 'full'); const offset = request.headers.range ? 5 : 0;
    response.writeHead(offset ? 206 : 200, { 'content-length': content.length - offset, etag: '"one"',
      ...(offset ? { 'content-range': `bytes ${offset}-${content.length - 1}/${content.length}` } : {}) });
    response.end(content.subarray(offset));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const local: typeof fetch = async (_url, options) => fetch(`http://127.0.0.1:${address.port}/fixture`, options);
  try {
    await writeFile(file, content.subarray(0, 5)); const state = journal(record({ bytesDone: 5, etag: '"one"' }));
    await new HttpTransfer(local).run(file, state.state.row, state.checkpoint);
    assert.deepEqual(seen, ['bytes=5-']); assert.deepEqual(await readFile(file), content);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); }
}));
