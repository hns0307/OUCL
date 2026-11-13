// TEST ONLY. Adds no generic renderer bridge. Production window preload remains installed.
const { ipcRenderer } = require('electron');
const channels = ['mods:maintenancePreview','mods:maintenancePreviewStatus','mods:maintenancePreviewCancel'];
const id = '00000000-0000-4000-8000-000000000002';
const valid = channel => channel === channels[0] ? {
  rootId:'00000000-0000-4000-8000-000000000001',instanceId:id,expectedRevision:1,
  expectedFingerprint:'a'.repeat(64),fileId:'b'.repeat(64),action:'disable'
} : {previewId:id};
addEventListener('DOMContentLoaded',async()=>{
  const role=location.pathname.endsWith('/untrusted.html')?'untrusted':'primary';
  const results=[];
  try {
    // Never submit a structurally valid preview start from the primary document.
    for(const channel of channels) {
      const variants=role==='primary'?['extra','path']:['sender'];
      for(const variant of variants) {
        const payload=valid(channel);
        if(variant==='extra') payload.extra='test-only';
        if(variant==='path') {
          if(channel===channels[0]) payload.fileId='C:\\C-R7-test-only\\private.jar';
          else payload.previewId='https://example.invalid/C-R7-test-only';
        }
        const requestId=crypto.randomUUID();
        const reply=await ipcRenderer.invoke(channel,{contractVersion:1,requestId,payload});
        results.push({channel,variant,requestId,reply});
      }
    }
    ipcRenderer.send('c-r7:test-report',{role,results,preload:{isMainFrame:process.isMainFrame,sandboxed:process.sandboxed,contextIsolated:process.contextIsolated}});
  } catch(error) {
    ipcRenderer.send('c-r7:test-report',{role,errorName:error?.name,results});
  }
},{once:true});
