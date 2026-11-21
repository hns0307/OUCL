import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const directory = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp/extensions-ui');
const evidence = path.resolve('docs/execution/20261115/extension-ui-evidence');
await mkdir(path.join(directory, 'profile'), { recursive: true }); await mkdir(evidence, { recursive: true });
await build({ entryPoints: ['scripts/extensions-ui-fixture.tsx'], bundle: true, platform: 'browser', format: 'esm', target: 'es2023', jsx: 'automatic',
  outfile: path.join(directory, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' } });
await writeFile(path.join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="renderer.css"><title>OUCL extension UI fixture</title><div id="root"></div><script type="module" src="renderer.js"></script></html>');
await writeFile(path.join(directory, 'main.cjs'), String.raw`
const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const evidence = process.env.OUCL_EXTENSION_EVIDENCE;
const checks = []; let window;
app.disableHardwareAcceleration(); app.setPath('userData', path.join(__dirname, 'profile'));
const timeout = setTimeout(() => app.exit(2), 45000);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = source => window.webContents.executeJavaScript(source);
async function check(name, expression) { const detail = await evaluate(expression); checks.push({name,pass:detail===true,detail}); if(detail!==true) throw new Error(name); }
async function click(selector, text) { await evaluate('(() => { const item=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(node=>'+(text===undefined?'true':'node.textContent.trim()==='+JSON.stringify(text))+'); if(!item)throw new Error("BUTTON_MISSING");item.click();})()'); await wait(90); }
async function fill(index,text) { await evaluate('(() => {const item=document.querySelectorAll(".distribution-panel input")['+index+'];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(item,'+JSON.stringify(text)+');item.dispatchEvent(new Event("input",{bubbles:true}));})()');await wait(60); }
const panelText = 'document.querySelector(".distribution-panel").textContent';
const state = 'JSON.parse(document.querySelector("#fixture-state").textContent)';
app.whenReady().then(async()=>{
 window = new BrowserWindow({show:false,width:1100,height:1100,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 await window.loadFile(path.join(__dirname,'index.html'));await wait(250);
 await check('real ToolsWorkspace initial local tool rendered','Boolean(document.querySelector(".tools-tabs")&&document.querySelector(".toolbox-output"))');
 await click('.tools-tabs button','在线工具');
 await check('empty online registry is explicit','document.querySelector(".online-tools-panel").textContent.includes("尚未配置")');
 await click('.tools-tabs button','社团包预览');
 await check('empty distribution registry has no form',panelText+'.includes("尚未配置")&&!document.querySelector(".distribution-panel form")');
 await click('#fixture-configure');await click('.tools-tabs button','在线工具');
 await click('.online-tools-panel button','打开工具 · 合成在线工具');
 await check('configured online fixture reports ready','document.querySelector(".online-tools-panel").textContent.includes("已打开")');
 await click('.online-tools-panel button','重试加载');
 await check('online retry is pending',state+'.retryPending===true');
 await click('.online-tools-panel button','关闭在线工具');
 await click('#fixture-settle-retry');
 await check('late online retry cannot reopen closed UI','document.querySelector(".online-tools-panel").textContent.includes("已关闭")&&!document.querySelector(".online-tools-attached")');
 const closeBefore=await evaluate(state+'.closeCount');
 await click('.tools-tabs button','社团包预览');
 await check('leaving online tab invokes close',state+'.closeCount>'+closeBefore);
 await check('empty package inputs disable preview','document.querySelector(".distribution-panel form button").disabled===true');
 await fill(0,'../bad');await fill(1,'1');
 await check('invalid package identity stays disabled','document.querySelector(".distribution-panel form button").disabled===true');
 await fill(0,'cancel-pack');await click('.distribution-panel form button');
 await check('pending preview disables editing and offers cancellation','document.querySelector(".distribution-panel fieldset").disabled&&[...document.querySelectorAll(".distribution-panel button")].some(node=>node.textContent.includes("取消"))');
 await click('.distribution-panel button','取消预览');
 await check('cancel settles and releases input',state+'.cancelCount===1&&!document.querySelector(".distribution-panel fieldset").disabled');
 await fill(0,'cancel-race-a');await click('.distribution-panel form button');await click('.distribution-panel button','取消预览');
 await click('#fixture-settle-a');
 await fill(0,'cancel-race-b');await click('.distribution-panel form button');await click('#fixture-reject-cancel');
 await check('old cancel rejection cannot overwrite newer request','!document.querySelector(".distribution-panel [role=alert]")&&document.querySelector(".distribution-panel fieldset").disabled');
 await click('#fixture-settle-a');
 await check('newer preview survives old cancellation response',panelText+'.includes("cancel-race-b")');
 await fill(0,'old-pack');await click('.distribution-panel form button');
 await click('#fixture-switch');await click('#fixture-settle-a');
 await check('switch instance unmount cancels old request',state+'.cancelCount===3');
 await check('old instance preview cannot populate new panel','!'+panelText+'.includes("old-pack")&&document.querySelector(".distribution-panel input").value===""');
 await fill(0,'new-pack');await fill(1,'2');await click('.distribution-panel form button');await click('#fixture-settle-b');
 await check('current preview displays safe ownership and conflict facts',panelText+'.includes("new-pack")&&'+panelText+'.includes("player.json")&&'+panelText+'.includes("本地发现")');
 await check('preview has no execute or install action','![...document.querySelectorAll(".distribution-panel button")].some(node=>/安装|执行|确认更新/.test(node.textContent))');
 for(const [name,width,height] of [['wide',1100,1100],['narrow',480,1450]]){window.setContentSize(width,height);await wait(180);await check(name+' layout no horizontal overflow','document.documentElement.scrollWidth<=window.innerWidth');await writeFile(path.join(evidence,'extensions-'+name+'.png'),(await window.webContents.capturePage()).toPNG());}
 await writeFile(path.join(evidence,'result.json'),JSON.stringify({status:'PASS',fixture:true,productionIPC:false,network:false,electron:process.versions.electron,checks},null,2));
 clearTimeout(timeout);window.destroy();app.exit(0);
}).catch(async error=>{await writeFile(path.join(evidence,'result.json'),JSON.stringify({status:'FAIL',fixture:true,productionIPC:false,checks,error:error.message},null,2));clearTimeout(timeout);if(window)window.destroy();app.exit(1);});
`);
const report = path.join(evidence, 'result.json');
await writeFile(report, JSON.stringify({ status: 'NOT_RUN', fixture: true, productionIPC: false, checks: [] }, null, 2));
const environment = { ...process.env, OUCL_EXTENSION_EVIDENCE: evidence }; delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(directory, 'main.cjs')], { env: environment, windowsHide: true, stdio: 'inherit' });
child.on('error', async error => { process.exitCode = 1; await writeFile(report, JSON.stringify({ status: 'NOT_RUN', reason: error.code ?? 'START_FAILED', fixture: true, checks: [] }, null, 2)); });
child.on('exit', async code => { process.exitCode = code ?? 1; const result = JSON.parse(await readFile(report, 'utf8')); console.log('EXTENSIONS_UI_EXIT', code, result.status, result.checks.length); });
