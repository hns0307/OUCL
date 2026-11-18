const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');
const { app, ipcMain } = require('electron');

const base = process.env.OUCL_CONFIGURED_FIXTURE_ROOT;
assert.ok(base && path.isAbsolute(base) && path.basename(base).startsWith('distribution-configured-'));
const fixture = require(path.join(base, 'fixture.cjs'));
const runFile = path.join(base, 'electron-result.json');
const restart = process.env.OUCL_CONFIGURED_FIXTURE_RESTART === 'yes';
const startup = fixture.readSeed();
const requests = [];
const unexpectedNetwork = [];
const catalogUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

app.setPath('userData', path.join(base, 'profile'));
app.disableHardwareAcceleration();
require('./electron-network-fixture.cjs')(async (url, init) => {
  if (String(url) !== catalogUrl || init.method !== 'GET') {
    unexpectedNetwork.push('unexpected main-process request');
    throw new Error('UNEXPECTED_MAIN_NETWORK');
  }
  return new globalThis.Response(JSON.stringify({ versions: [{ id: '1.20.1', type: 'release', sha1: 'a'.repeat(40),
    url: 'https://piston-meta.mojang.com/v1/packages/' + 'a'.repeat(40) + '/1.20.1.json', releaseTime: '2026-10-24T00:00:00Z' }] }));
});
globalThis.fetch = async () => {
  unexpectedNetwork.push('unexpected direct fetch');
  throw new Error('UNEXPECTED_DIRECT_FETCH');
};

// Observe the real UI's confirmation input. The genuine handler receives the exact invocation and owns the reply.
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (channel !== 'distribution:confirmExecution') return register(channel, handler);
  return register(channel, (event, input) => {
    requests.push(input);
    return handler(event, input);
  });
};

const timer = setTimeout(() => { console.error('CONFIGURED_DISTRIBUTION_TIMEOUT'); app.exit(2); }, 45_000);

async function run(window) {
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  async function wait(label, observe) {
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const observed = await observe();
      if (observed) return observed;
      await pause(60);
    }
    const state = await evaluate("document.querySelector('.distribution-panel')?.textContent ?? document.querySelector('.main-content')?.innerText");
    throw new Error(label + ': ' + String(state));
  }
  const button = (scope, caption) => '[...document.querySelectorAll(' + JSON.stringify(scope) + ')].find(button => !button.disabled && button.textContent === ' + JSON.stringify(caption) + ')';
  async function click(scope, caption) {
    const element = button(scope, caption);
    await wait(caption, () => evaluate('Boolean(' + element + ')'));
    await evaluate('void (' + element + ').click()');
  }
  const screenshot = async (name, selector) => {
    await evaluate('void document.querySelector(' + JSON.stringify(selector) + ').scrollIntoView({ block: "center", behavior: "instant" })');
    // Capture once to wake hidden compositing, then allow the visible layout to paint.
    const options = { stayHidden: true, stayAwake: true };
    await window.webContents.capturePage(undefined, options);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    const image = await window.webContents.capturePage(undefined, options);
    assert.ok(!image.isEmpty());
    await writeFile(path.join(base, name), image.toPNG());
  };

  assert.deepEqual(unexpectedNetwork, []);
  const prefs = window.webContents.getLastWebPreferences();
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.ok(await evaluate("typeof require === 'undefined' && typeof process === 'undefined'"));
  const handshake = await evaluate('window.oucl.handshake()');
  assert.ok(handshake.ok, JSON.stringify(handshake));
  for (const cap of ['distribution.preview.v1', 'distribution.execute.v1', 'tasks.v1']) {
    assert.ok(handshake.data.capabilities.includes(cap), 'missing capability ' + cap);
  }
  const sources = await evaluate('window.oucl.distributionSources()');
  assert.deepEqual(sources.data, { sources: [{ sourceId: fixture.SOURCE_ID }] });
  const queued = await evaluate('window.oucl.getTask(' + JSON.stringify(startup.taskId) + ')');
  assert.ok(queued.ok, JSON.stringify(queued));
  assert.equal(queued.data.snapshot.taskId, startup.taskId);
  assert.equal(queued.data.snapshot.kind, 'distribution-install');
  assert.equal(queued.data.snapshot.state, 'queued');

  async function confirmAgain(original) {
    const args = JSON.stringify([original.confirmRequestId, original.input]);
    const reply = await evaluate('window.oucl.confirmDistributionExecution(...' + args + ')');
    assert.ok(reply.ok, JSON.stringify(reply));
    assert.equal(reply.requestId, original.confirmRequestId);
    assert.equal(reply.data.taskId, original.taskId);
    assert.equal(reply.data.proposalId, original.proposalId);
    assert.equal(reply.data.snapshot.state, 'completed');
  }
  async function taskCenter(taskId) {
    const task = await evaluate('window.oucl.getTask(' + JSON.stringify(taskId) + ')');
    assert.ok(task.ok, JSON.stringify(task));
    assert.equal(task.data.snapshot.taskId, taskId);
    assert.equal(task.data.snapshot.kind, 'distribution-install');
    assert.equal(task.data.snapshot.state, 'completed');
    const list = await evaluate('window.oucl.listTasks({ limit: 100 })');
    assert.ok(list.ok, JSON.stringify(list));
    assert.ok(list.data.items.some(item => item.taskId === taskId && item.state === 'completed'), JSON.stringify(list));
    const article = taskSection + ' article[data-task-id="' + taskId + '"][data-task-state="completed"]';
    const readRow = 'document.querySelector(' + JSON.stringify(article) + ')';
    await wait('confirmed completed task row', () => evaluate(readRow + '?.querySelector(\'[data-observation-state="confirmed"]\') !== null && Boolean(' + readRow + ')'));
    const row = await evaluate(readRow + '.parentElement.innerText');
    assert.ok(row.includes('社团包安装 · ' + taskId) && row.includes('安装完成'), row);
    return row;
  }
  const taskSection = 'section[aria-label="任务记录"]';
  if (restart) {
    const original = JSON.parse(await readFile(runFile, 'utf8'));
    await confirmAgain(original);
    await click('.top-nav button', '下载');
    const row = await taskCenter(original.taskId);
    await screenshot('task-reopened.png', taskSection);
    await writeFile(path.join(base, 'restart-result.json'), JSON.stringify({ taskId: original.taskId, row, capabilities: handshake.data.capabilities,
      repeatedOriginalConfirmation: true, unexpectedNetwork }, null, 2));
  } else {
    const instance = '.sidebar-list button[data-instance-id="' + fixture.INSTANCE_ID + '"]';
    await wait('registered instance', () => evaluate('Boolean(document.querySelector(' + JSON.stringify(instance) + '))'));
    await evaluate('void document.querySelector(' + JSON.stringify(instance) + ').click()');
    await click('.top-nav button', '工具箱');
    await click('.tools-tabs button', '社团包预览');
    await wait('configured package fields', () => evaluate("document.querySelectorAll('.distribution-panel fieldset input').length === 2"));
    const fields = JSON.stringify([fixture.PACKAGE_ID, fixture.PACKAGE_VERSION]);
    await evaluate('(' + function setValues(values) {
      const inputs = window.document.querySelectorAll('.distribution-panel fieldset input');
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      inputs.forEach((input, index) => {
        setValue.call(input, values[index]);
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    } + ')(' + fields + ')');
    await click('.distribution-execution button', '检查安装差异');
    await wait('prepared file diff', () => evaluate("document.querySelector('.distribution-execution li')?.textContent.includes(" + JSON.stringify(fixture.INSTALLED_FILE) + ')'));
    await screenshot('prepared.png', '.distribution-panel');
    await click('.distribution-execution button', '确认安装变更');
    const taskId = await wait('accepted task', () => evaluate("document.querySelector('.distribution-execution code')?.textContent"));
    assert.equal(requests.length, 1);
    const { requestId: confirmRequestId, payload: input } = requests[0];
    const original = { taskId, confirmRequestId, input, proposalId: input.proposalId };
    await wait('genuine task completion', async () => {
      const reply = await evaluate('window.oucl.getTask(' + JSON.stringify(taskId) + ')');
      assert.ok(reply.ok, JSON.stringify(reply));
      assert.ok(!['failed', 'needsRecovery', 'cancelled'].includes(reply.data.snapshot.state), JSON.stringify(reply));
      return reply.data.snapshot.state === 'completed';
    });
    await confirmAgain(original);
    await click('.distribution-execution button', '任务记录');
    const row = await taskCenter(taskId);
    await screenshot('task-completed.png', taskSection);
    await writeFile(runFile, JSON.stringify({ ...original, row, sources: sources.data.sources, capabilities: handshake.data.capabilities,
      secureWindow: true, startupTaskId: startup.taskId, startupState: queued.data.snapshot.state, repeatedOriginalConfirmation: true,
      electron: process.versions.electron, unexpectedNetwork }, null, 2));
  }
  assert.deepEqual(unexpectedNetwork, []);
  clearTimeout(timer);
  app.quit();
}

app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; // Keep developer desktop focus; product preferences and preload still own the window.
  window.webContents.setBackgroundThrottling(false);
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => {
    unexpectedNetwork.push('unexpected Electron-session request');
    callback({ cancel: true });
  });
  window.webContents.once('did-finish-load', () => {
    void run(window).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
  });
});
require(path.join(base, 'dist', 'main', 'index.cjs'));
