import { build } from 'esbuild';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const directory = 'D:/MC_start/OUCL/tmp/20261118-distribution-ui';
const evidence = path.resolve('docs/execution/20261118-v/ui-evidence');
await mkdir(evidence, { recursive: true });
await mkdir(path.join(directory, 'profile'), { recursive: true });
await build({
  entryPoints: ['tests/runtime/distribution-ui.tsx'], outfile: path.join(directory, 'renderer.js'),
  bundle: true, format: 'esm', jsx: 'automatic', platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
});
await writeFile(path.join(directory, 'index.html'), `<!doctype html><html lang="zh"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src 'none'">
<div id="root"></div><script type="module" src="renderer.js"></script></html>`);
await writeFile(path.join(directory, 'main.cjs'), String.raw`
const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const results = [];
const timeout = setTimeout(() => app.exit(2), 20000);
app.setPath('userData', path.join(__dirname, 'profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  await window.loadFile(path.join(__dirname, 'index.html'));
  const evaluate = source => window.webContents.executeJavaScript(source);
  const until = async (name, expression) => {
    for (let i = 0; i < 120; i++) {
      if (await evaluate(expression)) { results.push(name); return; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(name);
  };
  const button = label => 'Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === ' + JSON.stringify(label) + ' && !button.disabled)';
  const click = async label => {
    await until('visible button: ' + label, 'Boolean(' + button(label) + ')');
    await evaluate(button(label) + '.click()');
  };
  await click('检查安装差异');
  await until('public difference displayed', 'document.body.innerText.includes("mods/example.jar")');
  await click('确认安装变更');
  await click('重新查询确认结果');
  await until('accepted task displayed', 'document.body.innerText.includes("00000000-0000-4000-8000-000000000003")');
  const ids = (await evaluate('document.body.dataset.confirmationIds')).split(',');
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  results.push('ambiguous confirmation uses original request ID');
  await click('任务记录');
  assert.equal(await evaluate('document.body.dataset.cancellations'), '0');
  results.push('opening task center does not cancel accepted work');
  await writeFile(process.env.OUCL_DISTRIBUTION_UI_RESULT, JSON.stringify({ results }, null, 2));
  window.destroy();
  clearTimeout(timeout);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
`);
const output = await open(path.join(evidence, 'electron.log'), 'w');
const env = { ...process.env, OUCL_DISTRIBUTION_UI_RESULT: path.join(evidence, 'result.json') };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', output.fd, output.fd] });
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
await output.close();
await writeFile(path.join(evidence, 'status.json'), JSON.stringify({ exitCode: code }, null, 2));
process.exitCode = code ?? 1;
