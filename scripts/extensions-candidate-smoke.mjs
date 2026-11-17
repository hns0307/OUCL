import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, writeFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = path.resolve(process.env.OUCL_CANDIDATE_SMOKE_ROOT ?? 'tmp/candidate-execution-20261116');
const evidence = path.resolve(process.env.OUCL_VALIDATION_DIR ?? 'docs/execution/20261116/package-evidence/candidate-smoke');
const candidate = path.resolve(process.env.OUCL_EXE_TEST_PATH ?? 'release/OUCL-0.3.0-execution-20261116.exe');
const packaging = path.resolve(process.env.OUCL_PACKAGE_EVIDENCE_DIR ?? 'docs/execution/20261116/package-evidence');
const audit = JSON.parse(await readFile(path.join(packaging, 'package-audit.json'), 'utf8'));
const resources = JSON.parse(await readFile(path.join(packaging, 'embedded-resources.json'), 'utf8'));
const dependencies = JSON.parse(await readFile(path.join(packaging, 'dependencies.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256(await readFile(candidate)), audit.sha256, 'AUDITED_CANDIDATE_REQUIRED');
await mkdir(evidence, { recursive: true });
await mkdir(root, { recursive: false }); // Refuse an existing runtime/profile instead of touching previous data.
assert.equal((await realpath(root)).toLowerCase(), root.toLowerCase(), 'ORDINARY_TEST_ROOT_REQUIRED');
const profile = path.join(root, 'profile'); const temporary = path.join(root, 'tmp');
await mkdir(profile); await mkdir(temporary);
const executable = path.join(root, 'OUCL-candidate.exe'); await copyFile(candidate, executable, constants.COPYFILE_EXCL);
const runtimeRoot = path.join(root, 'OUCL.runtime');
const runtime = path.join(runtimeRoot, `electron-${audit.runtimeChecksum}`);
const application = path.join(runtimeRoot, `app-${audit.appHash}`);
const installed = path.join(dependencies.packages.find(item => item.name === 'electron').root, 'dist');
const runtimeFiles = resources.runtimeManifest.trimEnd().split('\n').map(line => {
  assert.match(line, /^[a-f0-9]{64} {2}[^\r\n]+$/);
  const relative = line.slice(66);
  assert.equal(path.posix.normalize(relative), relative); assert.ok(!relative.startsWith('/') && !relative.includes(':') && !relative.includes('\\') && !relative.startsWith('..'));
  return { path: relative, sha256: line.slice(0, 64) };
});
for (const file of runtimeFiles) {
  const source = path.join(installed, file.path); assert.equal((await lstat(source)).isFile(), true);
  assert.equal((await lstat(source)).isSymbolicLink(), false);
  assert.equal(sha256(await readFile(source)), file.sha256, `INSTALLED_RUNTIME:${file.path}`);
  const destination = path.join(runtime, file.path); await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  assert.equal(sha256(await readFile(destination)), file.sha256, `COPIED_RUNTIME:${file.path}`);
}
await writeFile(path.join(evidence, 'runtime-preseed.json'), JSON.stringify({ source: installed, destination: runtime, ordinaryCopies: true, files: runtimeFiles }, null, 2));
const server = createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port; await new Promise(resolve => { server.close(resolve); });
const environment = { ...process.env, TMP: temporary, TEMP: temporary };
for (const key of Object.keys(environment)) if (key.startsWith('OUCL_') || key.startsWith('CHROME_') || ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_OVERRIDE_DIST_PATH'].includes(key)) delete environment[key];
const args = [`--inspect-brk=127.0.0.1:${port}`, `--user-data-dir=${profile}`, '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run'];
const outer = spawn(executable, args, { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let launcherLog = ''; outer.stdout.on('data', chunk => { launcherLog += chunk.toString(); }); outer.stderr.on('data', chunk => { launcherLog += chunk.toString(); });
let observedOuterExit;
const outerExit = new Promise((resolve, reject) => { outer.once('error', reject); outer.once('exit', (code, signal) => { observedOuterExit = { code, signal }; resolve(observedOuterExit); }); });
let socket; let nextId = 0; let pausedFrame; let inspectorPid; const pending = new Map(); const events = [];
const workerProtocol = []; let workerProtocolId = 0;
function recordWorkerProtocol(detail) {
  workerProtocol.push({ at: Date.now(), ...detail });
  writeFileSync(path.join(evidence, 'worker-inspector.json'), JSON.stringify(workerProtocol, null, 2));
}
const wait = milliseconds => new Promise(resolve => { setTimeout(resolve, milliseconds); });
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`INSPECTOR_TIMEOUT:${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
}
function installFixture(options, load) {
  // This function runs only in the candidate's paused main frame; production files remain unchanged.
  const { app, BrowserWindow, session } = load('electron');
  const fs = load('node:fs'); const path = load('node:path');
  const checks = []; let report = { status: 'RUNNING', checks }; let currentWindow; const preloadScripts = []; let ipcReply;
  const output = path.join(options.evidence, 'application-result.json');
  const save = () => { fs.writeFileSync(output, JSON.stringify(report, null, 2)); };
  const workerEvents = [];
  const workerLog = (stage, detail = {}) => {
    workerEvents.push({ at: Date.now(), stage, ...detail });
    fs.writeFileSync(path.join(options.evidence, 'worker-events.json'), JSON.stringify(workerEvents, null, 2));
    process.stderr.write(`CANDIDATE_WORKER ${stage} ${JSON.stringify(detail)}\n`);
  };
  const threads = load('node:worker_threads'); const OriginalWorker = threads.Worker;
  threads.Worker = new Proxy(OriginalWorker, { construct(Target, args) {
    const [entry, settings] = args;
    workerLog('construct', { entry: String(entry), kind: settings?.workerData?.kind, directory: settings?.workerData?.directory,
      explicitExecArgv: settings?.execArgv, mainExecArgv: process.execArgv, inspectBrkSwitch: app.commandLine.getSwitchValue('inspect-brk') });
    let worker;
    try { worker = Reflect.construct(Target, args); } catch (error) { workerLog('constructor-error', { code: error.code, message: error.message, stack: error.stack }); throw error; }
    worker.on('online', () => { workerLog('online', { threadId: worker.threadId }); });
    worker.on('error', error => { workerLog('error', { code: error.code, message: error.message, stack: error.stack }); });
    worker.on('exit', code => { workerLog('exit', { code }); });
    worker.on('message', message => { workerLog('message', { kind: message?.kind, code: message?.code, features: message?.features, ok: message?.ok }); });
    const postMessage = worker.postMessage;
    worker.postMessage = function(...values) { workerLog('post-message', { kind: values[0]?.kind, command: values[0]?.command?.kind }); return postMessage.apply(this, values); };
    return worker;
  } });
  load('node:module').syncBuiltinESMExports();
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push({ name, pass: true }); };
  globalThis.__ouclCandidateQuit = () => { currentWindow?.close(); app.quit(); };
  // Do not propagate this test's main-process break-on-start flag to production storage workers.
  const inspectorArguments = process.execArgv.filter(argument => /^--inspect/.test(argument));
  process.execArgv = process.execArgv.filter(argument => !/^--inspect/.test(argument));
  app.disableHardwareAcceleration();
  load(options.networkFixture)(async url => {
    if (String(url) !== 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json') throw new Error('UNEXPECTED_NETWORK_REQUEST');
    return new globalThis.Response(JSON.stringify({ versions: [] }));
  });
  void app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => { callback({ cancel: true }); });
  });
  app.once('quit', (_event, exitCode) => { report.applicationQuitCode = exitCode; report.applicationQuitObserved = true; save(); });
  process.once('exit', code => { report.nodeExitCode = code; save(); });
  app.on('browser-window-created', (_event, window) => {
    currentWindow = window; window.show = () => {}; // Visibility-only hook, installed before ready-to-show.
    window.webContents.once('did-finish-load', () => {
      void (async () => {
        try {
          check('actual app path is candidate bootstrap extraction', app.getAppPath().toLowerCase() === options.application.toLowerCase());
          check('isolated explicit profile used', app.getPath('userData').toLowerCase() === options.profile.toLowerCase());
          const prefs = window.webContents.getLastWebPreferences();
          check('packaged window security unchanged', prefs.contextIsolation && prefs.sandbox && !prefs.nodeIntegration && prefs.webSecurity);
          const rendererFile = load('node:url').fileURLToPath(window.webContents.getURL());
          check('renderer loaded from candidate extraction', rendererFile.toLowerCase() === path.join(options.application, 'dist/renderer/index.html').toLowerCase());
          // Electron45 omits preload from getLastWebPreferences. Observe the actual loaded script instead.
          window.webContents.debugger.attach('1.3');
          window.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Debugger.scriptParsed') preloadScripts.push(params.url); });
          await window.webContents.debugger.sendCommand('Debugger.enable');
          const preloadPath = path.join(options.application, 'dist/preload/index.cjs');
          check('preload script parsed from candidate extraction', preloadScripts.some(url => url &&
            (url.startsWith('file:') ? load('node:url').fileURLToPath(url) : path.resolve(url)).toLowerCase() === preloadPath.toLowerCase()));
          window.webContents.debugger.detach();
          const reply = await window.webContents.executeJavaScript(`(async () => {
            for(let i=0;i<100&&!document.querySelector('[data-status="connected"]');i++) await new Promise(r=>setTimeout(r,50));
            const handshake=await window.oucl.handshake(); const tools=await window.oucl.onlineToolState(); const sources=await window.oucl.distributionSources();
            const open=await window.oucl.openOnlineTool(crypto.randomUUID(),'missing-tool');
            const arbitrary=await window.oucl.openOnlineTool(crypto.randomUUID(),'https://unreviewed.example.com/');
            const id=crypto.randomUUID(); const preview=await window.oucl.previewDistribution(id,{rootId:id,instanceId:id,sourceId:'missing',packageId:'package',packageVersion:'one'});
            const closed=await window.oucl.closeOnlineTool(crypto.randomUUID());
            const executionMethods=['prepareDistributionExecution','getDistributionExecutionPreparation','cancelDistributionExecutionPreparation','confirmDistributionExecution','recoverDistributionExecution'];
            const executionBridge=executionMethods.every(name=>typeof window.oucl[name]==='function');
            if(!executionBridge) return {handshake,tools,sources,open,arbitrary,preview,closed,executionBridge,noNode:typeof require==='undefined'&&typeof process==='undefined'};
            const rootId=crypto.randomUUID(),instanceId=crypto.randomUUID(),prepareId=crypto.randomUUID(),proposalId=crypto.randomUUID(),taskId=crypto.randomUUID();
            const execution={
              prepare:await window.oucl.prepareDistributionExecution(prepareId,{rootId,instanceId,sourceId:'missing',packageId:'package',packageVersion:'one'}),
              status:await window.oucl.getDistributionExecutionPreparation(prepareId),
              cancel:await window.oucl.cancelDistributionExecutionPreparation(prepareId),
              confirm:await window.oucl.confirmDistributionExecution(crypto.randomUUID(),{proposalId,instanceRevision:1,sequence:1}),
              recover:await window.oucl.recoverDistributionExecution(crypto.randomUUID(),taskId)
            };
            const invalidExecution=[
              await window.oucl.prepareDistributionExecution(crypto.randomUUID(),{rootId,instanceId,sourceId:'missing',packageId:'package',packageVersion:'one',path:'forbidden'}),
              await window.oucl.getDistributionExecutionPreparation('invalid'),
              await window.oucl.cancelDistributionExecutionPreparation('invalid'),
              await window.oucl.confirmDistributionExecution(crypto.randomUUID(),{proposalId,instanceRevision:1,sequence:1,path:'forbidden'}),
              await window.oucl.recoverDistributionExecution(crypto.randomUUID(),'invalid')
            ];
            return {handshake,tools,sources,open,arbitrary,preview,closed,executionBridge,execution,invalidExecution,noNode:typeof require==='undefined'&&typeof process==='undefined'};
          })()`);
          ipcReply = reply;
          check('packaged handshake advertises both initialized extensions', reply.handshake.ok && ['tools.isolated.v1', 'distribution.preview.v1'].every(item => reply.handshake.data.capabilities.includes(item)));
          check('packaged renderer has no Node globals', reply.noNode);
          check('packaged tools registry is empty and closed', reply.tools.ok && !reply.tools.data.tools.length && reply.tools.data.snapshot.phase === 'closed');
          check('unknown tool refused', !reply.open.ok && reply.open.error.code === 'TOOL_NOT_FOUND');
          check('arbitrary URL refused', !reply.arbitrary.ok && reply.arbitrary.error.code === 'INVALID_ARGUMENT');
          check('packaged pinned sources registry is empty', reply.sources.ok && !reply.sources.data.sources.length);
          check('empty source cannot scan or install', !reply.preview.ok && reply.preview.error.code === 'SOURCE_UNAVAILABLE');
          check('close IPC confirms closed', reply.closed.ok && reply.closed.data.snapshot.phase === 'closed');
          check('packaged preload exposes all five execution bridge methods', reply.executionBridge);
          check('packaged handshake does not advertise distribution execution', reply.handshake.ok && !reply.handshake.data.capabilities.includes('distribution.execute.v1'));
          for (const name of ['prepare', 'status', 'cancel', 'confirm', 'recover']) {
            check(`unconfigured execution ${name} fails closed`, reply.execution[name]?.ok === false && reply.execution[name].error.code === 'SOURCE_UNAVAILABLE');
          }
          check('all five execution bridges reject invalid payloads', reply.invalidExecution.length === 5 && reply.invalidExecution.every(result => result.ok === false && result.error.code === 'INVALID_ARGUMENT'));
          await window.webContents.executeJavaScript(`(() => { const button=[...document.querySelectorAll('.top-nav button')].find(item=>item.textContent==='工具箱'); if(!button) throw Error('TOOLS_NAV_MISSING'); button.click(); })()`);
          await new Promise(resolve => setTimeout(resolve, 120));
          await window.webContents.executeJavaScript(`document.querySelectorAll('.tools-tabs button')[1].click()`);
          await new Promise(resolve => setTimeout(resolve, 120));
          check('packaged online tab displays unconfigured site', await window.webContents.executeJavaScript(`document.querySelector('.online-tools-panel')?.textContent.includes('尚未配置在线工具站点')`));
          await window.webContents.executeJavaScript(`document.querySelectorAll('.tools-tabs button')[2].click()`);
          await new Promise(resolve => setTimeout(resolve, 120));
          check('packaged package tab displays unconfigured sources and keys', await window.webContents.executeJavaScript(`document.querySelector('.distribution-panel')?.textContent.includes('尚未配置社团包来源与验证公钥')`));
          for (const [name, width, height] of [['wide',1180,820],['narrow',720,520]]) {
            window.setContentSize(width,height); await new Promise(resolve => setTimeout(resolve,100));
            check(name+' packaged layout has no horizontal overflow', await window.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'));
            fs.writeFileSync(path.join(options.evidence,name+'.png'),(await window.webContents.capturePage()).toPNG());
          }
          check('no additional product windows', BrowserWindow.getAllWindows().length===1);
          report={status:'PASS',checks,packagedMain:true,packagedPreload:true,preloadScripts,inspectorArguments,syntheticCatalog:true,externalNetwork:false,visibilityHook:true,application:app.getAppPath(),profile:app.getPath('userData'),pid:process.pid};save();
          window.close();
        } catch(error) { report={status:'FAIL',checks,preloadScripts,inspectorArguments,ipcReply,error:error.message};save();window.close();app.quit(); }
      })();
    });
  });
  return { pid:process.pid, hooked:true };
}
try {
  let target;
  for (let attempt = 0; attempt < 160; attempt++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0]; if (target) break; } catch { /* Await only this test's loopback inspector. */ }
    await wait(100);
  }
  assert.ok(target, 'CANDIDATE_INSPECTOR_NOT_STARTED');
  // Electron 45's initial inspector target identifies the app directory with path separators replaced by underscores.
  assert.equal(target.title.toLowerCase(), application.replaceAll('\\','_').replaceAll('/','_').toLowerCase(), 'INSPECTOR_TARGET_MUST_BE_CANDIDATE_APPLICATION');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once:true }); socket.addEventListener('error', reject, { once:true }); });
  socket.addEventListener('message', event => {
    const value=JSON.parse(String(event.data)); if(value.method) events.push(value);
    if (value.method === 'NodeWorker.attachedToWorker') {
      recordWorkerProtocol({ event: value.method, ...value.params });
      for (const method of ['Runtime.enable', 'Debugger.enable', 'Runtime.runIfWaitingForDebugger']) {
        const message = JSON.stringify({ id: ++workerProtocolId, method });
        recordWorkerProtocol({ event: 'send', sessionId: value.params.sessionId, method });
        void command('NodeWorker.sendMessageToWorker', { sessionId: value.params.sessionId, message }).catch(error => { recordWorkerProtocol({ event: 'send-error', error: error.message }); });
      }
    } else if (value.method === 'NodeWorker.receivedMessageFromWorker') {
      const message = JSON.parse(value.params.message);
      if (message.method === 'Debugger.paused') {
        recordWorkerProtocol({ event: message.method, sessionId: value.params.sessionId, reason: message.params.reason, frames: message.params.callFrames.slice(0, 2).map(frame => ({ url: frame.url, functionName: frame.functionName })) });
        void command('NodeWorker.sendMessageToWorker', { sessionId: value.params.sessionId, message: JSON.stringify({ id: ++workerProtocolId, method: 'Debugger.resume' }) }).catch(error => { recordWorkerProtocol({ event: 'resume-error', error: error.message }); });
      } else if (message.id) recordWorkerProtocol({ event: 'reply', sessionId: value.params.sessionId, id: message.id, error: message.error });
    } else if (value.method === 'NodeWorker.detachedFromWorker') recordWorkerProtocol({ event: value.method, ...value.params });
    const request=pending.get(value.id);if(!request)return;clearTimeout(request.timer);pending.delete(value.id);
    if(value.error)request.reject(new Error(value.error.message));else request.resolve(value.result);
  });
  await command('Debugger.enable');await command('Runtime.runIfWaitingForDebugger');
  for(let i=0;i<100&&!events.some(item=>item.method==='Debugger.paused');i++)await wait(50);
  pausedFrame=events.find(item=>item.method==='Debugger.paused')?.params.callFrames[0]?.callFrameId;
  assert.ok(pausedFrame,'INITIAL_BREAK_REQUIRED');
  await command('NodeWorker.enable', { waitForDebuggerOnStart: false });
  // --inspect-brk first pauses Electron's default_app ESM entry, before it loads the product CJS main.
  const installed=await command('Debugger.evaluateOnCallFrame',{callFrameId:pausedFrame,expression:`(${installFixture.toString()})(${JSON.stringify({evidence,application,profile,networkFixture:path.join(repository,'scripts/electron-network-fixture.cjs')})},process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json'))`,returnByValue:true});
  assert.equal(installed.exceptionDetails,undefined);assert.equal(installed.result.value.hooked,true);inspectorPid=installed.result.value.pid;
  const watcher=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; $p=[Diagnostics.Process]::GetProcessById(${inspectorPid}); $null=$p.Handle; Write-Output 'WATCH_READY'; if(-not $p.WaitForExit(30000)){throw 'PROCESS_EXIT_TIMEOUT'}; Write-Output ('PROCESS_EXIT='+$p.ExitCode)`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let watcherOutput='';watcher.stdout.on('data',chunk=>{watcherOutput+=chunk.toString();});watcher.stderr.on('data',chunk=>{watcherOutput+=chunk.toString();});
  const watchedExit=new Promise((resolve,reject)=>{watcher.once('error',reject);watcher.once('exit',code=>{resolve(code);});});
  for(let i=0;i<100&&!watcherOutput.includes('WATCH_READY');i++)await wait(20);assert.ok(watcherOutput.includes('WATCH_READY'),'OS_EXIT_WATCH_REQUIRED');
  await command('Debugger.resume');pausedFrame=undefined;
  let applicationResult;
  for(let i=0;i<250;i++){
    try{applicationResult=JSON.parse(await readFile(path.join(evidence,'application-result.json'),'utf8'));if(applicationResult.applicationQuitObserved)break;}catch{/* Await test result only. */}
    await wait(100);
  }
  // Node's inspector connection keeps a completed process alive until the debugger disconnects.
  socket.close();socket=undefined;
  assert.equal(await watchedExit,0);await writeFile(path.join(evidence,'process-exit.log'),watcherOutput);assert.ok(watcherOutput.includes('PROCESS_EXIT=0'),'NUMERIC_ELECTRON_EXIT_ZERO');
  const launcher=await outerExit;assert.equal(launcher.code,0);applicationResult=JSON.parse(await readFile(path.join(evidence,'application-result.json'),'utf8'));
  assert.equal(applicationResult.status,'PASS');assert.equal(applicationResult.applicationQuitCode,0);
  for(const entry of audit.entries)assert.equal(sha256(await readFile(path.join(application,entry.path))),entry.sha256,`BOOTSTRAP_EXTRACTED:${entry.path}`);
  for(const file of runtimeFiles)assert.equal(sha256(await readFile(path.join(runtime,file.path))),file.sha256,`RUNTIME_POST:${file.path}`);
  const namespaces=await readdir(runtimeRoot);assert.deepEqual(namespaces.filter(name=>name.startsWith('electron-')),[path.basename(runtime)]);assert.ok(!namespaces.some(name=>name.startsWith('.download-')));
  assert.equal(await lstat(path.join(profile,'metadata/owner.lock')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}),false,'METADATA_OWNER_RELEASED');
  const report={status:'PASS',outerExeExecuted:true,outerExit:launcher.code,electronExit:0,candidateSha256:audit.sha256,appHash:audit.appHash,executable,profile,application,runtimeRoot,inspectorPid,applicationEntriesVerified:audit.entries.length,runtimeFilesVerified:runtimeFiles.length,externalNetwork:false,syntheticCatalog:true,visibilityHook:true,checks:applicationResult.checks};
  await writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:'PASS',outerExit:0,electronExit:0,checks:report.checks.length}));
}catch(error){
  if(socket){try{if(pausedFrame){const stopped=await command('Debugger.evaluateOnCallFrame',{callFrameId:pausedFrame,expression:'process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").app.whenReady().then(()=>process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").app.quit())'});assert.equal(stopped.exceptionDetails,undefined);await command('Debugger.resume');}else await command('Runtime.evaluate',{expression:'globalThis.__ouclCandidateQuit?.()'});}catch{/* Retain the exact failure; never terminate unrelated processes. */}}
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({status:'FAIL',outerExeExecuted:true,observedOuterExit,error:error.message,inspectorPid,root},null,2));throw error;
}finally{
  socket?.close();for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('SMOKE_CLOSED'));}pending.clear();
  await writeFile(path.join(evidence,'launcher.log'),launcherLog);
}
