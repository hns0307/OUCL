const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('SMOKE_TIMEOUT'); app.exit(1); }, 45000);
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
    assert.deepEqual([...renderer.bridgeKeys].sort(), ['catalog', 'checkMods', 'chooseJava', 'chooseRoot', 'controlTask', 'createInstance', 'createLoaderInstance', 'createOfflineAccount', 'downloadResource', 'getSession', 'getSettings', 'getTask', 'handshake', 'launchGame', 'listAccounts', 'listInstances', 'listInstancesV2', 'listMods', 'listRoots', 'listSessions', 'listTasks', 'loaderVersions', 'modReport', 'openResourceLibrary', 'resourceLibrary', 'resourceVersions', 'searchResources', 'stopGame', 'subscribeTask', 'updateSettings']);
    assert.ok(renderer.nodeAbsent);
    const modErrors = await window.webContents.executeJavaScript(`(async () => {
      const id = crypto.randomUUID();
      return [await window.oucl.listMods(id, { instanceId: '../private', expectedRevision: 1 }),
        await window.oucl.checkMods(id, { instanceId: id, expectedRevision: 1 }), await window.oucl.modReport(id)];
    })()`);
    assert.deepEqual(modErrors.map(reply => reply.ok ? 'unexpected-success' : reply.error.code), ['INVALID_ARGUMENT', 'ROOT_UNAVAILABLE', 'ROOT_UNAVAILABLE']);
    assert.equal(renderer.result.ok, true);
    assert.deepEqual(renderer.result.data.capabilities, ['roots.v1', 'catalog.v1', 'instances.v1', 'instances.v2', 'tasks.v1', 'java.v1', 'accounts.v1', 'settings.v1', 'game.v1', 'sessions.v1', 'resources.v1', 'loaders.v1', 'mods.v1']);
    await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.account-chooser .text-button').click(); await new Promise(resolve=>setTimeout(resolve,80));
      const fields = document.querySelectorAll('.account-form input');
      for (const [index,value] of ['Smoke member','OUCL_Smoke'].entries()) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(fields[index],value); fields[index].dispatchEvent(new Event('input',{bubbles:true})); }
      await new Promise(resolve=>setTimeout(resolve,100)); document.querySelector('.account-form button[type=submit]').click();
      const deadline=Date.now()+3000; while(!document.querySelector('select[aria-label="选择离线账户"] option')?.textContent.includes('OUCL_Smoke') && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,30));
    })()`);
    const accounts = await window.webContents.executeJavaScript('window.oucl.listAccounts()');
    assert.equal(accounts.ok, true); assert.equal(accounts.data.items.length, 1); assert.equal(accounts.data.items[0].gameName, 'OUCL_Smoke'); assert.equal('uuid' in accounts.data.items[0], false);
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
      return { selected: document.querySelector('.selected-version')?.textContent === id, disabledWithoutRoot: document.querySelector('.install-confirm .primary')?.disabled === true,
        loaderChoices: [...document.querySelectorAll('.install-confirm label select')[0].options].map(option => option.value) };
    })()`);
    assert.equal(confirmation.selected, true); assert.equal(confirmation.disabledWithoutRoot, true);
    assert.deepEqual(confirmation.loaderChoices, ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']);
    console.log('SMOKE_BRIDGE_AND_ISOLATION_PASS');
    await window.webContents.executeJavaScript(`window.open('https://example.com/')`);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    await new Promise(resolve => setTimeout(resolve, 500));
    const frame = await window.webContents.capturePage({ x: 0, y: 0, width: 1000, height: 680 });
    const directory = path.resolve(process.env.OUCL_SMOKE_REPORT_DIRECTORY ?? 'docs/validation/LOADERS-0.3.0');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'window.png'), frame.toPNG());
    for (const [index, name] of [[0, 'home'], [1, 'downloads'], [2, 'announcements'], [3, 'settings']]) {
      await window.webContents.executeJavaScript(`document.querySelectorAll('.top-nav button')[${index}].click()`);
      await new Promise(resolve => setTimeout(resolve, 120));
      await writeFile(path.join(directory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
      const overflow = await window.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth'); assert.equal(overflow, false, name);
    }
    await window.webContents.executeJavaScript(`document.querySelectorAll('.top-nav button')[3].click(); document.querySelectorAll('.setting-row input')[0].focus()`);
    const settings = await window.webContents.executeJavaScript(`(async()=>{
      const old = await window.oucl.getSettings(); const changed = await window.oucl.updateSettings(crypto.randomUUID(), {expectedRevision:old.data.revision,patch:{memoryMiB:1024,isolationDefault:false}});
      const stale = await window.oucl.updateSettings(crypto.randomUUID(), {expectedRevision:old.data.revision,patch:{memoryMiB:2048}});
      return {changed, stale, actual:await window.oucl.getSettings()};
    })()`);
    assert.equal(settings.changed.ok,true); assert.equal(settings.stale.error.code,'REVISION_CONFLICT'); assert.equal(settings.actual.data.memoryMiB,1024);
    window.setSize(720, 520); await window.webContents.executeJavaScript(`document.querySelectorAll('.top-nav button')[0].click()`); await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth'),false);
    await writeFile(path.join(directory,'small-window.png'),(await window.webContents.capturePage()).toPNG());
    const report = {
      timestamp: new Date().toISOString(), status: 'PASS', electron: process.versions.electron, node: process.versions.node,
      contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration,
      bridgeMethods: renderer.bridgeKeys, rendererHasNoNode: renderer.nodeAbsent, handshake: 'PASS', businessCapabilities: renderer.result.data.capabilities, popupDenied: true,
      modBridgeSchemaAndRootChecks: true,
      actualOfflineAccountDomCreation: true, accountUuidNotExposed: true, javaChooserOperated: false,
      rootsList: 'PASS', directoryButtonRendered: true, nativePickerSelected: false,
      officialCatalogLoaded: true, visibleCatalogItems: catalog.count, firstCatalogVersion: catalog.first,
      versionSelectionRendered: confirmation.selected, loaderChoices: confirmation.loaderChoices, installationBlockedWithoutRoot: confirmation.disabledWithoutRoot,
      fourPagesRendered: true, smallWindowNoHorizontalOverflow: true, settingsSaveAndConflict: true,
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
