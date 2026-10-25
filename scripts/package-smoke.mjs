import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, lstat, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const evidence = path.resolve('docs/validation/UI-0.2.0'); await mkdir(evidence, { recursive: true });
const directory = path.resolve('release', `OUCL-${metadata.version}-win32-x64`);
const profile = await mkdtemp(path.join(tmpdir(), 'oucl-package-smoke-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(directory, 'OUCL.exe'), ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-gpu'], {
  windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: environment,
});
const ended = once(child, 'exit');
let socket;
let sequence = 0;
const pending = new Map();
const deadline = Date.now() + 20000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function command(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP_TIMEOUT:${method}`)); }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function cleanup(entry) {
  const relative = path.relative(profile, entry);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(profile).startsWith('oucl-package-smoke-'));
  const info = await lstat(entry);
  if (info.isSymbolicLink() || !info.isDirectory()) return unlink(entry);
  for (const name of await readdir(entry)) await cleanup(path.join(entry, name));
  await rmdir(entry);
}

try {
  let port;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('PACKAGED_APP_EXITED');
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; await wait(100); }
  }
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'DEBUG_ENDPOINT_MISSING');
  const expected = pathToFileURL(path.join(directory, 'resources/app/dist/renderer/index.html')).href;
  let page;
  while (Date.now() < deadline) {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
    page = pages.find(item => item.type === 'page' && item.url === expected);
    if (page) break;
    await wait(100);
  }
  assert.ok(page, 'PACKAGED_ENTRY_NOT_LOADED');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const evaluation = { expression: `(async () => {
    const deadline = Date.now() + 5000;
    while (!document.querySelector('[data-status="connected"]') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    return { connected: !!document.querySelector('[data-status="connected"]'), noNode: typeof require === 'undefined' && typeof process === 'undefined', methods: Object.keys(window.oucl), handshake: await window.oucl.handshake(), title: document.title };
  })()`, awaitPromise: true, returnByValue: true };
  let evaluated;
  while (Date.now() < deadline) {
    try { evaluated = await command('Runtime.evaluate', evaluation); break; }
    catch (error) {
      if (!/Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
      await wait(150);
    }
  }
  assert.ok(evaluated, 'PACKAGED_RENDERER_NOT_READY');
  assert.equal(evaluated.exceptionDetails, undefined);
  const observed = evaluated.result.value;
  assert.ok(observed.connected && observed.noNode);
  assert.equal(observed.title, 'OUCL');
  assert.deepEqual([...observed.methods].sort(), ['catalog', 'chooseJava', 'chooseRoot', 'controlTask', 'createInstance', 'createOfflineAccount', 'downloadResource', 'getSession', 'getSettings', 'getTask', 'handshake', 'launchGame', 'listAccounts', 'listInstances', 'listRoots', 'listSessions', 'listTasks', 'openResourceLibrary', 'resourceLibrary', 'resourceVersions', 'searchResources', 'stopGame', 'subscribeTask', 'updateSettings']);
  assert.equal(observed.handshake.ok, true);
  assert.deepEqual(observed.handshake.data.capabilities, ['roots.v1', 'catalog.v1', 'instances.v1', 'tasks.v1', 'java.v1', 'accounts.v1', 'settings.v1', 'game.v1', 'sessions.v1', 'resources.v1']);
  assert.ok((await lstat(path.join(profile, 'metadata', 'tasks.sqlite'))).isFile(), 'METADATA_NOT_IN_TEMP_PROFILE');
  const source = await readFile('dist/main/index.cjs');
  const packaged = await readFile(path.join(directory, 'resources/app/dist/main/index.cjs'));
  assert.deepEqual(source, packaged);
  await wait(500);
  const screenshot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidence, 'package-window.png'), Buffer.from(screenshot.data, 'base64'));
  void command('Runtime.evaluate', { expression: 'window.close()', returnByValue: true }).catch(() => {});
  let closingTimer; let exitCode;
  try { [exitCode] = await Promise.race([ended, new Promise((_resolve, reject) => { closingTimer = setTimeout(() => { reject(new Error('NORMAL_CLOSE_TIMEOUT')); }, 10000); })]); }
  finally { clearTimeout(closingTimer); }
  assert.equal(exitCode, 0, 'NORMAL_PACKAGED_EXIT_FAILED');
  await assert.rejects(lstat(path.join(profile, 'metadata', 'owner.lock')), { code: 'ENOENT' });
  const report = { timestamp: new Date().toISOString(), status: 'PASS', defaultPackagedEntry: true, rendererConnected: true, rendererHasNoNode: true, bridgeMethods: observed.methods,
    businessCapabilities: observed.handshake.data.capabilities, normalExitCode: exitCode, metadataOwnerReleased: true, mainSha256: createHash('sha256').update(packaged).digest('hex'), temporaryLoopbackDebugger: true, signed: false };
  await writeFile(path.join(evidence, 'package-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (socket) socket.close();
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('TEST_CLOSED')); }
  if (child.exitCode === null) child.kill();
  await ended;
  await cleanup(profile);
}
