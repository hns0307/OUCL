const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.disableHardwareAcceleration();
const base = path.resolve(process.env.OUCL_PC_UI_ROOT);
const permitted = path.resolve('docs/work-packages/P-C/evidence/v2a-ui');
assert.equal(base, permitted);
const { MaintenancePreviewJobs, handleMaintenancePreview, MAINTENANCE_PREVIEW_CHANNELS } = require(path.join(base, 'entry.cjs'));
let window; let calls = 0; let finishing = false;
const jobs = new MaintenancePreviewJobs({ preview: async (input, signal) => {
  calls++;
  if (calls > 1) await new Promise(resolve => { const timer = setTimeout(resolve, 5000); signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
  const provider = { fileId: input.fileId, id: 'example_mod', ownerId: 'example_mod', version: '1', via: [] };
  const local = { state: 'satisfied', issues: [], providers: [provider] };
  const platform = { state: 'satisfied', issues: [], files: [] };
  return { rootId: input.rootId, instanceId: input.instanceId, instanceRevision: input.expectedRevision, fingerprint: input.expectedFingerprint,
    filename: 'example.jar', sha256: 'd'.repeat(64), platformFailures: [], impact: { fileId: input.fileId, action: input.action, state: 'ready',
      before: { local, platform }, after: { local, platform }, introducedIssues: [], resolvedIssues: [], affectedProviders: [provider],
      directRequiredBy: [], transitiveRequiredBy: [], relations: [], truncated: false } };
} });
async function finish(code) {
  if (finishing) return; finishing = true; clearTimeout(timer);
  if (window && !window.isDestroyed()) window.destroy(); await jobs.close(); app.exit(code);
}
const timer = setTimeout(() => { console.error('PREVIEW_UI_TIMEOUT'); void finish(1); }, 30000);
async function run() {
  await mkdir(path.join(base, 'profile'), { recursive: true }); app.setPath('userData', path.join(base, 'profile'));
  await app.whenReady(); const documentUrl = pathToFileURL(path.join(base, 'index.html')).href;
  for (const channel of MAINTENANCE_PREVIEW_CHANNELS) ipcMain.handle(channel, (event, input) => handleMaintenancePreview(channel, input,
    event.sender === window.webContents && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === documentUrl, randomUUID(), jobs));
  window = new BrowserWindow({ width: 900, height: 700, show: false, webPreferences: { preload: path.join(base, 'dist/preload/index.cjs'),
    contextIsolation: true, sandbox: true, nodeIntegration: false } });
  await window.loadFile(path.join(base, 'index.html'));
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const wait = async expression => { const end = Date.now() + 8000; while (!await evaluate(`Boolean(${expression})`)) {
    if (Date.now() > end) throw new Error(`CONDITION_TIMEOUT:${expression}`); await new Promise(resolve => setTimeout(resolve, 30)); } };
  await wait('document.querySelector("button")');
  assert.equal(await evaluate("typeof require === 'undefined' && typeof process === 'undefined'"), true);
  await evaluate('document.querySelector("button").click()');
  await wait('document.body.innerText.includes("本次已知声明未发现阻止因素")');
  assert.equal(await evaluate('document.body.innerText.includes("example_mod")'), true);
  await evaluate('document.querySelector("button").click()');
  await wait('document.body.innerText.includes("取消预览")');
  await evaluate('[...document.querySelectorAll("button")].find(button => button.innerText.includes("取消预览")).click()');
  await wait('document.body.innerText.includes("已取消")');
  assert.equal(calls, 2);
  await writeFile(path.join(base, 'electron-ui.json'), JSON.stringify({ status: 'PASS', calls, actualComponent: true, actualPreload: true,
    actualIpcHandler: true, registry: true, scanFixture: true, productWindow: false, game: false, externalNetwork: false }, null, 2));
  console.log('MAINTENANCE_UI_PASS'); await finish(0);
}
app.on('window-all-closed', () => {});
void run().catch(async error => { console.error(error); if (window && !window.isDestroyed()) console.error(await window.webContents.executeJavaScript('document.body.innerText').catch(() => '')); await finish(1); });
