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
    assert.deepEqual([...renderer.bridgeKeys].sort(), ['catalog', 'chooseRoot', 'controlTask', 'createInstance', 'getTask', 'handshake', 'listInstances', 'listRoots', 'listTasks', 'subscribeTask']);
    assert.ok(renderer.nodeAbsent);
    assert.equal(renderer.result.ok, true);
    assert.deepEqual(renderer.result.data.capabilities, ['roots.v1', 'catalog.v1', 'instances.v1', 'tasks.v1']);
    const roots = await window.webContents.executeJavaScript('window.oucl.listRoots()');
    assert.equal(roots.ok, true); assert.deepEqual(roots.data.items, []);
    const chooseButton = await window.webContents.executeJavaScript('!!document.querySelector(".root-settings button")');
    assert.ok(chooseButton);
    const catalog = await window.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 14000;
      while (!document.querySelector('.version-list li') && !document.querySelector('.catalog .form-error') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      return { count: document.querySelectorAll('.version-list li').length, first: document.querySelector('.version-list strong')?.textContent, error: !!document.querySelector('.catalog .form-error') };
    })()`);
    assert.ok(catalog.count > 0, 'OFFICIAL_CATALOG_DID_NOT_LOAD');
    const confirmation = await window.webContents.executeJavaScript(`(async () => {
      const rows = [...document.querySelectorAll('.version-list li')];
      const chosen = rows.find(row => row.querySelector('strong')?.textContent === '1.20.1') || rows[0];
      const id = chosen.querySelector('strong').textContent; chosen.querySelector('button').click();
      await new Promise(resolve => setTimeout(resolve, 100));
      return { selected: document.querySelector('.selected-version')?.textContent === id, disabledWithoutRoot: document.querySelector('.install-confirm .primary')?.disabled === true };
    })()`);
    assert.equal(confirmation.selected, true); assert.equal(confirmation.disabledWithoutRoot, true);
    console.log('SMOKE_BRIDGE_AND_ISOLATION_PASS');
    await window.webContents.executeJavaScript(`window.open('https://example.com/')`);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    await new Promise(resolve => setTimeout(resolve, 500));
    const frame = await window.webContents.capturePage({ x: 0, y: 0, width: 1000, height: 680 });
    const directory = path.resolve('docs/validation/A1-08-installer');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'window.png'), frame.toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('.catalog').scrollIntoView({block: 'start'})`);
    await new Promise(resolve => setTimeout(resolve, 150));
    await writeFile(path.join(directory, 'catalog.png'), (await window.webContents.capturePage({ x: 0, y: 0, width: 1000, height: 680 })).toPNG());
    const report = {
      timestamp: new Date().toISOString(), status: 'PASS', electron: process.versions.electron, node: process.versions.node,
      contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration,
      bridgeMethods: renderer.bridgeKeys, rendererHasNoNode: renderer.nodeAbsent, handshake: 'PASS', businessCapabilities: ['roots.v1', 'catalog.v1', 'instances.v1', 'tasks.v1'], popupDenied: true,
      rootsList: 'PASS', directoryButtonRendered: true, nativePickerSelected: false,
      officialCatalogLoaded: true, visibleCatalogItems: catalog.count, firstCatalogVersion: catalog.first,
      versionSelectionRendered: confirmation.selected, installationBlockedWithoutRoot: confirmation.disabledWithoutRoot,
      packagedPayload: false,
    };
    await writeFile(path.join(directory, 'smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    clearTimeout(timeout);
    await window.webContents.session.closeAllConnections();
    window.destroy();
    app.quit();
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
