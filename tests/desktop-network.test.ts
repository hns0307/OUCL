import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ClientRequest, ClientRequestConstructorOptions } from 'electron';
import { createDesktopFetch } from '../src/main/network.js';

class NativeRequest extends EventEmitter {
  headers = new Headers(); written = ''; aborted = false;
  constructor(readonly options: ClientRequestConstructorOptions, private readonly start: (request: NativeRequest) => void) { super(); }
  setHeader(name: string, value: string): void { this.headers.set(name, value); }
  write(body: string): void { this.written += body; }
  end(): void { queueMicrotask(() => this.start(this)); }
  abort(): void { this.aborted = true; }
}
function fixture(start: (request: NativeRequest) => void) {
  const requests: NativeRequest[] = [];
  const request = createDesktopFetch(options => { const native = new NativeRequest(options, start); requests.push(native); return native as unknown as ClientRequest; });
  return { request, requests };
}
function response(request: NativeRequest, status = 200, stream: Readable = Readable.from([Buffer.from('native bytes')])): Readable {
  Object.assign(stream, { statusCode: status, headers: { etag: '"native"', 'content-length': '12' } }); request.emit('response', stream); return stream;
}

test('desktop HTTPS adapter streams native bytes and retains request policy without ambient cookies', async () => {
  const f = fixture(request => { response(request); });
  const reply = await f.request('https://libraries.minecraft.net/library.jar', { headers: { Range: 'bytes=5-', 'If-Range': '"native"' }, redirect: 'error' });
  assert.equal(await reply.text(), 'native bytes'); assert.equal(reply.headers.get('etag'), '"native"');
  const native = f.requests[0]!; assert.equal(native.options.redirect, 'manual'); assert.equal(native.options.useSessionCookies, false); assert.equal(native.options.credentials, 'omit');
  assert.equal(native.headers.get('range'), 'bytes=5-'); assert.equal(native.headers.get('if-range'), '"native"');
  await assert.rejects(f.request('http://libraries.minecraft.net/library.jar')); await assert.rejects(f.request('https://user:pass@libraries.minecraft.net/library.jar'));
  assert.equal(f.requests.length, 1);
});

test('desktop redirects are either returned as one manual hop or refused; never followed implicitly', async () => {
  const f = fixture(request => { request.emit('redirect', 302, 'GET', 'https://other.invalid/file', {}); });
  const reply = await f.request('https://libraries.minecraft.net/a', { redirect: 'manual' });
  assert.equal(reply.status, 302); assert.equal(reply.headers.get('location'), 'https://other.invalid/file'); assert.equal(f.requests[0]!.aborted, true);
  await assert.rejects(f.request('https://libraries.minecraft.net/a', { redirect: 'error' }), /NETWORK_REDIRECT_REJECTED/);
  await assert.rejects(f.request('https://libraries.minecraft.net/a', { redirect: 'follow' }), /NETWORK_REDIRECT_REJECTED/);
});

test('desktop cancellation before headers and during streaming aborts the owned native request', async () => {
  const before = fixture(() => {}); const abort = new AbortController();
  const pending = before.request('https://libraries.minecraft.net/a', { signal: abort.signal }); abort.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(before.requests[0]!.aborted, true);
  const stream = new Readable({ read() {} }); const during = fixture(request => { response(request, 200, stream); });
  const controller = new AbortController(); const reply = await during.request('https://libraries.minecraft.net/a', { signal: controller.signal });
  const reader = reply.body!.getReader(); const read = reader.read(); controller.abort();
  await assert.rejects(read, { name: 'AbortError' }); assert.equal(stream.destroyed, true); assert.equal(during.requests[0]!.aborted, true);
  const cancel = new Readable({ read() {} }); const f = fixture(request => { response(request, 200, cancel); });
  const responseToCancel = await f.request('https://libraries.minecraft.net/a'); await responseToCancel.body!.cancel();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests[0]!.aborted, true);
});

test('desktop adapter forwards explicit JSON POST and returns no body for HEAD, without retaining auth or raw errors', async () => {
  const f = fixture(request => { response(request); });
  const reply = await f.request('https://api.modrinth.com/v2/version_files', { method: 'POST', body: '{"hashes":[]}' }); await reply.text(); assert.equal(f.requests[0]!.written, '{"hashes":[]}');
  assert.equal((await f.request('https://libraries.minecraft.net/a', { method: 'HEAD' })).body, null);
  const bad = fixture(request => { request.emit('error', new Error('private native error')); });
  await assert.rejects(bad.request('https://libraries.minecraft.net/a'), /NETWORK_REQUEST_FAILED/);
  let credentialsProvided = false;
  const auth = fixture(request => { request.emit('login', {}, () => { credentialsProvided = true; }); });
  await assert.rejects(auth.request('https://libraries.minecraft.net/a'), /NETWORK_AUTH_REJECTED/); assert.equal(credentialsProvided, true); assert.equal(auth.requests[0]!.aborted, true);
});
