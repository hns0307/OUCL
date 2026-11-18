const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { app, BrowserWindow, webContents } = require('electron');
const { createElectronOnlineToolService } = require(process.env.OUCL_N5_CDN_ADAPTER);

const documentOrigin = 'https://tools.example.com';
const resourceOrigin = 'https://cdn.example.com';
const url = {
  start: documentOrigin + '/start',
  asset: resourceOrigin + '/fixture.js',
  redirectSame: documentOrigin + '/redirect-same',
  landed: documentOrigin + '/landed',
  redirectOther: documentOrigin + '/redirect-other',
  cdnRedirectTarget: resourceOrigin + '/redirect-target',
  cdnLinkTarget: resourceOrigin + '/link-target',
};
const checks = [];
const requests = [];
const events = [];
const fixtureDocument = (marker) => `<!doctype html><meta charset="utf-8"><title>${marker}</title>
  <script src="${url.asset}"></script>
  <a id="same" href="${url.redirectSame}">Same-origin redirect</a>
  <a id="other" href="${url.redirectOther}">Cross-origin redirect</a>
  <a id="cdn" href="${url.cdnLinkTarget}">CDN top-level navigation</a>`;
function response(request) {
  requests.push({ url: request.url, method: request.method });
  switch (request.url) {
    case url.asset:
      return new Response('window.fixtureCdnResource = "loaded";', { headers: { 'content-type': 'text/javascript' } });
    case url.start:
    case url.landed:
      return new Response(fixtureDocument(request.url === url.start ? 'start' : 'landed'), { headers: { 'content-type': 'text/html' } });
    case url.redirectSame:
      return new Response(null, { status: 302, headers: { location: url.landed } });
    case url.redirectOther:
      return new Response(null, { status: 302, headers: { location: url.cdnRedirectTarget } });
    default:
      return new Response(null, { status: 404 });
  }
}

function record(name, passed, details) {
  checks.push({ name, pass: Boolean(passed), details });
  assert.ok(passed, name);
}
function writeResult(status, error) {
  writeFileSync(process.env.OUCL_N5_CDN_RESULT, JSON.stringify({
    status, electron: process.versions.electron, transport: 'synthetic HTTP and HTTPS protocol handlers, no sockets or real TLS',
    chromiumEvents: 'observed from real link clicks and synthetic HTTP response 302; no manual event emission',
    checks, events, requests, ...(error ? { error: String(error.stack ?? error) } : {}),
  }, null, 2) + '\n');
}
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function awaitEvent(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return true;
    await wait(25);
  }
  return false;
}
const seenRequest = value => requests.some(request => request.url === value && request.method === 'GET');
const seenEvent = (name, value) => events.some(event => event.name === name && event.url === value);
let owner;
let service;
const deadline = setTimeout(() => { writeResult('TIMEOUT'); app.exit(2); }, 30000);
app.setPath('userData', process.env.OUCL_N5_CDN_PROFILE);
app.disableHardwareAcceleration();
app.on('session-created', isolated => {
  isolated.protocol.handle('https', response);
  isolated.protocol.handle('http', response);
});

app.whenReady().then(async () => {
  owner = new BrowserWindow({ show: false, width: 1080, height: 720,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  service = createElectronOnlineToolService(owner, [{
    toolId: 'synthetic', title: 'Synthetic CDN separation', entryUrl: url.start, documentOrigin, resourceOrigins: [resourceOrigin],
  }]);
  const opened = await service.open('synthetic');
  const remote = webContents.getAllWebContents().find(item => item !== owner.webContents);
  record('isolated product adapter opened the synthetic document', opened.phase === 'ready' && remote?.getURL() === url.start, { phase: opened.phase, finalUrl: remote?.getURL() });
  for (const name of ['will-redirect', 'will-navigate', 'will-frame-navigate']) {
    remote.on(name, event => { events.push({ name, url: event.url, isMainFrame: event.isMainFrame }); });
  }
  const cdnMarker = await remote.executeJavaScript('window.fixtureCdnResource');
  record('listed distinct HTTPS CDN loaded and executed as a subresource', cdnMarker === 'loaded' && seenRequest(url.asset), { cdnMarker, served: seenRequest(url.asset) });
  const click = id => remote.executeJavaScript(`document.querySelector("#${id}").click(); void 0`, true);
  await click('same');
  const landed = await awaitEvent(() => seenRequest(url.landed) && remote.getURL() === url.landed);
  record('actual same-origin HTTP 302 reaches the allowed document',
    landed && seenRequest(url.redirectSame) && seenEvent('will-redirect', url.landed),
    { initialServed: seenRequest(url.redirectSame), destinationServed: seenRequest(url.landed), finalUrl: remote.getURL() });

  await click('other');
  const redirectAttempt = await awaitEvent(() => seenEvent('will-redirect', url.cdnRedirectTarget));
  await wait(100);
  record('actual HTTP 302 cannot promote the listed CDN into a main document',
    redirectAttempt && seenRequest(url.redirectOther) && !seenRequest(url.cdnRedirectTarget) && remote.getURL() === url.landed,
    { redirectAttempt, initialServed: seenRequest(url.redirectOther), targetServed: seenRequest(url.cdnRedirectTarget), finalUrl: remote.getURL() });

  await click('cdn');
  const directAttempt = await awaitEvent(() => seenEvent('will-frame-navigate', url.cdnLinkTarget) || seenEvent('will-navigate', url.cdnLinkTarget));
  await wait(100);
  record('clicking a CDN top-level link is blocked before delivery',
    directAttempt && !seenRequest(url.cdnLinkTarget) && remote.getURL() === url.landed,
    { directAttempt, targetServed: seenRequest(url.cdnLinkTarget), finalUrl: remote.getURL() });

  await service.close();
  record('remote contents destroyed and service closed', remote.isDestroyed() && service.state().phase === 'closed', { phase: service.state().phase });
  owner.destroy();
  clearTimeout(deadline);
  writeResult('PASS');
  app.exit(0);
}).catch(async error => {
  console.error(error);
  try { await service?.close(); } catch (closeError) { console.error(closeError); }
  if (owner && !owner.isDestroyed()) owner.destroy();
  clearTimeout(deadline);
  writeResult('FAIL', error);
  app.exit(1);
});
