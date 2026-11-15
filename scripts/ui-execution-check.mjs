import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const directory = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/execution-ui');
const evidence = path.resolve('docs/execution/20261115/evidence');
await mkdir(directory, { recursive: true }); await mkdir(evidence, { recursive: true });
await mkdir(path.join(directory, 'profile'), { recursive: true });
await build({ entryPoints: ['scripts/ui-execution-fixture.tsx'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023',
  outfile: path.join(directory, 'renderer.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
await writeFile(path.join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="renderer.css"><title>OUCL isolated UI fixture</title><div id="root"></div><script type="module" src="renderer.js"></script></html>');

// The generated main is owned solely by this fixture; no production window, preload, network or player data.
await writeFile(path.join(directory, 'main.cjs'), String.raw`
const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const evidence = process.env.OUCL_UI_EVIDENCE;
const results = [];
let window;
app.disableHardwareAcceleration();
const timeout = setTimeout(() => app.exit(2), 45000);
app.setPath('userData', path.join(__dirname, 'profile'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(source) { return window.webContents.executeJavaScript(source); }
async function check(name, expression) {
  const detail = await evaluate(expression);
  results.push({ name, pass: detail === true, detail });
  if (detail !== true) throw new Error(name);
}
async function click(selector, text) {
  return evaluate('(() => { const item = [...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(value => value.textContent.trim() === ' + JSON.stringify(text) + '); if (!item) throw new Error("BUTTON_MISSING"); item.click(); return true; })()');
}
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1100, height: 1500, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  await window.loadFile(path.join(__dirname, 'index.html'));
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate('Boolean(document.querySelector(".toolbox-output"))')) break;
    await wait(100);
  }
  await check('real components rendered', 'Boolean(document.querySelector(".first-run-guide") && document.querySelector(".instance-overview") && document.querySelector(".toolbox-output"))');
  await evaluate('(() => { const text = document.querySelector(".toolbox-panel > textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(text,"中文👨‍👩‍👧‍👦"); text.dispatchEvent(new Event("input", {bubbles:true})); const colors = document.querySelectorAll(".toolbox-colors input"); for (const [index,color] of [[0,"#ff0000"],[1,"#0000ff"]]) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(colors[index],color); colors[index].dispatchEvent(new Event("input",{bubbles:true})); colors[index].dispatchEvent(new Event("change",{bubbles:true})); } })()');
  await wait(100);
  await check('text and color controls update escaped JSON', '(() => { const output=JSON.parse(document.querySelector(".toolbox-output").value); return output.extra.length === 3 && output.extra.map(item=>item.text).join("") === "中文👨‍👩‍👧‍👦" && output.extra[0].color === "#ff0000" && output.extra[2].color === "#0000ff"; })()');
  await click('.toolbox-panel button', '选择输出');
  await check('select output focuses and selects full JSON', '(() => { const output=document.querySelector(".toolbox-output"); return document.activeElement === output && output.selectionStart === 0 && output.selectionEnd === output.value.length; })()');
  await click('.first-run-guide button', '暂时跳过');
  await wait(50);
  await check('first-run skip closes optional guide', 'Boolean(!document.querySelector(".first-run-guide") && document.querySelector(".first-run-reopen"))');
  await click('.first-run-reopen', '打开启动准备');
  await wait(50);
  await check('first-run guide reopens', 'Boolean(document.querySelector(".first-run-guide"))');
  await click('.first-run-guide button', '重新检查');
  await wait(50);
  await check('retry invokes fixture callback', 'document.querySelector("#fixture-actions").textContent.includes("retry")');
  await check('instance identity and session remain public facts', '(() => { const value=document.querySelector(".instance-overview").textContent; return value.includes("00000000-0000-4000-8000-000000000002") && value.includes("游戏运行中") && value.includes("Java"); })()');
  await click('.instance-overview button', '打开任务中心');
  await check('task entry invokes existing callback', 'document.querySelector("#fixture-actions").textContent.includes("tasks")');
  await window.webContents.executeJavaScript('document.activeElement?.blur()');
  for (const [name,width,height] of [['wide',1100,1500],['narrow',480,1900]]) {
    window.setContentSize(width,height); await wait(150);
    await check(name + ' viewport has no horizontal overflow', 'document.documentElement.scrollWidth <= window.innerWidth');
    const image = await window.webContents.capturePage();
    await writeFile(path.join(evidence,'ui-' + name + '.png'),image.toPNG());
  }
  await writeFile(path.join(evidence,'ui-check.json'), JSON.stringify({ status: 'PASS', fixture: true, productionMain: false, network: false, checks: results },null,2));
  clearTimeout(timeout); window.destroy(); app.exit(0);
}).catch(async error => {
  await writeFile(path.join(evidence,'ui-check.json'), JSON.stringify({ status: 'FAIL', fixture: true, productionMain: false, checks: results, error: error.message },null,2));
  clearTimeout(timeout); if(window) window.destroy(); app.exit(1);
});
`);
const environment = { ...process.env, OUCL_UI_EVIDENCE: evidence }; delete environment.ELECTRON_RUN_AS_NODE;
const report = path.join(evidence, 'ui-check.json');
await writeFile(report, JSON.stringify({ status: 'NOT_RUN', fixture: true, productionMain: false, checks: [], reason: 'Electron has not reached fixture completion.' }, null, 2));
const child = spawn(electron, [path.join(directory, 'main.cjs')], { env: environment, windowsHide: true, stdio: 'inherit' });
child.on('error', async error => {
  console.error(error.code ?? 'ELECTRON_START_FAILED'); process.exitCode = 1;
  await writeFile(report, JSON.stringify({ status: 'NOT_RUN', fixture: true, productionMain: false, checks: [], reason: error.code ?? 'ELECTRON_START_FAILED' }, null, 2));
});
child.on('exit', async code => {
  console.log('UI_FIXTURE_EXIT', code); process.exitCode = code ?? 1;
  const result = JSON.parse(await readFile(report, 'utf8'));
  if (result.status === 'NOT_RUN') await writeFile(report, JSON.stringify({ ...result, exitCode: code, reason: 'Electron exited before fixture result; no DOM or screenshots verified.' }, null, 2));
});
