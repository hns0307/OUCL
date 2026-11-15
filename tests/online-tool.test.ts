import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONLINE_TOOL_REGISTRY, onlineToolUrlAllowed, validateOnlineToolRegistry } from '../src/core/tools/online-policy.js';
import type { OnlineToolDefinition } from '../src/core/tools/online-policy.js';
import { OnlineToolError, OnlineToolService } from '../src/services/tools/service.js';
import type { OnlineToolViewFactory } from '../src/services/tools/service.js';

const tool: OnlineToolDefinition = { toolId: 'fixture', title: 'Synthetic fixture only', entryUrl: 'https://tools.example.com/start',
  documentOrigin: 'https://tools.example.com', resourceOrigins: ['https://cdn.example.com'] };
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async (): Promise<void> => { await new Promise<void>(resolve => { setImmediate(resolve); }); };

test('default product registry has no guessed site or URL opening capability', async () => {
  const service = new OnlineToolService({ create: () => { throw new Error('must not create'); } });
  assert.deepEqual(ONLINE_TOOL_REGISTRY, []); assert.deepEqual(service.list(), []);
  await assert.rejects(service.open('https://tools.example.com'), (error: unknown) => error instanceof OnlineToolError && error.code === 'TOOL_NOT_FOUND');
  assert.equal(service.state().phase, 'closed');
});
test('navigation origins and resource origins are separate exact HTTPS allowlists', () => {
  assert.equal(onlineToolUrlAllowed(tool, 'https://tools.example.com/other#anchor', 'document'), true);
  assert.equal(onlineToolUrlAllowed(tool, 'https://cdn.example.com/file.js', 'resource'), true);
  assert.equal(onlineToolUrlAllowed(tool, 'https://cdn.example.com/', 'document'), false);
  for (const url of ['http://tools.example.com', 'https://tools.example.com.evil.com', 'https://tools.example.com:444',
    'https://a:secret@tools.example.com', 'file:///a', 'data:text/html,a', 'javascript:alert(1)', 'wss://tools.example.com',
    'https://127.0.0.1', 'https://[::1]', 'https://printer.local', 'https://tools.example.com.']) {
    assert.equal(onlineToolUrlAllowed(tool, url, 'resource'), false, url);
  }
});
test('registry validation rejects malformed identities, private origins and mutable caller configuration', () => {
  assert.throws(() => validateOnlineToolRegistry([tool, tool]), /INVALID_TOOL_REGISTRY/);
  for (const change of [{ toolId: '../bad' }, { documentOrigin: `${tool.documentOrigin}/` }, { entryUrl: 'https://127.0.0.1/' },
    { resourceOrigins: ['https://server.internal'] }]) assert.throws(() => validateOnlineToolRegistry([{ ...tool, ...change }]), /INVALID_TOOL_REGISTRY/);
  const input = { ...tool, resourceOrigins: [...tool.resourceOrigins] };
  const registry = validateOnlineToolRegistry([input]); input.title = 'modified'; input.resourceOrigins.push('https://evil.example.com');
  assert.equal(registry[0]?.title, tool.title); assert.equal(registry[0]?.resourceOrigins.length, 1);
});
test('repeated open reuses one pending view and returns redacted state', async () => {
  const loading = deferred(); let created = 0;
  const service = new OnlineToolService({ create: () => { created++; return { load: () => loading.promise, dispose: async () => {} }; } }, [tool]);
  const first = service.open(tool.toolId), second = service.open(tool.toolId);
  await tick(); assert.equal(created, 1); assert.equal(service.state().phase, 'loading');
  loading.resolve(); await Promise.all([first, second]);
  assert.equal(service.state().phase, 'ready'); assert.equal(JSON.stringify(service.state()).includes('https:'), false);
  assert.deepEqual(service.list(), [{ toolId: tool.toolId, title: tool.title }]); await service.close();
});
test('close invalidates late loading and awaits native cleanup before confirming closed', async () => {
  const loading = deferred(), cleanup = deferred(); let disposed = 0;
  const service = new OnlineToolService({ create: () => ({ load: () => loading.promise, dispose: () => { disposed++; return cleanup.promise; } }) }, [tool]);
  const opening = service.open(tool.toolId); await tick(); const closing = service.close(); await tick();
  assert.equal(disposed, 1); assert.equal(service.state().phase, 'closing');
  loading.resolve(); await opening; assert.equal(service.state().phase, 'closing');
  cleanup.resolve(); await closing; assert.equal(service.state().phase, 'closed');
});
test('new open waits for old cleanup and stale failure cannot close its replacement', async () => {
  const loading = deferred(), cleanup = deferred(); const failures: (() => void)[] = []; let created = 0;
  const next = { ...tool, toolId: 'next' };
  const factory: OnlineToolViewFactory = { create: (_definition, failed) => {
    failures.push(failed); const index = ++created;
    return { load: () => index === 1 ? loading.promise : Promise.resolve(), dispose: () => index === 1 ? cleanup.promise : Promise.resolve() };
  } };
  const service = new OnlineToolService(factory, [tool, next]);
  const first = service.open(tool.toolId); await tick(); const second = service.open(next.toolId); await tick(); assert.equal(created, 1);
  cleanup.resolve(); await second; failures[0]?.(); loading.reject(new Error('late failure')); await first;
  assert.equal(created, 2); assert.equal(service.state().phase, 'ready'); assert.equal(service.state().toolId, 'next'); await service.close();
});
test('failed load destroys view and reports controlled failure', async () => {
  let disposed = 0;
  const service = new OnlineToolService({ create: () => ({ load: async () => { throw new Error('secret URL or path'); }, dispose: async () => { disposed++; } }) }, [tool]);
  const result = await service.open(tool.toolId);
  assert.equal(disposed, 1); assert.equal(result.phase, 'failed'); assert.equal(result.code, 'LOAD_FAILED'); assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('cleanup failure quarantines service instead of opening alongside unknown native survivor', async () => {
  let created = 0;
  const service = new OnlineToolService({ create: () => {
    created++; return { load: async () => {}, dispose: async () => { throw new Error('native destroy failed'); } };
  } }, [tool]);
  await service.open(tool.toolId); assert.equal((await service.close()).code, 'CLEANUP_FAILED');
  assert.equal((await service.open(tool.toolId)).code, 'CLEANUP_FAILED'); assert.equal(created, 1);
});
test('renderer crash invalidates in-flight load and disposes only its generation', async () => {
  let fail!: () => void; let disposed = 0; const loading = deferred();
  const service = new OnlineToolService({ create: (_tool, callback) => { fail = callback;
    return { load: () => loading.promise, dispose: async () => { disposed++; } }; } }, [tool]);
  const opening = service.open(tool.toolId); await tick(); fail(); await tick(); loading.resolve(); await opening;
  assert.equal(service.state().phase, 'failed'); assert.equal(disposed, 1);
});
test('synchronous construction failure still releases the returned view', async () => {
  let disposed = 0; const loading = deferred();
  const service = new OnlineToolService({ create: (_tool, failed) => { failed();
    return { load: () => loading.promise, dispose: async () => { disposed++; } }; } }, [tool]);
  const opening = service.open(tool.toolId); await tick(); loading.resolve(); await opening;
  assert.equal(disposed, 1); assert.equal(service.state().phase, 'failed');
});
test('retry creates a fresh view and losing retry cannot overwrite a newer explicit selection', async () => {
  let created = 0; const cleanup = deferred();
  const next = { ...tool, toolId: 'next' };
  const service = new OnlineToolService({ create: () => {
    const number = ++created; return { load: async () => {}, dispose: () => number === 1 ? cleanup.promise : Promise.resolve() };
  } }, [tool, next]);
  await service.open(tool.toolId); const retry = service.retry(); const replacement = service.open(next.toolId); cleanup.resolve();
  await Promise.all([retry, replacement]); assert.equal(service.state().toolId, next.toolId); assert.equal(created, 2); await service.close();
});
test('unsubscribing observers does not close the tool and failed observers cannot stop cleanup', async () => {
  let events = 0; let disposed = 0;
  const service = new OnlineToolService({ create: () => ({ load: async () => {}, dispose: async () => { disposed++; } }) }, [tool]);
  const unsubscribe = service.onChange(() => { events++; }); service.onChange(() => { throw new Error('observer'); });
  await service.open(tool.toolId); unsubscribe(); const before = events; await service.close();
  assert.equal(events, before); assert.equal(disposed, 1); assert.equal(service.state().phase, 'closed');
});
