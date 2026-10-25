import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const evidence = path.resolve('docs/validation/BOOTSTRAP-0.2.1'); await mkdir(evidence, { recursive: true });
const meta = JSON.parse(await readFile('package.json', 'utf8'));
const profile = await mkdtemp(path.resolve('.test-build/bootstrap-profile-'));
const testHarness = process.env.OUCL_COLD_START_HARNESS;
const child = spawn(testHarness ?? path.resolve(`release/OUCL-${meta.version}.exe`), [...(testHarness ? [path.join(profile, 'isolated-desktop-cache')] : []), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-gpu'], { windowsHide: true, stdio: 'ignore' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const started = Date.now();
let socket; let id = 0; const pending = new Map();
function command(method, params = {}) {
  const sequence = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(sequence); reject(new Error(`CDP_TIMEOUT:${method}`)); }, 15000);
    pending.set(sequence, { resolve, reject, timer }); socket.send(JSON.stringify({ id: sequence, method, params }));
  });
}
try {
  let port;
  for (let attempt = 0; attempt < 900; attempt++) {
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (attempt % 30 === 0) console.log(`Waiting for first-run preparation: ${Math.round((Date.now() - started) / 1000)}s`);
    await wait(500);
  }
  assert.ok(port, 'BOOTSTRAP_DID_NOT_START_APP');
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = pages.find(item => item.type === 'page' && item.url.startsWith('file:') && item.url.endsWith('/dist/renderer/index.html'));
    if (page) break; await wait(200);
  }
  assert.ok(page); socket = new WebSocket(page.webSocketDebuggerUrl); await once(socket, 'open');
  socket.addEventListener('message', event => { const value = JSON.parse(String(event.data)); const request = pending.get(value.id); if (!request) return;
    clearTimeout(request.timer); pending.delete(value.id); if (value.error) request.reject(new Error(value.error.message)); else request.resolve(value.result); });
  const result = await command('Runtime.evaluate', { expression: `(async () => {
    for (let i=0;i<100 && !document.querySelector('[data-status="connected"]');i++) await new Promise(r=>setTimeout(r,100));
    return { connected:!!document.querySelector('[data-status="connected"]'), noNode:typeof require==='undefined' && typeof process==='undefined', handshake:await window.oucl.handshake(), methods:Object.keys(window.oucl) };
  })()`, awaitPromise: true, returnByValue: true });
  assert.equal(result.exceptionDetails, undefined); const value = result.result.value;
  assert.ok(value.connected && value.noNode && value.handshake.ok); assert.equal(value.methods.length, 24); assert.equal(value.handshake.data.capabilities.length, 10);
  assert.ok((await lstat(path.join(profile, 'metadata/tasks.sqlite'))).isFile());
  const screenshot = await command('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(evidence, 'bootstrap-window.png'), Buffer.from(screenshot.data, 'base64'));
  void command('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {});
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await lstat(path.join(profile, 'metadata/owner.lock')); } catch (error) { if (error.code === 'ENOENT') break; throw error; } await wait(100);
  }
  await assert.rejects(lstat(path.join(profile, 'metadata/owner.lock')), { code: 'ENOENT' });
  const report = { timestamp: new Date().toISOString(), status: 'PASS', elapsedMs: Date.now() - started, entryBytes: (await lstat(`release/OUCL-${meta.version}.exe`)).size,
    defaultEntry: !testHarness, isolatedColdStartHarness: Boolean(testHarness), appUrl: page.url, rendererHasNoNode: value.noNode, capabilities: value.handshake.data.capabilities, methods: value.methods, ownerReleased: true };
  await writeFile(path.join(evidence, `smoke-${process.argv[2] ?? Date.now()}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  socket?.close(); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('TEST_CLOSED')); }
  // No user/game window is touched; test profiles remain available as evidence.
  if (child.exitCode === null) child.kill();
}
