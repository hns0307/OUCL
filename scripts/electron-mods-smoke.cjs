const { app } = require('electron');
const { mkdir, writeFile, realpath, access } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('MOD_UI_TIMEOUT'); app.once('will-quit', () => { app.exit(1); }); app.quit(); }, 180000);
let started = false;
const directory = path.resolve('docs/validation/MODS-UI-0.3.0');
async function run(window) {
  if (started) return; started = true;
  const evaluate = text => window.webContents.executeJavaScript(text);
  async function wait(expression, ms = 30000) {
    const deadline = Date.now() + ms;
    for (;;) { if (await evaluate(`Boolean(${expression})`)) return; if (Date.now() > deadline) throw new Error('MOD_UI_CONDITION_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const evidence = [];
  try {
    await mkdir(directory, { recursive: true });
    await wait(`document.querySelector('[data-status="connected"]') && document.querySelector('.sidebar-list [data-instance-id]')`);
    for (const [kind, id, version] of [['forge', '07ee75a2-fa9f-5969-86bd-01bcdb478dfb', '6.0.1'], ['neoforge', '44b298d7-9351-5f8e-b68f-3112437e1d23', '7.0.3']]) {
      await evaluate(`document.querySelector('.sidebar-list [data-instance-id="${id}"]').click()`);
      await wait(`document.querySelector('.mod-report[data-instance-id="${id}"]') && !document.querySelector('.mods-actions button').disabled`);
      await evaluate(`document.querySelector('.mods-actions button').click()`);
      await wait(`document.querySelector('.mod-report[data-instance-id="${id}"][data-report-mode="list"]') && document.querySelector('.mods-panel [data-task-state="completed"]')`);
      assert.ok(await evaluate(`document.querySelector('.mod-files').textContent.includes('ferritecore') && document.querySelector('.mod-files').textContent.includes('${version}')`));
      await evaluate(`document.querySelectorAll('.mods-actions button')[1].click()`);
      await wait(`document.querySelector('.mod-report[data-instance-id="${id}"][data-report-mode="check"][data-mod-state="satisfied"]') && document.querySelector('.mods-panel [data-task-state="completed"]') && !document.querySelector('.mods-actions button').disabled`, 60000);
      assert.ok(await evaluate(`document.querySelector('.mod-files').textContent.includes('uXXizFIs')`));
      assert.equal(await evaluate(`document.querySelector('.mods-panel .task-heading strong').textContent`), '检查完成');
      const reportTime = await evaluate(`document.querySelector('.mod-report').dataset.reportTime`);
      await evaluate(`document.querySelector('.mods-panel').scrollIntoView({behavior:'instant',block:'start'})`); await new Promise(resolve => setTimeout(resolve, 250));
      await writeFile(path.join(directory, `${kind}-check.png`), (await window.webContents.capturePage()).toPNG());
      // A renderer reload loses its local state. Restore the exact persisted observation, without rerunning it.
      window.webContents.reload();
      await wait(`document.querySelector('[data-status="connected"]') && document.querySelector('.sidebar-list [data-instance-id="${id}"]')`);
      await evaluate(`document.querySelector('.sidebar-list [data-instance-id="${id}"]').click()`);
      await wait(`document.querySelector('.mod-report[data-instance-id="${id}"][data-report-mode="check"]') && !document.querySelector('.mods-actions button').disabled`);
      assert.equal(await evaluate(`document.querySelector('.mod-report').dataset.reportTime`), reportTime);
      await evaluate(`document.querySelector('.mods-panel').scrollIntoView({behavior:'instant',block:'start'})`); await new Promise(resolve => setTimeout(resolve, 250));
      await writeFile(path.join(directory, `${kind}-reconnect.png`), (await window.webContents.capturePage()).toPNG());
      window.setSize(720, 560); await new Promise(resolve => setTimeout(resolve, 150));
      await evaluate(`document.querySelector('.mods-panel').scrollIntoView({behavior:'instant',block:'start'})`); await new Promise(resolve => setTimeout(resolve, 250));
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      await writeFile(path.join(directory, `${kind}-small.png`), (await window.webContents.capturePage()).toPNG()); window.setSize(1180, 820);
      evidence.push({ loader: kind, actualMod: 'ferritecore', version, list: true, dualCheck: 'satisfied', sourceProject: 'uXXizFIs', persistedReportReconnected: true, reportTime, smallWindowNoOverflow: true });
    }
    const report = { timestamp: new Date().toISOString(), status: 'PASS', isolatedOfficialTestRoot: true, productEntry: true, evidence, installationWrites: false };
    await writeFile(path.join(directory, 'smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    clearTimeout(timeout); window.destroy(); app.quit();
  } catch (error) {
    clearTimeout(timeout); console.error(error);
    console.error(await evaluate(`(async()=>JSON.stringify({handshake:await window.oucl.handshake(),roots:await window.oucl.listRoots(),body:document.body.innerText.slice(-3000)}))()`).catch(() => 'NO_RENDERER_DIAGNOSTIC'));
    app.once('will-quit', () => { app.exit(1); }); window.destroy(); app.quit();
  }
}
(async () => {
  const workspace = process.env.OUCL_LOADER_TEST_WORKSPACE;
  assert.ok(workspace); const target = await realpath(workspace); const base = await realpath('.test-build');
  const relative = path.relative(base, target);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(target).startsWith('official-loader-'));
  await access(path.join(target, 'metadata/installation.json'));
  app.setPath('userData', target);
  app.on('browser-window-created', (_event, window) => { window.webContents.once('did-finish-load', () => { void run(window); }); });
  require('../dist/main/index.cjs');
})().catch(error => { clearTimeout(timeout); console.error(error); app.exit(1); });
