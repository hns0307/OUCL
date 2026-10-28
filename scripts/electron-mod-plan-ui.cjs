const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.disableHardwareAcceleration();
const base = path.resolve(process.env.OUCL_MOD_PLAN_UI_ROOT ?? '');
assert.ok(base.startsWith(path.resolve('.test-build') + path.sep) && path.basename(base).startsWith('mod-plan-ui-'));
const evidence = path.resolve(process.env.OUCL_VALIDATION_DIR ?? 'docs/validation/MOD-PUBLIC-20261028');
const profile = path.join(base, 'profile');
const rootId = '00000000-0000-4000-8000-000000000001'; const instanceId = '00000000-0000-4000-8000-000000000002';
let window; let storage; let plans; let installs; let finishing = false;
async function finish(code) {
  if (finishing) return; finishing = true;
  clearTimeout(timer); if (window && !window.isDestroyed()) window.destroy();
  try { await installs?.close(); await plans?.close(); } catch { code = 1; }
  finally { await storage?.close().catch(() => { code = 1; }); }
  app.exit(code);
}
const timer = setTimeout(() => { console.error('MOD_PLAN_UI_TIMEOUT'); void finish(1); }, 45000);
async function run() {
  await mkdir(profile); await mkdir(path.join(profile, 'metadata')); await mkdir(path.join(base, 'games'));
  app.setPath('userData', profile); await app.whenReady();
  const module = name => import(pathToFileURL(path.resolve(`.test-build/${name}.js`)).href);
  const { StorageClient } = await module('src/services/workers/storage-client');
  const { ModPlanService } = await module('src/services/mods/plans');
  const { modPlanDigest } = await module('src/services/mods/plan-identity');
  const { handleMods, modDispatcher } = await module('src/ipc/mods');
  const { MOD_CHANNELS } = await module('src/shared/contracts/mods');
  const { ModContractError } = await module('src/shared/contracts/mods');
  const { instanceFailure } = await module('src/shared/contracts/instances');
  const { ModInstallTaskService } = await module('src/services/mods/install-tasks');
  const { modReadyInstance } = await module('tests/fixtures/mod-ready-instance');
  storage = await StorageClient.open(path.resolve('dist/workers/entry.cjs'), path.join(profile, 'metadata'));
  await storage.createInstallation({ rootId, dataDirectory: path.join(base, 'games') });
  await storage.writeInstance(instanceId, 0, modReadyInstance(rootId, instanceId));
  installs = new ModInstallTaskService(storage, { prepare: async () => { throw new ModContractError('MODS_UNDETERMINED'); } },
    { commit: async () => { throw new Error('MUST_NOT_COMMIT'); }, recover: async () => { throw new Error('MUST_NOT_RECOVER'); } });
  await installs.initialize();
  let plannerCalls = 0;
  plans = new ModPlanService(storage, { plan: async input => {
    plannerCalls++;
    const body = { formatVersion: 1, instanceId: input.instanceId, instanceRevision: input.expectedRevision, fingerprint: 'b'.repeat(64),
      minecraft: '1.20.1', loader: 'fabric', rootVersionId: 'RootVer1', state: 'ready', attempts: 2, totalDownloadBytes: 7,
      items: [{ projectId: 'RootProj', versionId: 'RootVer1', filename: 'root.jar', fileId: 'a'.repeat(40), sha512: 'e'.repeat(128), size: 17, disposition: 'library', requiredBy: [] },
        { projectId: 'Depends1', versionId: 'DepVers1', filename: 'dependency.jar', fileId: 'c'.repeat(40), sha512: 'd'.repeat(128), size: 7, disposition: 'download', requiredBy: ['RootProj'] }], issues: [] };
    return { ...body, planId: modPlanDigest(body) };
  } });
  const dispatch = modDispatcher({ start: async () => { throw new Error('UNEXPECTED_SCAN'); }, report: async () => ({ report: null, errorCode: null }) }, undefined, plans, installs);
  const documentUrl = pathToFileURL(path.join(base, 'index.html')).href;
  for (const channel of MOD_CHANNELS) ipcMain.handle(channel, (event, input) => handleMods(channel, input,
    event.sender === window.webContents && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === documentUrl, randomUUID(), dispatch));
  ipcMain.handle('tasks:get', async (_event, input) => ({ contractVersion: 1, requestId: input.requestId, ok: true,
    data: await installs.taskView(rootId, input.payload.taskId) }));
  ipcMain.handle('tasks:list', async (_event, input) => ({ contractVersion: 1, requestId: input.requestId, ok: true, data: { items: await installs.list(rootId) } }));
  ipcMain.handle('tasks:subscribe', (_event, input) => instanceFailure(input.requestId, 'UNAVAILABLE', randomUUID()));
  ipcMain.handle('instances:list', async (_event, input) => ({ contractVersion: 1, requestId: input.requestId, ok: true,
    data: { items: [(await storage.readInstance(instanceId)).data.summary] } }));
  ipcMain.handle('instances.v2:list', (_event, input) => ({ contractVersion: 2, requestId: input.requestId, ok: true, data: { items: [] } }));
  const resource = { taskId: randomUUID(), projectId: 'RootProj', versionId: 'RootVer1', fileId: 'a'.repeat(40), title: 'Isolated root fixture',
    versionName: '1.0', filename: 'root.jar', kind: 'mod', size: 17, downloaded: true };
  ipcMain.handle('resources:library', (_event, request) => ({ contractVersion: 1, requestId: request.requestId, ok: true, data: { items: [resource] } }));
  window = new BrowserWindow({ width: 1000, height: 820, show: false, webPreferences: { preload: path.resolve('dist/preload/index.cjs'),
    contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadFile(path.join(base, 'index.html')); window.show();
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  async function wait(expression) {
    const deadline = Date.now() + 10000;
    while (!await evaluate(`Boolean(${expression})`)) {
      if (Date.now() > deadline) throw new Error(`UI_CONDITION_TIMEOUT:${expression}`); await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  await wait('document.querySelector(".library-item button")');
  assert.equal(await evaluate("typeof require === 'undefined' && typeof process === 'undefined'"), true);
  await evaluate('document.querySelector(".library-item button").click()');
  await wait('document.querySelector(".mod-plan-preview")');
  const text = await evaluate('document.querySelector(".mod-plan-preview").textContent');
  assert.ok(text.includes('dependency.jar') && text.includes('被谁依赖') && text.includes('Modrinth') && text.includes('7 B'));
  const pointer = `oucl.mod-plan:${rootId}:${instanceId}`;
  const requestId = await evaluate(`localStorage.getItem(${JSON.stringify(pointer)})`); assert.ok(requestId);
  const original = await plans.get(requestId); assert.equal(original.status, 'preview');
  const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await loaded;
  await wait('document.querySelector(".mod-plan-preview")'); assert.equal(plannerCalls, 1);
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(pointer)})`), requestId);
  await evaluate('[...document.querySelectorAll(".mod-plan-preview button")].find(button => button.textContent.includes("取消此计划")).click()');
  await wait('document.querySelector(".mod-plan-preview").textContent.includes("此安装计划已取消")');
  assert.equal((await plans.get(requestId)).status, 'cancelled');
  assert.equal((await storage.readModPlan(requestId)).revision, 2);
  assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(pointer)})`), null);
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'cancelled.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate('document.querySelector(".library-item button").click()');
  await wait('document.querySelector(".mod-plan-preview button")'); assert.equal(plannerCalls, 2);
  await wait('document.querySelector(".mod-install-confirmation button.primary") && !document.querySelector(".mod-install-confirmation button.primary").disabled');
  const installedRequest = await evaluate(`localStorage.getItem(${JSON.stringify(pointer)})`);
  assert.equal((await installs.state(installedRequest)).task, null);
  await evaluate('document.querySelector(".mod-install-confirmation button.primary").click()');
  await wait('document.querySelector(".mod-install-confirmation")?.dataset.installState === "failed"');
  const acceptedTask = (await installs.state(installedRequest)).task.taskId;
  assert.equal((await installs.state(installedRequest)).errorCode, 'MODS_UNDETERMINED');
  const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await reloaded;
  await wait('document.querySelector(".mod-install-confirmation")?.dataset.installState === "failed"');
  assert.equal((await installs.state(installedRequest)).task.taskId, acceptedTask);
  assert.equal(await evaluate('[...document.querySelectorAll(".mod-plan-preview button")].some(button => button.textContent.includes("取消此计划"))'), false);
  await writeFile(path.join(evidence, 'confirmed-failure.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate('document.querySelector(".library-item button").click()');
  await wait('document.querySelector(".mod-install-confirmation button.primary")'); assert.equal(plannerCalls, 3);
  await evaluate('document.querySelector("#change-revision").click()');
  await wait('!document.querySelector(".mod-plan-preview") && document.querySelector(".form-error")?.textContent.includes("旧修订")');
  window.setSize(720, 560); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  await writeFile(path.join(evidence, 'stale-small.png'), (await window.webContents.capturePage()).toPNG());
  const report = { status: 'PASS', timestamp: new Date().toISOString(), isolatedUiFixture: true, actualComponentAndPreload: true,
    realStorageWorker: true, plannerMetadataIsFixture: true, downloadedOrInstalledMods: false, rendererHasNoNode: true,
    reloadRestoredExactPlanWithoutPlanning: true, cancellationPersisted: true, cancelledRevision: 2, staleRevisionRejected: true,
    smallWindowNoOverflow: true, explicitConsentRequired: true, acceptedTaskRestoredAfterReload: true, unknownPreparationBlocksCommit: true,
    taskSubscriptionIsFallbackFixture: true, plannerCalls };
  await writeFile(path.join(evidence, 'ui.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  await finish(0);
}
app.on('window-all-closed', () => {});
void run().catch(async error => {
  console.error(error);
  if (window && !window.isDestroyed()) console.error(await window.webContents.executeJavaScript('document.body.innerText').catch(() => 'NO_RENDERER'));
  await finish(1);
});
