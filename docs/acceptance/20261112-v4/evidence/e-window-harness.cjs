const {app,BrowserWindow,session,dialog}=require('electron');
const fs=require('node:fs'); const path=require('node:path');
const root=__dirname;
const profile=path.join(root,'product-profile'); fs.mkdirSync(profile,{recursive:true});
const mode=process.argv.find(arg=>arg.startsWith('--acceptance-mode='))?.split('=')[1]||'cold';
const log=path.join(root,`product-${mode}.jsonl`);
const record=value=>fs.appendFileSync(log,JSON.stringify({time:new Date().toISOString(),...value})+'\n');
app.setPath('userData',profile); app.disableHardwareAcceleration();
app.whenReady().then(()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>{record({network:'blocked'});callback({cancel:true});});
});
app.on('browser-window-created',(_event,window)=>{
  window.webContents.once('did-finish-load',()=>{
    void (async()=>{
      for(let i=0;i<80;i++) {
        const ready=await window.webContents.executeJavaScript("!!document.querySelector('[data-status=connected]')");
        if(ready) break; await new Promise(resolve=>setTimeout(resolve,100));
      }
      const result=await window.webContents.executeJavaScript(`(async()=>({handshake:await window.oucl.handshake(),bridgeKeys:Object.keys(window.oucl),nodeAbsent:typeof require==='undefined'&&typeof process==='undefined'}))()`);
      const prefs=window.webContents.getLastWebPreferences();
      record({kind:'ready',mode,security:{contextIsolation:prefs.contextIsolation,sandbox:prefs.sandbox,nodeIntegration:prefs.nodeIntegration},...result});
      if(mode==='missing') {record({kind:'missing-worker-result',advertised:result.handshake.ok&&result.handshake.data.capabilities.includes('packs.fixed-preview.v1')}); window.close();}
      else {
        let previous=''; const timer=setInterval(()=>{
          if(window.isDestroyed()) {clearInterval(timer);return;}
          void window.webContents.executeJavaScript("Array.from(document.querySelectorAll('section.panel')).find(x=>x.textContent.includes('选择样本并检查'))?.textContent||''").then(text=>{if(text!==previous){previous=text;record({kind:'pack-panel',text});}}).catch(()=>{});
        },500);
      }
    })().catch(error=>record({kind:'harness-error',message:error.message}));
  });
});
app.on('will-quit',()=>record({kind:'will-quit'})); process.on('exit',code=>record({kind:'exit',code}));

const originalChoose=dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog=async (...args)=>{record({kind:'native-chooser-open'});try{const result=await originalChoose(...args);record({kind:'native-chooser-settled',cancelled:result.canceled,fileCount:result.filePaths.length});return result;}catch(error){record({kind:'native-chooser-error',message:error.message});throw error;}};
const destroyTimer=setInterval(()=>{const marker=path.join(root,'destroy-owned-window');if(fs.existsSync(marker)){clearInterval(destroyTimer);const owned=BrowserWindow.getAllWindows()[0];if(owned){record({kind:'destroy-request',windowCount:BrowserWindow.getAllWindows().length});owned.webContents.once('destroyed',()=>record({kind:'sender-destroyed'}));owned.destroy();}}},200);
app.on('will-quit',()=>clearInterval(destroyTimer));
require(path.join(root,'..','product','main','index.cjs'));

