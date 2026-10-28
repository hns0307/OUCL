const { app, session } = require('electron');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

app.disableHardwareAcceleration();
const requests = []; let started = false;
const directory = path.resolve(process.env.OUCL_VALIDATION_DIR ?? 'docs/validation/LOADER-SELECTION-20261027');
const timeout = setTimeout(() => { console.error('LOCAL_LOADER_TIMEOUT'); app.once('will-quit', () => { app.exit(1); }); app.quit(); }, 60000);
// Test-only transport injection. Never calls the real fetch or changes the production entry.
globalThis.fetch = async input => {
  const url = String(input); requests.push(url); let value;
  if (url === 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json') value = { versions: ['1.21.1', '1.20.1'].map(id => ({
    id, type: 'release', url: `https://piston-meta.mojang.com/v1/packages/${'a'.repeat(40)}/${id}.json`, sha1: 'a'.repeat(40), releaseTime: '2026-01-01T00:00:00Z'
  })) };
  else if (/^https:\/\/meta\.(fabricmc\.net\/v2|quiltmc\.org\/v3)\/versions\/loader\/1\.(20|21)\.1$/.test(url)) {
    const fabric = url.includes('fabricmc'); const minecraft = url.split('/').at(-1);
    value = (fabric ? ['0.20.1', '0.16.14'] : ['0.29.3', '0.29.2']).map(version => ({
      loader: { version, stable: true, maven: `${fabric ? 'net.fabricmc:fabric-loader' : 'org.quiltmc:quilt-loader'}:${version}` },
      intermediary: { version: minecraft, maven: `net.fabricmc:intermediary:${minecraft}` }
    })); await new Promise(resolve => setTimeout(resolve, 100));
  } else if (url === 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json') value = { promos: { '1.20.1-recommended': '47.4.28', '1.20.1-latest': '47.4.30' } };
  else if (url === 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge') value = { isSnapshot: false, versions: ['21.1.266', '21.1.265'] };
  else throw new Error('UNEXPECTED_EXTERNAL_REQUEST');
  return new globalThis.Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
};
async function run(window) {
  if (started) return; started = true; const evaluate = code => window.webContents.executeJavaScript(code);
  async function wait(expression) {
    const deadline = Date.now() + 10000;
    while (!await evaluate(`Boolean(${expression})`)) { if (Date.now() > deadline) throw new Error('LOCAL_LOADER_CONDITION_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  async function minecraft(value) {
    await evaluate(`[...document.querySelectorAll('.version-list li')].find(row=>row.querySelector('strong').textContent==='${value}').querySelector('button').click()`);
    await wait(`document.querySelector('.selected-version')?.textContent==='${value}'`);
  }
  async function loader(value) {
    await evaluate(`(()=>{const element=document.querySelector('.install-confirm label select');element.value='${value}';element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  try {
    await wait(`document.querySelector('[data-status="connected"]')`);
    console.log('LOCAL_LOADER_CONNECTED');
    await evaluate(`document.querySelectorAll('.top-nav button')[1].click()`); await wait(`document.querySelectorAll('.version-list li').length===2`);
    await minecraft('1.20.1'); const selected = [];
    for (const [kind, version, java] of [['fabric', '0.16.14', 17], ['quilt', '0.29.2', 17], ['forge', '47.4.28', 17], ['neoforge', '21.1.265', 21]]) {
      if (kind === 'neoforge') {
        const before = requests.filter(url => url.includes('promotions_slim')).length; await minecraft('1.21.1');
        await wait(`document.querySelector('.install-confirm .form-error') && document.querySelector('.install-confirm .primary').disabled`);
        assert.equal(requests.filter(url => url.includes('promotions_slim')).length, before);
      }
      await loader(kind); await wait(`document.querySelectorAll('.install-confirm label select')[1]?.value==='${version}'`);
      assert.ok(await evaluate(`document.querySelector('.loader-target').textContent.includes('Java ${java}')`));
      assert.ok(await evaluate(`document.querySelector('.install-confirm').textContent.includes('尚未完成游戏运行验证')`));
      assert.ok(await evaluate(`document.querySelector('.install-confirm .primary').disabled`)); // No selected game root, so no installation can be admitted.
      selected.push({ loader: kind, selectedVersion: version, javaMajor: java, unverified: true });
      console.log(`LOCAL_LOADER_SELECTED_${kind}`);
    }
    await minecraft('1.20.1'); await loader('fabric'); await new Promise(resolve => setTimeout(resolve, 20)); await loader('quilt');
    await wait(`document.querySelectorAll('.install-confirm label select')[1]?.value==='0.29.2'`); await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await evaluate(`document.querySelectorAll('.install-confirm label select')[1].value`), '0.29.2');
    await minecraft('1.21.1'); await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(await evaluate(`document.querySelectorAll('.install-confirm label select')[1].disabled && document.querySelectorAll('.install-confirm label select')[1].value===''`));
    await wait(`document.querySelectorAll('.install-confirm label select')[1]?.value==='0.29.3'`);
    await mkdir(directory, { recursive: true }); await evaluate(`document.querySelector('.install-confirm').scrollIntoView({behavior:'instant',block:'start'})`);
    await new Promise(resolve => setTimeout(resolve, 150)); await writeFile(path.join(directory, 'loader-selection.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(720, 560); await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
    const report = { timestamp: new Date().toISOString(), status: 'PASS', productionMainAndPreload: true, fixtureMetadata: true,
      externalNetworkRequests: 0, installationAdmitted: false, selections: selected, unsupportedMatrixBlocked: true, staleCatalogResponseIgnored: true,
      oldMinecraftOptionsCleared: true, smallWindowNoOverflow: true, metadataRequests: requests.length };
    await writeFile(path.join(directory, 'smoke.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    clearTimeout(timeout); window.destroy(); app.quit();
  } catch (error) { clearTimeout(timeout); console.error(error); app.once('will-quit', () => { app.exit(1); }); window.destroy(); app.quit(); }
}
(async () => {
  const profile = process.env.OUCL_LOCAL_LOADER_PROFILE; assert.ok(profile && path.basename(profile).startsWith('loader-local-'));
  app.setPath('userData', profile);
  app.whenReady().then(() => { session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { callback({ cancel: true }); }); });
  app.on('browser-window-created', (_event, window) => { window.webContents.setBackgroundThrottling(false); window.webContents.once('did-finish-load', () => { void run(window); }); });
  require('../dist/main/index.cjs');
})().catch(error => { clearTimeout(timeout); console.error(error); app.exit(1); });
