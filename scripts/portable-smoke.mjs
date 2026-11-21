import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, lstat, unlink, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Uses only repository-built EXEs and the installed Electron payload; no download or user profile is needed.
const meta = JSON.parse(await readFile('package.json', 'utf8'));
const executable = path.resolve(process.env.OUCL_EXE_TEST_PATH ?? `release/OUCL-${meta.version}.exe`);
const base = await mkdtemp(path.resolve('.test-build/portable-roots-'));
const electronVersion = JSON.parse(await readFile('node_modules/electron/package.json', 'utf8')).version;
const checksum = JSON.parse(await readFile('node_modules/electron/checksums.json', 'utf8'))[`electron-v${electronVersion}-win32-x64.zip`];
assert.match(checksum, /^[a-f0-9]{64}$/);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { status: 'PASS', timestamp: new Date().toISOString(), executable, isolatedFixture: base, cases: [] };

async function fixture(name, blocked) {
  const folder = path.join(base, name); await mkdir(folder);
  const entry = path.join(folder, 'OUCL.exe'); await cp(executable, entry);
  const runtime = path.join(folder, 'OUCL.runtime'); await mkdir(runtime);
  await cp('node_modules/electron/dist', path.join(runtime, `electron-${checksum}`), { recursive: true });
  const games = path.join(folder, 'OUCL.games'); if (blocked) await writeFile(games, 'fixture blocker');
  return { folder, entry, games, profile: path.join(runtime, 'profile') };
}

async function run(f, blocked = false) {
  // Deliberately omit --user-data-dir: the real portable default is what this regression verifies.
  const child = spawn(f.entry, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--disable-gpu'],
    { cwd: base, windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(f.profile, 'DevToolsActivePort');
  let socket; let sequence = 0; const pending = new Map(); let closed = false;
  function command(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP_TIMEOUT:${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined); return response.result.value;
  }
  try {
    let port;
    for (let i = 0; i < 240; i++) {
      try { port = Number((await readFile(portFile, 'utf8')).split('\n')[0]); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await wait(250);
    }
    assert.ok(port, 'PORTABLE_PROFILE_DID_NOT_START');
    let page;
    for (let i = 0; i < 80; i++) {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = pages.find(item => item.type === 'page' && item.url.startsWith('file:') && item.url.endsWith('/dist/renderer/index.html'));
      if (page) break; await wait(100);
    }
    assert.ok(page); socket = new WebSocket(page.webSocketDebuggerUrl); await once(socket, 'open');
    socket.addEventListener('message', event => {
      const value = JSON.parse(String(event.data)); const request = pending.get(value.id); if (!request) return;
      clearTimeout(request.timer); pending.delete(value.id);
      if (value.error) request.reject(new Error(value.error.message)); else request.resolve(value.result);
    });
    // The first page can navigate while the portable preload is attaching. Retry only this read-only readiness probe.
    let value;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { value = await evaluate(`(async () => {
      for (let i=0;i<100 && !document.querySelector('[data-status="connected"]');i++) await new Promise(r=>setTimeout(r,50));
      return { handshake: await window.oucl.handshake(), roots: await window.oucl.listRoots(), noNode: typeof require === 'undefined' && typeof process === 'undefined' };
    })()`); break; }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed') || attempt === 29) throw error;
        await wait(100);
      }
    }
    assert.ok(value.handshake.ok && value.noNode && value.roots.ok);
    for (const capability of ['roots.v1', 'catalog.v1', 'instances.v2', 'mods.v1', 'skin.v1', 'web-extensions.v1', 'accounts.online.v1', 'multiplayer.v1']) assert.ok(value.handshake.data.capabilities.includes(capability));
    if (blocked) {
      assert.deepEqual(value.roots.data.items, []);
      const refused = await evaluate('window.oucl.chooseRoot(crypto.randomUUID())');
      assert.equal(refused.ok, false); assert.equal(refused.error.code, 'ROOT_UNAVAILABLE');
      assert.equal(await readFile(f.games, 'utf8'), 'fixture blocker');
      await unlink(f.games); // Only this test-created blocker is removed.
      const retried = await evaluate('window.oucl.chooseRoot(crypto.randomUUID())'); assert.ok(retried.ok);
      assert.equal(retried.data.selection, 'chosen');
    } else assert.equal(value.roots.data.items[0]?.available, true);
    assert.ok((await lstat(f.games)).isDirectory());
    const installation = JSON.parse(await readFile(path.join(f.profile, 'metadata/installation.json'), 'utf8'));
    assert.equal(installation.data.dataDirectory.toLowerCase(), (await realpath(f.games)).toLowerCase());
    assert.equal(installation.revision, 1);
    const chosen = await evaluate('window.oucl.chooseRoot(crypto.randomUUID())'); assert.ok(chosen.ok);
    assert.equal(chosen.data.rootId, installation.data.rootId);
    const roots = await evaluate('window.oucl.listRoots()'); assert.equal(roots.data.items[0].available, true);
    const screenshot = await command('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(f.folder, `window-${blocked ? 'retried' : 'ready'}.png`), Buffer.from(screenshot.data, 'base64'));
    void evaluate('window.close()').catch(() => {});
    const owner = path.join(f.profile, 'metadata/owner.lock');
    for (let i = 0; i < 100; i++) {
      try { await lstat(owner); } catch (error) { if (error.code === 'ENOENT') { closed = true; break; } throw error; }
      await wait(100);
    }
    assert.ok(closed, 'OWNER_NOT_RELEASED');
    report.cases.push({ name: path.basename(f.folder), blocked, portableProfile: true, gamesCreated: true,
      rootId: installation.data.rootId, revision: installation.revision, retryWithoutNativePicker: true, ownerReleased: closed });
    return installation;
  } finally {
    socket?.close(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('TEST_CLOSED')); }
    if (child.exitCode === null) child.kill();
    if (closed) await unlink(portFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

const fresh = await fixture('中文 自动目录', false);
const first = await run(fresh); const second = await run(fresh);
assert.deepEqual(second, first, 'RESTART_CHANGED_REGISTRATION');
await run(await fixture('目录失败重试', true), true);
const evidence = path.resolve(process.env.OUCL_VALIDATION_DIR ?? 'docs/validation/PORTABLE-ROOTS-20261028'); await mkdir(evidence, { recursive: true });
await writeFile(path.join(evidence, 'smoke.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
