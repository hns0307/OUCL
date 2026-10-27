const { app } = require('electron');
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
app.disableHardwareAcceleration();
const evidence = path.resolve('docs/validation/DOWNLOADS-mod');
const profile = process.env.OUCL_DOWNLOAD_TEST_PROFILE;
assert.ok(profile && path.basename(profile).startsWith('download-ui-'));
app.setPath('userData', profile);
const timeout = setTimeout(() => app.exit(1), 45000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  try {
    const prefs = window.webContents.getLastWebPreferences();
    assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true); assert.equal(prefs.nodeIntegration, false);
    const result = await window.webContents.executeJavaScript(`(async()=>{
      const wait = ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<100&&!document.querySelector('[data-status="connected"]');i++) await wait(50);
      const bridge=window.oucl; const handshake=await bridge.handshake();
      document.querySelectorAll('.top-nav button')[3].click();
      for(let i=0;i<100&&document.querySelector('.download-settings button')?.disabled;i++) await wait(30);
      const before=await bridge.getDownloadSettings();
      if (${process.env.OUCL_DOWNLOAD_TEST_REOPEN === '1'}) {
        return {handshake,before,actual:before,noNode:typeof process==='undefined'&&typeof require==='undefined',methods:Object.keys(bridge)};
      }
      const select=document.querySelector('.download-settings select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'bmclapi');select.dispatchEvent(new Event('change',{bubbles:true}));
      for(const [index,value] of [6,3].entries()) {const input=document.querySelectorAll('.download-settings input')[index];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));await wait(40);}
      await wait(50); document.querySelector('.download-settings button').click();
      let actual;
      for(let i=0;i<100;i++) {actual=await bridge.getDownloadSettings();if(actual.ok&&actual.data.source==='bmclapi'&&actual.data.fileConcurrency===6&&actual.data.connectionsPerFile===3)break;await wait(30);}
      const legacy=await bridge.getSettings();
      const invalid=await bridge.updateDownloadSettings(crypto.randomUUID(),{expectedRevision:actual.data.revision,preferences:{formatVersion:1,source:'https://evil.invalid',fileConcurrency:4,connectionsPerFile:4}});
      const stale=await bridge.updateDownloadSettings(crypto.randomUUID(),{expectedRevision:before.data.revision,preferences:{formatVersion:1,source:'official',fileConcurrency:4,connectionsPerFile:4}});
      const memory=await bridge.updateSettings(crypto.randomUUID(),{expectedRevision:legacy.data.revision,patch:{memoryMiB:1024}});
      return {handshake,before,actual:await bridge.getDownloadSettings(),legacy,invalid,stale,memory,noNode:typeof process==='undefined'&&typeof require==='undefined',methods:Object.keys(bridge)};
    })()`);
    assert.equal(result.noNode,true); assert.equal(result.handshake.ok,true); assert.ok(result.handshake.data.capabilities.includes('downloads.v1'));
    assert.equal(result.methods.length,33); assert.equal(result.actual.ok,true); assert.equal(result.actual.data.source,'bmclapi');
    assert.equal(result.actual.data.fileConcurrency,6); assert.equal(result.actual.data.connectionsPerFile,3);
    if(process.env.OUCL_DOWNLOAD_TEST_REOPEN!=='1') {assert.equal(result.before.data.source,'official');assert.equal(result.invalid.error.code,'INVALID_ARGUMENT');assert.equal(result.stale.error.code,'REVISION_CONFLICT');assert.equal(result.memory.ok,true);assert.equal('downloads' in result.legacy.data,false);}
    await mkdir(evidence,{recursive:true});
    for(const [label,width,height] of [['settings',1180,820],['settings-small',720,520]]) {
      window.setSize(width,height);await window.webContents.executeJavaScript(`document.querySelector('.download-settings').scrollIntoView({block:'start'})`);await new Promise(r=>setTimeout(r,180));
      assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth'),false);
      await writeFile(path.join(evidence,`${label}.png`),(await window.webContents.capturePage()).toPNG());
    }
    await writeFile(path.join(evidence,process.env.OUCL_DOWNLOAD_TEST_REOPEN==='1'?'ui-reopen.json':'ui.json'),JSON.stringify({status:'PASS',...result},null,2));
    console.log('DOWNLOAD_UI_PASS',process.env.OUCL_DOWNLOAD_TEST_REOPEN==='1'?'reopen':'save');
    clearTimeout(timeout); await window.webContents.session.closeAllConnections(); window.close();
  } catch(error) {console.error(error);clearTimeout(timeout);app.exit(1);}
}));
require('../dist/main/index.cjs');




