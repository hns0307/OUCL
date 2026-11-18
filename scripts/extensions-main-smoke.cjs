const { app, BrowserWindow } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.env.OUCL_EXTENSION_SMOKE_ROOT;
const buildRoot = process.env.OUCL_BUILD_ROOT;
assert.ok(root && path.isAbsolute(root) && buildRoot && path.isAbsolute(buildRoot));
const profile = path.join(root, 'profile'); const evidence = path.join(root, 'evidence');
app.setPath('userData', profile); app.disableHardwareAcceleration();
const checks = []; let finished = false;
const timer = setTimeout(() => { console.error('EXTENSION_MAIN_TIMEOUT'); app.exit(2); }, 45000);
function check(name, condition) { assert.ok(condition, name); checks.push({ name, pass: true }); }
// Explicit synthetic catalog at the native network boundary. No socket or external site is used.
require('./electron-network-fixture.cjs')(async url => {
  assert.equal(String(url), 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  return new globalThis.Response(JSON.stringify({ versions: [{ id: '1.20.1', type: 'release', sha1: 'a'.repeat(40),
    url: `https://piston-meta.mojang.com/v1/packages/${'a'.repeat(40)}/1.20.1.json`, releaseTime: '2026-10-24T00:00:00Z' }] }));
});
async function run(window) {
  if (finished) return; finished = true;
  try {
    const prefs = window.webContents.getLastWebPreferences();
    check('production window retains security preferences', prefs.contextIsolation === true && prefs.sandbox === true && prefs.nodeIntegration === false);
    const reply = await window.webContents.executeJavaScript(`(async () => {
      const handshake = await window.oucl.handshake(); const tools = await window.oucl.onlineToolState(); const sources = await window.oucl.distributionSources();
      const open = await window.oucl.openOnlineTool(crypto.randomUUID(), 'missing-tool');
      const injectedUrl = await window.oucl.openOnlineTool(crypto.randomUUID(), 'https://unreviewed.example.com/');
      const id = crypto.randomUUID(); const preview = await window.oucl.previewDistribution(id, { rootId: id, instanceId: id, sourceId:'missing', packageId:'package', packageVersion:'one' });
      const execution = await Promise.all([
        window.oucl.prepareDistributionExecution(crypto.randomUUID(), { rootId: id, instanceId: id, sourceId:'missing', packageId:'package', packageVersion:'one' }),
        window.oucl.getDistributionExecutionPreparation(id),
        window.oucl.cancelDistributionExecutionPreparation(id),
        window.oucl.confirmDistributionExecution(crypto.randomUUID(), { proposalId: id, instanceRevision: 1, sequence: 1 }),
        window.oucl.recoverDistributionExecution(crypto.randomUUID(), id),
      ]);
      const close = await window.oucl.closeOnlineTool(crypto.randomUUID());
      return {handshake,tools,sources,open,injectedUrl,preview,execution,close,nodeAbsent:typeof require==='undefined'&&typeof process==='undefined'};
    })()`);
    check('real preload handshake advertises both initialized extensions', reply.handshake.ok && ['tools.isolated.v1', 'distribution.preview.v1'].every(capability => reply.handshake.data.capabilities.includes(capability)));
    check('renderer has no Node globals', reply.nodeAbsent);
    check('real tools IPC returns empty reviewed registry', reply.tools.ok && reply.tools.data.tools.length === 0 && reply.tools.data.snapshot.phase === 'closed');
    check('unknown tool is rejected without opening a view', !reply.open.ok && reply.open.error.code === 'TOOL_NOT_FOUND');
    check('preload rejects arbitrary URL tool identifiers', !reply.injectedUrl.ok && reply.injectedUrl.error.code === 'INVALID_ARGUMENT');
    check('real distribution IPC exposes empty pinned source registry', reply.sources.ok && reply.sources.data.sources.length === 0);
    check('unconfigured execution capability stays disabled in the product handshake', !reply.handshake.data.capabilities.includes('distribution.execute.v1'));
    check('all five unconfigured execution operations reject through real preload and IPC',
      reply.execution.length === 5 && reply.execution.every(result => !result.ok && result.error.code === 'SOURCE_UNAVAILABLE'));
    check('unconfigured distribution source cannot inspect or install', !reply.preview.ok && reply.preview.error.code === 'SOURCE_UNAVAILABLE');
    check('real close IPC reaches closed state', reply.close.ok && reply.close.data.snapshot.phase === 'closed');
    await window.webContents.executeJavaScript(`(() => { const button=[...document.querySelectorAll('.top-nav button')].find(item=>item.textContent==='工具箱'); if(!button) throw new Error('TOOLS_NAV_MISSING'); button.click(); })()`);
    await new Promise(resolve => setTimeout(resolve, 180));
    await window.webContents.executeJavaScript(`document.querySelectorAll('.tools-tabs button')[1].click()`);
    await new Promise(resolve => setTimeout(resolve, 180));
    check('production online tab shows empty configuration', await window.webContents.executeJavaScript(`document.querySelector('.online-tools-panel')?.textContent.includes('尚未配置在线工具站点')`));
    await window.webContents.executeJavaScript(`document.querySelectorAll('.tools-tabs button')[2].click()`);
    await new Promise(resolve => setTimeout(resolve, 180));
    check('production package tab shows empty source and key configuration', await window.webContents.executeJavaScript(`document.querySelector('.distribution-panel')?.textContent.includes('尚未配置社团包来源与验证公钥')`));
    await mkdir(evidence, { recursive: true });
    for (const [label, width, height] of [['wide', 1180, 820], ['narrow', 720, 520]]) {
      window.setContentSize(width, height); await new Promise(resolve => setTimeout(resolve, 120));
      check(label + ' production page has no horizontal overflow', await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'));
      await writeFile(path.join(evidence, label + '.png'), (await window.webContents.capturePage()).toPNG());
    }
    await window.webContents.executeJavaScript(`window.open('https://unreviewed.example.com/')`);
    check('production popup remains denied', BrowserWindow.getAllWindows().length === 1);
    const report = { status: 'PASS', productionMain: true, productionPreload: true, syntheticCatalog: true, externalNetwork: false, electron: process.versions.electron, checks };
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); clearTimeout(timer); window.destroy(); app.quit();
  } catch (error) {
    await mkdir(evidence, { recursive: true });
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ status: 'FAIL', checks, error: error.message }, null, 2));
    console.error(error); clearTimeout(timer); app.exit(1);
  }
}
app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; // Visibility-only harness override; production security and IPC remain intact.
  window.webContents.once('did-finish-load', () => { void run(window); });
});
void mkdir(profile, { recursive: true }).then(() => { require(path.join(buildRoot, 'main/index.cjs')); });
