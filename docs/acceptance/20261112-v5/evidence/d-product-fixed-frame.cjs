// Launch only by the coordinating chat after prepared.json exists. No automatic game action.
const { app, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const product = path.resolve(__dirname, '../product');
const preparedFile = path.join(__dirname, 'prepared.json');
const prepared = JSON.parse(fs.readFileSync(preparedFile, 'utf8'));
const expectedProfile = path.join(__dirname, 'isolated/profile');
if (path.resolve(prepared.profile) !== path.resolve(expectedProfile)) throw new Error('PROFILE_MISMATCH');
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../product-manifest.json'), 'utf8'));
const verified = manifest.map(item => {
  const file = path.resolve(product, item.path);
  const relative = path.relative(product, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('UNSAFE_MANIFEST');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (sha256 !== item.sha256) throw new Error('PRODUCT_DIGEST_MISMATCH');
  return { path: item.path, sha256 };
});
fs.writeFileSync(path.join(__dirname, 'harness-product-verified.json'), JSON.stringify(verified, null, 2));
app.setPath('userData', expectedProfile);
const log = value => fs.appendFileSync(path.join(__dirname, 'product-public.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, input) => {
  const request = input && typeof input === 'object' ? input : {};
  const safe = { channel, contractVersion: request.contractVersion, requestId: request.requestId };
  log({ event: 'public-invoke', ...safe });
  try {
    const result = await handler(event, input);
    const summary = { event: 'public-result', ...safe, ok: result?.ok, code: result?.error?.code };
    if (channel === 'app:handshake') summary.capabilities = result?.data?.capabilities;
    const task = result?.data?.task;
    if (task && typeof task === 'object') summary.task = { taskId: task.taskId, kind: task.kind, state: task.execution?.state, revision: task.execution?.revision };
    const game = result?.data?.session;
    if (game && typeof game === 'object') summary.session = { sessionId: game.sessionId, instanceId: game.instanceId, state: game.state, revision: game.revision, exitCode: game.exitCode };
    // No payloads, local paths, account names, arbitrary child output or tokens are logged.
    log(summary); return result;
  } catch (error) { log({ event: 'public-rejected', ...safe, errorName: error?.name }); throw error; }
});
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let origin = 'unparsed'; try { origin = new URL(details.url).origin; } catch {}
    log({ event: 'network-observed', origin, resourceType: details.resourceType });
    callback({});
  });
});
app.on('window-all-closed', () => log({ event: 'windows-closed' }));
app.on('will-quit', () => log({ event: 'will-quit' }));
log({ event: 'harness-preflight', manifestFiles: verified.length, preparedInstances: prepared.instances.map(item => item.instanceId) });
app.on('browser-window-created', (_event, window) => { window.once('ready-to-show', () => { window.unmaximize(); window.setBounds({x:100,y:100,width:1180,height:820}); }); });
require(path.join(product, 'main/index.cjs'));
