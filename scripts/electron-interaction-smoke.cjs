const { app, session, dialog, nativeImage } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
const profile = path.resolve(process.env.OUCL_INTERACTION_PROFILE || '');
assert.ok(profile.startsWith(path.resolve('.test-build') + path.sep) && path.basename(profile).startsWith('interaction-'));
const pass = Number(process.env.OUCL_INTERACTION_PASS); const evidence = path.resolve(process.env.OUCL_VALIDATION_DIR ?? 'docs/validation/UI-20261028');
const icon = nativeImage.createFromBitmap(Buffer.from(Array.from({ length: 16 * 16 }, () => [80, 130, 175, 255]).flat()), { width: 16, height: 16 }).toPNG();
const fixtureFile = path.join(profile, 'fixture-icon.png');
let nativeChoosers = 0; const requests = []; let started = false; let failed = false;
dialog.showOpenDialog = async () => { nativeChoosers++; return { canceled: false, filePaths: [fixtureFile] }; };
globalThis.fetch = async input => {
  const url = String(input); requests.push(url);
  if (url === 'https://cdn.modrinth.com/data/abcdefgh/icon.png') return new globalThis.Response(icon, { headers: { 'content-type': 'image/png' } });
  let value;
  if (url.includes('version_manifest_v2.json')) value = { versions: [{ id: '1.20.1', type: 'release', url: `https://piston-meta.mojang.com/v1/packages/${'a'.repeat(40)}/1.20.1.json`, sha1: 'a'.repeat(40), releaseTime: '2026-01-01T00:00:00Z' }] };
  else if (url.includes('/v2/search')) value = { hits: [{ project_id: 'abcdefgh', title: 'Fixture Project', author: 'Local fixture', description: '仅本地测试资源', downloads: 0, project_type: 'mod' }], total_hits: 1, offset: 0 };
  else if (url.endsWith('/v2/project/abcdefgh')) value = { id: 'abcdefgh', icon_url: 'https://cdn.modrinth.com/data/abcdefgh/icon.png' };
  else if (url.includes('/v2/project/abcdefgh/version')) value = [{ id: '1234ABCD', project_id: 'abcdefgh', name: 'Fixture version', game_versions: ['1.20.1'], loaders: ['fabric'], files: [{ filename: 'fixture.jar', size: 1, primary: true, hashes: { sha1: 'a'.repeat(40) } }] }];
  else throw new Error('UNEXPECTED_REQUEST_NO_EXTERNAL_NETWORK');
  return new globalThis.Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
};
const timeout = setTimeout(() => { console.error('INTERACTION_TIMEOUT'); failed = true; app.quit(); }, 90000);
app.on('will-quit', () => { if (failed) app.exit(1); });
async function run(window) {
  if (started) return; started = true; const evaluate = code => window.webContents.executeJavaScript(code);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function wait(expression) { const end = Date.now() + 12000; while (!await evaluate(`Boolean(${expression})`)) { if (Date.now() > end) throw new Error(`CONDITION:${expression}`); await pause(35); } }
  const click = text => evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
  const page = async index => { await evaluate(`document.querySelectorAll('.top-nav button')[${index}].click()`); await pause(90); };
  const input = async (selector, value) => { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await pause(70); };
  try {
    await wait(`document.querySelector('[data-status="connected"]') && !document.querySelector('.sidebar-toggle').disabled`);
    const secure = await evaluate(`(async()=>({node:typeof require==='undefined'&&typeof process==='undefined',handshake:await window.oucl.handshake()}))()`);
    assert.ok(secure.node); assert.ok(secure.handshake.data.capabilities.includes('desktop.v1'));
    if (pass === 2) {
      const current = await evaluate('window.oucl.getDesktop()'); assert.ok(current.ok); assert.equal(current.data.appearance.sidebarCollapsed, true); assert.equal(current.data.appearance.accent, '#407da0'); assert.equal(current.data.appearance.layout, 'profile-left'); assert.equal(current.data.drafts[0].title, '本地论坛验收');
      assert.ok(await evaluate(`document.querySelector('.brand-custom-icon')?.src.startsWith('data:image/png')`));
      await page(2); await wait(`document.querySelector('.forum-topics').textContent.includes('本地论坛验收')`);
      await writeFile(path.join(evidence, 'restart.png'), (await window.webContents.capturePage()).toPNG());
    } else {
      await evaluate(`document.querySelector('.sidebar-toggle').click()`); await wait(`document.querySelector('.app-shell').classList.contains('sidebar-collapsed') && !document.querySelector('.sidebar-toggle').disabled`);
      await page(3);
      await input('.memory-slider-label input[type=range]', '4096'); assert.equal(await evaluate(`document.querySelector('.memory-exact input').value`), '4096');
      await evaluate(`document.querySelector('.settings-launch .save-row button').click()`); await wait(`document.querySelector('.settings-launch .success').textContent==='已保存'`);
      assert.equal((await evaluate('window.oucl.getSettings()')).data.memoryMiB, 4096);
      assert.equal(await evaluate(`document.querySelector('.advanced-settings').open`), false);
      await evaluate(`document.querySelector('.memory-control').scrollIntoView({block:'center'})`); await pause(80); await writeFile(path.join(evidence, 'memory.png'), (await window.webContents.capturePage()).toPNG());
      assert.equal(await evaluate(`document.querySelector('.settings-appearance').open`), false);
      await evaluate(`document.querySelector('.settings-appearance>summary').click();document.querySelector('.settings-appearance').scrollIntoView({block:'start'})`); await pause(80);
      await evaluate(`document.querySelectorAll('.palette-button')[1].click()`); await click('选择本地图标'); await wait(`document.querySelector('.custom-brand-preview') !== null`); assert.equal(nativeChoosers, 1);
      await evaluate(`(()=>{const e=document.querySelector('.appearance-settings select');e.value='profile-left';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await evaluate(`document.querySelector('[aria-label="上移 当前游戏"]').click()`);
      const reordered = await evaluate(`(()=>{const handles=[...document.querySelectorAll('.layout-order-row .drag-grip')];const data=new DataTransfer();handles[1].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));handles[2].parentElement.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));handles[2].parentElement.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));return data.getData('application/x-oucl-home-card')})()`); assert.equal(reordered, 'banner');
      await evaluate(`document.querySelector('.appearance-settings .save-row button').click()`); await wait(`document.querySelector('.appearance-settings [role=status]').textContent==='已保存'`);
      const appearance = (await evaluate('window.oucl.getDesktop()')).data.appearance; assert.equal(appearance.homeOrder[0], 'game'); assert.equal(appearance.layout, 'profile-left'); assert.ok(appearance.icon.startsWith('data:image/png'));
      assert.equal(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--green').trim()`), '#407da0');
      await writeFile(path.join(evidence, 'settings.png'), (await window.webContents.capturePage()).toPNG());
      await evaluate(`document.querySelectorAll('.palette-button')[2].click();document.querySelector('.sidebar-toggle').click()`); await wait(`!document.querySelector('.app-shell').classList.contains('sidebar-collapsed') && !document.querySelector('.sidebar-toggle').disabled`);
      assert.equal(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--green').trim()`), '#b3a0df');
      await pause(250);
      await writeFile(path.join(evidence, 'dark-preview.png'), (await window.webContents.capturePage()).toPNG());
      await evaluate(`document.querySelector('.sidebar-toggle').click()`); await wait(`document.querySelector('.app-shell').classList.contains('sidebar-collapsed') && !document.querySelector('.sidebar-toggle').disabled`);
      await evaluate(`document.querySelector('.appearance-settings .save-row .text-button').click()`); await wait(`getComputedStyle(document.documentElement).getPropertyValue('--green').trim()==='#407da0'`);
      await page(2); assert.equal(await evaluate(`document.querySelectorAll('.top-nav button')[2].textContent`), '论坛'); await click('写帖子');
      await input('.forum-reader input', '本地论坛验收'); await input('.forum-reader textarea', '这是一份实际持久化草稿。\n不会发送到后台。'); await click('保存本地草稿');
      await wait(`document.querySelector('.forum-topics').textContent.includes('本地论坛验收') && !document.querySelector('.forum-reader textarea')`);
      await input('.forum-toolbar input', '不存在的标题'); await wait(`document.querySelectorAll('.forum-topics .resource-row').length===0`); await input('.forum-toolbar input', '');
      await wait(`document.querySelectorAll('.forum-topics .resource-row').length===1`); await evaluate(`document.querySelector('.forum-topics .resource-row').click()`); await wait(`document.querySelector('.forum-body')?.textContent.includes('实际持久化草稿')`);
      await writeFile(path.join(evidence, 'forum.png'), (await window.webContents.capturePage()).toPNG());
      await page(1); await evaluate(`document.querySelectorAll('.download-tabs button')[1].click()`); await wait(`document.querySelector('.resource-monogram img') !== null`);
      const drop = await evaluate(`(()=>{const row=document.querySelector('.resource-results .resource-row');const target=document.querySelector('.resource-detail');const data=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));return data.getData('application/x-oucl-resource')})()`); assert.equal(drop, 'abcdefgh');
      await wait(`document.querySelector('.resource-detail h2')?.textContent==='Fixture Project'`);
      const before = await evaluate(`Number(document.querySelector('.resource-splitter').getAttribute('aria-valuenow'))`); await evaluate(`document.querySelector('.resource-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`); assert.equal(await evaluate(`Number(document.querySelector('.resource-splitter').getAttribute('aria-valuenow'))`), before - 5);
      await writeFile(path.join(evidence, 'downloads.png'), (await window.webContents.capturePage()).toPNG());
      await page(0); await writeFile(path.join(evidence, 'home.png'), (await window.webContents.capturePage()).toPNG());
      window.setSize(720, 560); await pause(150);
      for (let i = 0; i < 4; i++) { await page(i); assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`), false, `SMALL_PAGE_${i}`); }
      await writeFile(path.join(evidence, 'small.png'), (await window.webContents.capturePage()).toPNG());
    }
    await writeFile(path.join(evidence, `pass-${pass}.json`), JSON.stringify({ timestamp: new Date().toISOString(), status: 'PASS', pass, externalNetwork: 0, mockedRequests: requests.length, nativeChoosers, secureRenderer: true, persistedReopen: pass === 2,
      capabilities: secure.handshake.data.capabilities, bridgeMethods: await evaluate('Object.keys(window.oucl)'), verified: pass === 1 ? ['sidebar-collapse', 'memory-slider-save', 'collapsed-settings', 'palette-preview', 'native-icon-read-and-reencode-with-fixture-dialog', 'home-layout-keyboard-and-drag', 'dark-preview-preserved-during-sidebar-save', 'forum-draft-save-read-search', 'resource-own-icon-fixture', 'resource-card-drop', 'splitter-keyboard', 'four-pages-small-window-no-overflow'] : ['appearance-and-icon-reopen', 'forum-draft-reopen'] }, null, 2));
    console.log(`INTERACTION_PASS_${pass}`); clearTimeout(timeout); window.close(); app.quit();
  } catch (error) { console.error(error); failed = true; clearTimeout(timeout); await writeFile(path.join(evidence, `pass-${pass}.json`), JSON.stringify({ status: 'FAIL', error: error.message }, null, 2)); window.close(); app.quit(); }
}
void (async () => {
  await mkdir(evidence, { recursive: true }); await writeFile(fixtureFile, icon); app.setPath('userData', profile);
  app.on('ready', () => { session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); });
  app.on('browser-window-created', (_event, window) => { window.webContents.setBackgroundThrottling(false); window.webContents.once('did-finish-load', () => { void run(window); }); });
  require('./electron-network-fixture.cjs')(globalThis.fetch);
  require('../dist/main/index.cjs');
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
