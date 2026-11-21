const { app } = require('electron');
const { mkdir, writeFile, lstat } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

app.disableHardwareAcceleration();
const base = path.resolve(process.env.OUCL_RESOURCE_UI_ROOT || '');
assert.ok(base.startsWith(path.resolve('.test-build') + path.sep) && path.basename(base).startsWith('resource-ui-'));
const profile = path.join(base, 'profile'); const games = path.join(base, 'games');
const evidence = path.resolve('docs/validation/UI-0.2.0');
const timer = setTimeout(() => { console.error('RESOURCE_UI_TIMEOUT'); app.exit(1); }, 300000);
let finished = false;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(window) {
  if (finished) return; finished = true;
  const evalJS = expression => window.webContents.executeJavaScript(expression);
  const waitFor = async (expression, ms = 18000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evalJS(expression)) return; await pause(150); } throw new Error(`UI_CONDITION_TIMEOUT:${expression.slice(0,100)}`); };
  try {
    await waitFor(`!!document.querySelector('[data-status="connected"]') && !!document.querySelector('select[aria-label="选择离线账户"] option')?.textContent.includes('UI_Player')`);
    await evalJS(`document.querySelectorAll('.top-nav button')[1].click()`); await pause(100);
    await evalJS(`document.querySelectorAll('.download-tabs button')[1].click()`);
    await waitFor(`document.querySelectorAll('.resource-row').length > 0`);
    await evalJS(`(async()=>{const input=document.querySelector('.resource-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'FerriteCore');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,80));document.querySelector('.resource-search').requestSubmit()})()`);
    await waitFor(`document.querySelector('.resource-row strong')?.textContent.includes('FerriteCore')`);
    await evalJS(`document.querySelector('.resource-row').click()`);
    await waitFor(`!!document.querySelector('.resource-detail .primary') && !document.querySelector('.resource-detail .primary').disabled`);
    await writeFile(path.join(evidence, 'resources.png'), (await window.webContents.capturePage()).toPNG());
    const selected = await evalJS(`({title:document.querySelector('.resource-detail h2').textContent,version:document.querySelector('.resource-detail select').value})`);
    await evalJS(`document.querySelector('.resource-detail .primary').click()`); await pause(100);
    await evalJS(`document.querySelectorAll('.top-nav button')[0].click()`);
    await waitFor(`(async()=>{const r=await window.oucl.resourceLibrary();return r.ok&&r.data.items.length>0})()`);
    let library; const attempts = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const deadline = Date.now() + 120000;
      do { library = await evalJS(`(async()=>{const r=await window.oucl.resourceLibrary();if(!r.ok)return null;const item=r.data.items.at(-1);return item?{item,task:await window.oucl.getTask(item.taskId)}:null})()`); if (library?.item.downloaded || ['failed','cancelled','needsRecovery'].includes(library?.task?.data?.snapshot?.state)) break; await pause(400); } while (Date.now() < deadline);
      attempts.push({ state: library?.task?.data?.snapshot?.state, errorCode: library?.item.errorCode });
      if (library?.item.downloaded) break;
      assert.ok(['failed','cancelled','needsRecovery'].includes(library?.task?.data?.snapshot?.state),'RESOURCE_TRANSFER_DID_NOT_SETTLE');
      await evalJS(`document.querySelectorAll('.top-nav button')[1].click()`); await pause(100); await evalJS(`document.querySelectorAll('.download-tabs button')[4].click()`);
      await waitFor(`!!document.querySelector('.library-item .secondary')`); await pause(500);
      await evalJS(`[...document.querySelectorAll('.library-item .secondary')].at(-1).click()`); await pause(300); await evalJS(`document.querySelectorAll('.top-nav button')[0].click()`);
    }
    assert.ok(library?.item.downloaded, JSON.stringify(library)); assert.equal(library.task.data.snapshot.state, 'completed');
    await evalJS(`document.querySelectorAll('.top-nav button')[1].click()`); await pause(100); await evalJS(`document.querySelectorAll('.download-tabs button')[4].click()`);
    await waitFor(`document.querySelector('.library-panel')?.textContent.includes('已校验')`);
    await writeFile(path.join(evidence, 'library.png'), (await window.webContents.capturePage()).toPNG());
    const filename = path.join(games, 'resource-library', library.item.kind, library.item.taskId, library.item.filename); assert.ok((await lstat(filename)).isFile() || (await lstat(filename)).isSymbolicLink());
    await evalJS(`document.querySelectorAll('.top-nav button')[3].click()`); await pause(120);
    assert.equal(await evalJS(`document.querySelector('.setting-row input[type=number]').value`), '3072');
    await evalJS(`document.querySelectorAll('.top-nav button')[1].click(); document.querySelectorAll('.download-tabs button')[0].click()`);
    await waitFor(`document.querySelector('.version-list li') !== null`);
    await evalJS(`document.querySelector('.version-list li button').click()`); await pause(120);
    assert.equal(await evalJS(`document.querySelector('.install-confirm select').value`), 'off');
    await writeFile(path.join(evidence, 'resource-ui.json'), JSON.stringify({ timestamp: new Date().toISOString(), status: 'PASS', selected, realDownloadSubmittedThroughDom: true,
      downloadCompletedWhileHomeVisible: true, libraryVisible: true, settingsLoadedFromDisk: true, newInstanceIsolationDefaultApplied: true,
      taskId: library.item.taskId, filename: library.item.filename, attempts, operatedUserWindows: false }, null, 2));
    console.log('RESOURCE_UI_PASS'); clearTimeout(timer); await window.webContents.session.closeAllConnections(); window.close(); app.quit();
  } catch (error) { console.error(error); await writeFile(path.join(evidence, 'resource-ui.json'), JSON.stringify({ timestamp: new Date().toISOString(), status: 'FAIL', error: error.code ?? error.message }, null, 2)); clearTimeout(timer); window.close(); app.quit(); process.exitCode = 1; }
}
void (async () => {
  await mkdir(profile, { recursive: true }); await mkdir(games); await mkdir(evidence, { recursive: true });
  const metadata = path.join(profile, 'metadata'); await mkdir(metadata);
  const { StorageClient } = await import(pathToFileURL(path.resolve('.test-build/src/services/workers/storage-client.js')).href);
  const { ProfileService } = await import(pathToFileURL(path.resolve('.test-build/src/services/launch/profiles.js')).href);
  const storage = await StorageClient.open(pathToFileURL(path.resolve('dist/workers/entry.cjs')), metadata);
  try { await storage.createInstallation({ rootId: randomUUID(), dataDirectory: games }); await storage.writeSettings(0, { memoryMiB: 3072, isolationDefault: false }); await new ProfileService(storage).createOffline(randomUUID(), { displayName: 'OUCL 测试档案', gameName: 'UI_Player' }); }
  finally { await storage.close(); }
  app.setPath('userData', profile);
  app.on('browser-window-created', (_event, window) => { window.webContents.once('did-finish-load', () => { void run(window); }); });
  require('../dist/main/index.cjs');
})().catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
