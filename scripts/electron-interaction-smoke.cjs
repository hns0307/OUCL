const { app, session, dialog, ipcMain, nativeImage } = require('electron');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
const profile = path.resolve(process.env.OUCL_INTERACTION_PROFILE || '');
assert.ok(profile.startsWith(path.resolve('.test-build') + path.sep) && path.basename(profile).startsWith('interaction-'));
const pass = Number(process.env.OUCL_INTERACTION_PASS); const evidence = path.resolve(process.env.OUCL_VALIDATION_DIR ?? 'docs/validation/UI-20261028');
const icon = nativeImage.createFromBitmap(Buffer.from(Array.from({ length: 16 * 16 }, () => [80, 130, 175, 255]).flat()), { width: 16, height: 16 }).toPNG();
const fixtureFile = path.join(profile, 'fixture-icon.png');
const fixtureRoot = profile + '-games';
const preparationRecord = path.join(profile, 'expected-preparation.json');
let rootChoosers = 0;
let rejectNextAccountRead = false;
let injectedAccountFailures = 0;
const registerHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (channel !== 'accounts:list') return registerHandler(channel, handler);
  return registerHandler(channel, async (event, input) => {
    const reply = await handler(event, input);
    if (!rejectNextAccountRead || !reply.ok) return reply;
    rejectNextAccountRead = false;
    injectedAccountFailures++;
    return { contractVersion: reply.contractVersion, requestId: reply.requestId, ok: false,
      error: { category: 'disk', code: 'STORAGE_UNAVAILABLE', messageKey: 'unavailable', retryable: true, traceId: randomUUID() } };
  });
};
let nativeChoosers = 0; const requests = []; let started = false; let failed = false;
dialog.showOpenDialog = async (_window, options) => {
  if (options.properties.includes('openDirectory')) {
    rootChoosers++;
    return { canceled: false, filePaths: [fixtureRoot] };
  }
  nativeChoosers++;
  return { canceled: false, filePaths: [fixtureFile] };
};
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
  const pages = ['首页', '下载', '论坛', '工具箱', '设置'];
  const page = async caption => {
    await evaluate(`[...document.querySelectorAll('.top-nav button')].find(button => button.textContent.trim() === ${JSON.stringify(caption)}).click()`);
    await wait(`document.querySelector('.page-heading h1')?.textContent.trim() === ${JSON.stringify(caption)}`);
  };
  const input = async (selector, value) => { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await pause(70); };
  async function preparation() {
    const projection = await evaluate(`Promise.all([window.oucl.listRoots(), window.oucl.listAccounts(), window.oucl.getSettings()])`);
    for (const reply of projection) assert.ok(reply.ok, JSON.stringify(reply));
    const [roots, accounts, settings] = projection.map(reply => reply.data);
    assert.equal(roots.items.length, 1);
    assert.equal(roots.items[0].available, true);
    assert.equal(settings.memoryMiB, 4096);
    return { roots: roots.items, accounts: accounts.items, settings };
  }

  async function verifyPreparation() {
    await page('设置');
    await evaluate(`document.querySelector('.root-settings button').click()`);
    await wait(`document.querySelector('.registered-root')`);
    assert.equal(rootChoosers, 1);
    await page('首页');
    await click('选择离线档案');
    assert.ok(await evaluate(`document.activeElement.matches('.accounts-focus')`));
    for (const [nickname, gameName] of [['本地档案甲', 'LocalAlpha'], ['本地档案乙', 'LocalBravo']]) {
      await evaluate(`document.querySelector('.account-chooser > button').click()`);
      await input('.account-form label:first-of-type input', nickname);
      await input('.account-form label:nth-of-type(2) input', gameName);
      await evaluate(`document.querySelector('.account-form button[type=submit]').click()`);
      await wait(`document.querySelector('.player-name span')?.textContent === ${JSON.stringify(gameName)} && !document.querySelector('.account-form')`);
    }
    const expected = await preparation();
    assert.equal(expected.accounts.length, 2);
    assert.ok(expected.accounts.every(account => account.ready));
    const alternate = expected.accounts[1].accountId;
    await evaluate(`(() => {
      const select = document.querySelector('.account-chooser select');
      select.value = ${JSON.stringify(alternate)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    rejectNextAccountRead = true;
    await click('重新检查');
    await wait(`document.querySelector('.first-run-guide [role="alert"]')?.textContent === '暂时无法完成请求。'`);
    assert.equal(injectedAccountFailures, 1);
    assert.equal(await evaluate(`document.querySelector('.account-chooser select').value`), alternate);
    await wait(`[...document.querySelectorAll('.first-run-guide button')].some(button => !button.disabled && button.textContent === '重新检查')`);
    await click('重新检查');
    await wait(`!document.querySelector('.first-run-guide [role="alert"]')`);
    await wait(`[...document.querySelectorAll('.first-run-guide button')].some(button => !button.disabled && button.textContent === '重新检查')`);
    assert.equal(await evaluate(`document.querySelector('.account-chooser select').value`), alternate);
    assert.deepEqual(await preparation(), expected);
    await wait(`document.querySelector('.first-run-guide').textContent.includes('已选择游戏目录') && document.querySelector('.first-run-guide').textContent.includes('已选择可用离线档案')`);
    await click('准备完成');
    await wait(`document.querySelector('.first-run-reopen')`);
    await writeFile(preparationRecord, JSON.stringify(expected));
  }

  try {
    await wait(`document.querySelector('[data-status="connected"]') && !document.querySelector('.sidebar-toggle').disabled`);
    const secure = await evaluate(`(async()=>({node:typeof require==='undefined'&&typeof process==='undefined',handshake:await window.oucl.handshake()}))()`);
    assert.ok(secure.node); assert.ok(secure.handshake.data.capabilities.includes('desktop.v1'));
    if (pass === 2) {
      const current = await evaluate('window.oucl.getDesktop()'); assert.ok(current.ok); assert.equal(current.data.appearance.sidebarCollapsed, true); assert.equal(current.data.appearance.accent, '#407da0'); assert.equal(current.data.appearance.layout, 'profile-left'); assert.equal(current.data.drafts[0].title, '本地论坛验收');
      assert.ok(await evaluate(`document.querySelector('.brand-custom-icon')?.src.startsWith('data:image/png')`));
      const expected = JSON.parse(await readFile(preparationRecord, 'utf8'));
      assert.deepEqual(await preparation(), expected);
      await wait(`document.querySelector('.first-run-reopen') && document.querySelector('.account-chooser select').value === ${JSON.stringify(expected.accounts[0].accountId)}`);
      await click('打开启动准备');
      await wait(`document.querySelector('.first-run-guide').textContent.includes('已选择游戏目录') && document.querySelector('.first-run-guide').textContent.includes('已选择可用离线档案')`);
      assert.equal(rootChoosers, 0);
      await page('论坛'); await wait(`document.querySelector('.forum-topics').textContent.includes('本地论坛验收')`);
      await writeFile(path.join(evidence, 'restart.png'), (await window.webContents.capturePage()).toPNG());
    } else {
      await evaluate(`document.querySelector('.sidebar-toggle').click()`); await wait(`document.querySelector('.app-shell').classList.contains('sidebar-collapsed') && !document.querySelector('.sidebar-toggle').disabled`);
      await wait(`document.querySelector('.first-run-guide')`);
      await click('暂时跳过');
      await wait(`document.querySelector('.first-run-reopen')`);
      await click('打开启动准备');
      await wait(`document.querySelector('.first-run-guide')`);
      await evaluate(`document.querySelector('.first-run-steps button').click()`);
      await wait(`document.querySelector('.settings-launch')`);
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
      await click('恢复默认外观');
      await wait(`getComputedStyle(document.documentElement).getPropertyValue('--green').trim()==='#50765a'`);
      assert.equal((await evaluate('window.oucl.getDesktop()')).data.appearance.accent, '#407da0');
      await evaluate(`document.querySelector('.appearance-settings').focus()`);
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait(`getComputedStyle(document.documentElement).getPropertyValue('--green').trim()==='#407da0'`);
      await page('工具箱');
      await input('.toolbox-panel > textarea', '甲👨‍👩‍👧‍👦乙');
      await click('选择输出');
      const output = await evaluate(`(() => { const el = document.querySelector('.toolbox-output'); return { json: JSON.parse(el.value), selected: document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length }; })()`);
      assert.deepEqual(output.json.extra.map(item => item.text), ['甲', '👨‍👩‍👧‍👦', '乙']);
      assert.ok(output.selected);
      await writeFile(path.join(evidence, 'toolbox.png'), (await window.webContents.capturePage()).toPNG());
      await page('论坛'); await click('写帖子');
      await input('.forum-reader input', '本地论坛验收'); await input('.forum-reader textarea', '这是一份实际持久化草稿。\n不会发送到后台。'); await click('保存本地草稿');
      await wait(`document.querySelector('.forum-topics').textContent.includes('本地论坛验收') && !document.querySelector('.forum-reader textarea')`);
      await input('.forum-toolbar input', '不存在的标题'); await wait(`document.querySelectorAll('.forum-topics .resource-row').length===0`); await input('.forum-toolbar input', '');
      await wait(`document.querySelectorAll('.forum-topics .resource-row').length===1`); await evaluate(`document.querySelector('.forum-topics .resource-row').click()`); await wait(`document.querySelector('.forum-body')?.textContent.includes('实际持久化草稿')`);
      await writeFile(path.join(evidence, 'forum.png'), (await window.webContents.capturePage()).toPNG());
      await page('下载'); await evaluate(`document.querySelectorAll('.download-tabs button')[1].click()`); await wait(`document.querySelector('.resource-monogram img') !== null`);
      const drop = await evaluate(`(()=>{const row=document.querySelector('.resource-results .resource-row');const target=document.querySelector('.resource-detail');const data=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));return data.getData('application/x-oucl-resource')})()`); assert.equal(drop, 'abcdefgh');
      await wait(`document.querySelector('.resource-detail h2')?.textContent==='Fixture Project'`);
      const before = await evaluate(`Number(document.querySelector('.resource-splitter').getAttribute('aria-valuenow'))`); await evaluate(`document.querySelector('.resource-splitter').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`); assert.equal(await evaluate(`Number(document.querySelector('.resource-splitter').getAttribute('aria-valuenow'))`), before - 5);
      await writeFile(path.join(evidence, 'downloads.png'), (await window.webContents.capturePage()).toPNG());
      await page('首页'); await writeFile(path.join(evidence, 'home.png'), (await window.webContents.capturePage()).toPNG());
      window.setSize(720, 560); await pause(150);
      for (const caption of pages) { await page(caption); assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`), false, `SMALL_PAGE_${caption}`); }
      await writeFile(path.join(evidence, 'small.png'), (await window.webContents.capturePage()).toPNG());
      await verifyPreparation();
    }
    await writeFile(path.join(evidence, `pass-${pass}.json`), JSON.stringify({ timestamp: new Date().toISOString(), status: 'PASS', pass, externalNetwork: 0, mockedRequests: requests.length, nativeChoosers, rootChoosers, injectedAccountFailures, secureRenderer: true, persistedReopen: pass === 2,
      capabilities: secure.handshake.data.capabilities, bridgeMethods: await evaluate('Object.keys(window.oucl)'), verified: pass === 1 ? ['sidebar-collapse', 'memory-slider-save', 'collapsed-settings', 'palette-preview', 'native-icon-read-and-reencode-with-fixture-dialog', 'home-layout-keyboard-and-drag', 'dark-preview-preserved-during-sidebar-save', 'forum-draft-save-read-search', 'resource-own-icon-fixture', 'resource-card-drop', 'splitter-keyboard', 'first-run-skip-reopen-settings', 'default-appearance-preview-only', 'appearance-escape-cancels-preview', 'toolbox-graphemes-and-output-selection', 'five-pages-small-window-no-overflow', 'guide-account-focus-and-root-registration', 'guide-read-failure-preserves-selected-account', 'guide-retry-clears-error-and-preserves-root-account-settings'] : ['appearance-and-icon-reopen', 'forum-draft-reopen', 'guide-reopens-with-existing-root-and-offline-profiles'] }, null, 2));
    console.log(`INTERACTION_PASS_${pass}`); clearTimeout(timeout); window.close(); app.quit();
  } catch (error) { console.error(error); failed = true; clearTimeout(timeout); await writeFile(path.join(evidence, `pass-${pass}.json`), JSON.stringify({ status: 'FAIL', error: error.message }, null, 2)); window.close(); app.quit(); }
}
void (async () => {
  await mkdir(evidence, { recursive: true }); await mkdir(fixtureRoot, { recursive: true }); await writeFile(fixtureFile, icon); app.setPath('userData', profile);
  app.on('ready', () => { session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true })); });
  app.on('browser-window-created', (_event, window) => { window.webContents.setBackgroundThrottling(false); window.webContents.once('did-finish-load', () => { void run(window); }); });
  require('./electron-network-fixture.cjs')(globalThis.fetch);
  require(path.join(path.resolve(process.env.OUCL_BUILD_ROOT ?? 'dist'), 'main/index.cjs'));
})().catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
