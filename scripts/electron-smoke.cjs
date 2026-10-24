const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('SMOKE_TIMEOUT'); app.exit(1); }, 20000);
let finished = false;

async function run(window) {
  if (finished) return;
  finished = true;
  try {
    window.show();
    const prefs = window.webContents.getLastWebPreferences();
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.nodeIntegration, false);
    const renderer = await window.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 5000;
      while (!document.querySelector('[data-status="connected"]') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      const result = await window.oucl.handshake();
      return { connected: !!document.querySelector('[data-status="connected"]'), bridgeKeys: Object.keys(window.oucl), nodeAbsent: typeof require === 'undefined' && typeof process === 'undefined', result };
    })()`);
    assert.ok(renderer.connected);
    assert.deepEqual(renderer.bridgeKeys, ['handshake']);
    assert.ok(renderer.nodeAbsent);
    assert.equal(renderer.result.ok, true);
    assert.deepEqual(renderer.result.data.capabilities, []);
    console.log('SMOKE_BRIDGE_AND_ISOLATION_PASS');
    await window.webContents.executeJavaScript(`window.open('https://example.com/')`);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    await new Promise(resolve => setTimeout(resolve, 500));
    const frame = await window.webContents.capturePage({ x: 0, y: 0, width: 1000, height: 680 });
    const directory = path.resolve('docs/validation/P0-08');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'window.png'), frame.toPNG());
    const report = {
      timestamp: new Date().toISOString(), status: 'PASS', electron: process.versions.electron, node: process.versions.node,
      contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration,
      bridgeMethods: renderer.bridgeKeys, rendererHasNoNode: renderer.nodeAbsent, handshake: 'PASS', businessCapabilities: [], popupDenied: true,
      packagedPayload: false,
    };
    await writeFile(path.join(directory, 'smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    clearTimeout(timeout);
    await window.webContents.session.closeAllConnections();
    window.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  }
}

(async () => {
  const profile = process.env.OUCL_SMOKE_PROFILE;
  assert.ok(profile && path.basename(profile).startsWith('oucl-smoke-'));
  app.setPath('userData', profile);
  app.on('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', () => { void run(window); });
  });
  require('../dist/main/index.cjs');
})();
