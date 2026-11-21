import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { getEventListeners } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixedPackCoordinator, FixedPackReader, fixedPackPreview, handleFixedPack } from './production.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = path.join(here, 'fixtures'); await mkdir(temp, { recursive: true });
const workerFile = path.join(temp, 'lifecycle-worker.cjs');
const valid = { version: 1, kind: 'fixed-pack-result', preview: fixedPackPreview(889) };
await writeFile(workerFile, `const {parentPort,workerData}=require('node:worker_threads');
const name=require('node:path').basename(workerData.file);
if(name==='reply-hold.input'){parentPort.postMessage(${JSON.stringify(valid)});setInterval(()=>{},1000);}
else if(name==='hang.input'){setInterval(()=>{},1000);}
else {parentPort.postMessage(${JSON.stringify(valid)});}
`);
const input = mode => path.join(temp, mode + '.input');
for (const mode of ['hang', 'reply-hold', 'normal']) await writeFile(input(mode), 'Lifecycle fixture only; this is not a real mrpack.');
function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

// Observation is scoped to this new test process and removed after every case.
// Every actual emit/terminate is delegated unchanged; no event is fabricated,
// exit delayed, Worker replaced, private Reader state accessed, or external process touched.
function observeWorkers(trace, callbacks) {
  const emit = Worker.prototype.emit; const terminate = Worker.prototype.terminate;
  const ids = new WeakMap(); const live = new Set(); let sequence = 0;
  const id = worker => { if (!ids.has(worker)) ids.set(worker, ++sequence); return ids.get(worker); };
  const mark = (kind, detail = {}) => trace.push({ sequence: trace.length, kind, ...detail });
  Worker.prototype.emit = function (event, ...args) {
    if (event === 'online') { const workerId = id(this); live.add(workerId); mark('worker-online', { workerId }); callbacks.online?.(workerId); }
    if (event === 'exit') { const workerId = id(this); live.delete(workerId); mark('worker-exit', { workerId, exitCode: args[0] }); }
    const result = Reflect.apply(emit, this, [event, ...args]);
    if (event === 'message') {
      const workerId = id(this); mark('message-after-reader-listeners', { workerId, kindReceived: args[0]?.kind });
      callbacks.message?.(workerId, args[0]);
    }
    return result;
  };
  Worker.prototype.terminate = function (...args) {
    const workerId = id(this); mark('reader-terminate-called', { workerId }); callbacks.terminate?.(workerId);
    return Reflect.apply(terminate, this, args);
  };
  return { live, mark, get count() { return sequence; }, restore() { Worker.prototype.emit = emit; Worker.prototype.terminate = terminate; } };
}

async function runCase(name, body) {
  const trace = []; const callbacks = {}; const observer = observeWorkers(trace, callbacks);
  const tracked = []; const cleanup = []; const signals = []; const unhandled = []; let service; let passed = false;
  const onUnhandled = error => unhandled.push(error?.message ?? String(error)); process.on('unhandledRejection', onUnhandled);
  const track = promise => { tracked.push(promise); void promise.catch(() => {}); return promise; };
  const ctx = { trace, callbacks, observer, tracked, cleanup, signals, track, mark: observer.mark,
    make(budget = 2500) {
      const reader = new FixedPackReader(workerFile, budget);
      service = new FixedPackCoordinator((file, signal) => { signals.push(signal); observer.mark('reader-admitted', { aborted: signal.aborted }); return reader.preview(file, signal); });
      return { reader, service };
    },
    public(promise, requestId) {
      return track(handleFixedPack({ contractVersion: 1, requestId, payload: {} }, true, randomUUID(), () => promise));
    },
  };
  try {
    await body(ctx);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(observer.live.size, 0, 'every admitted real Worker must actually exit');
    for (const signal of signals) assert.equal(getEventListeners(signal, 'abort').length, 0, 'Reader removes abort listener on exit');
    assert.deepEqual(unhandled, []);
    passed = true;
  } finally {
    // Only test-owned readers/workers can exist in this isolated process.
    for (const release of cleanup) release(); service?.removeSender(1); service?.removeSender(2);
    await Promise.allSettled(tracked);
    observer.restore(); process.off('unhandledRejection', onUnhandled);
    await writeFile(path.join(here, name + '.json'), JSON.stringify({ name, passed, trace, liveWorkersAfterCleanup: [...observer.live], unhandled,
      workerFixtureScope: 'Real Node Workers with controlled protocol-valid messages; not fixed mrpack content validation or Electron/native GUI.' }, null, 2));
  }
}
function at(ctx, kind, predicate = () => true) { return ctx.trace.findIndex(row => row.kind === kind && predicate(row)); }
async function nextSuccess(ctx, service, sender = 1) {
  const id = randomUUID(); ctx.mark('next-request-issued');
  const internal = ctx.track(service.inspect(sender, id, () => true, async () => input('normal')));
  const response = await ctx.public(internal, id);
  assert.equal(response.ok, true); assert.equal(response.data.state, 'preview'); assert.equal(response.data.preview.status, 'unknown');
  ctx.mark('next-request-succeeded');
}

for (const terminal of ['selected', 'cancelled', 'rejected']) test('R1 chooser settles after invalidation: ' + terminal, { timeout: 15000, concurrency: false }, () => runCase('r1-' + terminal, async ctx => {
  const { service } = ctx.make(); const chooser = deferred(); ctx.cleanup.push(() => chooser.resolve(undefined));
  const id = randomUUID(); let calls = 0;
  const internal = ctx.track(service.inspect(1, id, () => true, () => { calls++; ctx.mark('chooser-open'); return chooser.promise; }));
  const reply = ctx.public(internal, id);
  ctx.mark('sender-invalidated'); service.removeSender(1);
  await assert.rejects(service.inspect(1, randomUUID(), () => true, async () => { calls++; return input('normal'); }), /UNAVAILABLE/);
  assert.equal(calls, 1); assert.equal(ctx.observer.count, 0);
  ctx.mark('chooser-terminal', { terminal });
  if (terminal === 'selected') chooser.resolve(input('normal'));
  else if (terminal === 'cancelled') chooser.resolve(undefined);
  else chooser.reject(new Error('CHOOSER_REJECTED'));
  const result = await reply;
  assert.equal(result.ok, false); assert.equal(result.error.code, terminal === 'rejected' ? 'UNAVAILABLE' : 'INVALID_SENDER');
  assert.equal(ctx.observer.count, 0, 'no Worker may start from a late chooser result'); ctx.mark('old-request-rejected');
  await nextSuccess(ctx, service);
  assert.equal(ctx.observer.count, 1); assert.ok(at(ctx, 'chooser-terminal') < at(ctx, 'old-request-rejected'));
  assert.ok(at(ctx, 'old-request-rejected') < at(ctx, 'next-request-issued'));
}));

for (const first of ['abort', 'deadline']) test('R2 active worker, first terminal is ' + first, { timeout: 15000, concurrency: false }, () => runCase('r2-' + first + '-first', async ctx => {
  const { service, reader } = ctx.make(first === 'deadline' ? 1000 : 2500);
  const online = deferred(); let rootWorker; let handledTerminate = false; const probes = [];
  ctx.callbacks.online = workerId => { if (rootWorker === undefined) { rootWorker = workerId; online.resolve(); } };
  ctx.callbacks.terminate = workerId => {
    if (workerId !== rootWorker || handledTerminate) return; handledTerminate = true;
    // Both refusal probes are issued while the formal Reader still owns this live worker.
    probes.push(ctx.track(reader.preview(input('normal')).then(() => assert.fail('Reader released before exit'), error => {
      assert.equal(error.message, 'QUEUE_FULL'); ctx.mark('reader-slot-refused-before-exit');
    })));
    probes.push(ctx.track(service.inspect(2, randomUUID(), () => true, async () => input('normal')).then(() => assert.fail('Coordinator released before exit'), error => {
      assert.equal(error.message, 'UNAVAILABLE'); ctx.mark('global-slot-refused-before-exit');
    })));
    if (first === 'deadline') { ctx.mark('sender-invalidated-after-deadline'); service.removeSender(1); }
  };
  const id = randomUUID();
  const internal = ctx.track(service.inspect(1, id, () => true, async () => input('hang')));
  const reply = ctx.public(internal, id); await online.promise;
  if (first === 'abort') { ctx.mark('sender-invalidated-before-deadline'); service.removeSender(1); }
  const result = await reply; ctx.mark('old-request-rejected', { code: result.error?.code });
  await Promise.all(probes); assert.equal(result.ok, false); assert.equal(result.error.code, first === 'abort' ? 'CANCELLED' : 'TIMEOUT');
  const exit = at(ctx, 'worker-exit', row => row.workerId === rootWorker);
  assert.ok(exit >= 0 && exit < at(ctx, 'old-request-rejected'), 'public rejection must follow actual Worker exit');
  assert.ok(at(ctx, 'reader-slot-refused-before-exit') < exit); assert.ok(at(ctx, 'global-slot-refused-before-exit') < exit);
  assert.equal(ctx.trace.filter(row => row.kind === 'message-after-reader-listeners' && row.workerId === rootWorker).length, 0);
  await nextSuccess(ctx, service); assert.equal(ctx.observer.count, 2);
}));

test('R3 valid result parsed but Worker not exited when sender invalidates', { timeout: 15000, concurrency: false }, () => runCase('r3-result-before-exit', async ctx => {
  const { service } = ctx.make(); let rootWorker; let invalidated = false;
  ctx.callbacks.online = workerId => { rootWorker ??= workerId; };
  ctx.callbacks.message = (workerId, message) => {
    if (workerId !== rootWorker || invalidated) return;
    assert.deepEqual(message, valid); invalidated = true;
    ctx.mark('valid-message-seen-before-invalidation'); ctx.mark('sender-invalidated'); service.removeSender(1);
  };
  const id = randomUUID(); const internal = ctx.track(service.inspect(1, id, () => true, async () => input('reply-hold')));
  const result = await ctx.public(internal, id); ctx.mark('old-request-rejected', { code: result.error?.code });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'CANCELLED');
  const message = at(ctx, 'valid-message-seen-before-invalidation');
  const invalid = at(ctx, 'sender-invalidated'); const exit = at(ctx, 'worker-exit', row => row.workerId === rootWorker);
  assert.ok(message >= 0 && message < invalid && invalid < exit && exit < at(ctx, 'old-request-rejected'));
  await nextSuccess(ctx, service); assert.equal(ctx.observer.count, 2);
}));
