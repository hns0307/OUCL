
const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync } = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const testOutput = path.resolve('.test-build', 'feature-centers');
mkdirSync(testOutput, { recursive: true });
app.setPath('userData', mkdtempSync(path.join(testOutput, 'userdata-')));
app.disableHardwareAcceleration();
delete process.env.OUCL_MICROSOFT_CLIENT_ID;
delete process.env.OUCL_PORTABLE_ROOT;
const timeout = setTimeout(() => { console.error('FEATURE_CENTERS_TIMEOUT'); app.exit(1); }, 30_000);

app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => { void verify(window); });
});

async function verify(window) {
  try {
    const reply = await window.webContents.executeJavaScript(`(async () => {
      const wait = async (condition) => {
        for (let index = 0; index < 120; index++) {
          if (condition()) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('UI_NOT_READY');
      };
      const click = (selector, text) => {
        const button = Array.from(document.querySelectorAll(selector)).find(item => item.textContent.trim() === text);
        if (!button) throw new Error('NAVIGATION_MISSING');
        button.click();
      };
      await wait(() => document.querySelector('[data-status="connected"]'));
      const handshake = await window.oucl.handshake();
      const account = await window.oucl.onlineAccounts({ kind: 'list' });
      const offline = await window.oucl.createOfflineAccount(crypto.randomUUID(), { displayName: 'Smoke user', gameName: 'FeatureSmoke' });
      const skins = await window.oucl.skinList();
      const room = await window.oucl.multiplayer({ action: 'snapshot' });
      click('.top-nav button', '工具箱');
      await wait(() => document.querySelector('.feature-center-tabs'));
      for (const name of ['账号管理', '皮肤中心', '网站中心', '联机中心']) {
        click('.feature-center-tabs button', name);
        await wait(() => document.querySelector('.feature-center-tabs button[aria-pressed="true"]')?.textContent.trim() === name);
      }
      return { handshake, account, offline, skins, room, noNode: typeof require === 'undefined' && typeof process === 'undefined' };
    })()`);
    assert.equal(reply.handshake.ok, true);
    for (const capability of ['accounts.v1', 'accounts.online.v1', 'skin.v1', 'web-extensions.v1', 'multiplayer.v1']) {
      assert.ok(reply.handshake.data.capabilities.includes(capability), capability);
    }
    assert.equal(reply.noNode, true);
    assert.equal(reply.account.ok, true);
    assert.equal(reply.account.data.microsoftConfigured, false);
    assert.equal(reply.offline.ok, true);
    assert.equal(reply.skins.ok, true);
    assert.deepEqual(reply.skins.data.providers, []);
    assert.equal(reply.room.ok, true);
    assert.equal(await safeStorage.isAsyncEncryptionAvailable(), true);
    const encrypted = await safeStorage.encryptStringAsync('OUCL secure fixture');
    assert.notEqual(encrypted.toString(), 'OUCL secure fixture');
    assert.equal((await safeStorage.decryptStringAsync(encrypted)).result, 'OUCL secure fixture');
    console.log('FEATURE_CENTERS_ELECTRON_PASS', process.versions.electron);
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  }
}

require('../dist/main/index.cjs');
