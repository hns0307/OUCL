import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { createRequire } from 'node:module';
import { StorageClient } from '../../src/services/workers/storage-client.js';
import { ProfileService } from '../../src/services/launch/profiles.js';

const root = process.argv[2]; const entry = process.argv[3]; const main = process.argv[4];
const javaExecutable = process.argv[5];
assert.ok(root && path.isAbsolute(root) && path.basename(root).startsWith('oucl-install-window-') && entry && path.isAbsolute(entry) && main && path.isAbsolute(main));
const rootId = '00000000-0000-4000-8000-000000000001';
app.setPath('userData', path.join(root, 'profile'));
app.disableHardwareAcceleration();
const originalFetch = globalThis.fetch;
let artifactRequests = 0; let metadataRequests = 0; let stage = 'initialize';
const sha1 = (body: Buffer | string): string => createHash('sha1').update(body).digest('hex');
function nativeArchive(): Buffer {
  const name = Buffer.from('native.dll'); const bytes = Buffer.from('non executable native window fixture'); const checksum = crc32(bytes);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + bytes.length, 16);
  return Buffer.concat([local, name, bytes, central, name, end]);
}
const bodies = new Map<string, Buffer>();
function artifact(name: string, bytes: Buffer) {
  const url = `https://libraries.minecraft.net/window-fixture/${name}.jar`; bodies.set(url, bytes);
  return { url, sha1: sha1(bytes), size: bytes.length };
}
const client = artifact('client', Buffer.from('non executable client window fixture'));
const library = artifact('library', Buffer.from('library window fixture'));
const native = artifact('library-natives-windows', nativeArchive());
const resource = Buffer.from('asset window fixture'); const assetHash = sha1(resource);
bodies.set(`https://resources.download.minecraft.net/${assetHash.slice(0, 2)}/${assetHash}`, resource);
const indexBody = JSON.stringify({ objects: { 'minecraft/sound.ogg': { hash: assetHash, size: resource.length } } }, null, 2);
const indexHash = sha1(indexBody); const indexUrl = `https://piston-meta.mojang.com/v1/packages/${indexHash}/window-fixture.json`;
const descriptor = JSON.stringify({ id: 'window-fixture', mainClass: 'net.minecraft.client.main.Main', type: 'release', downloads: { client },
  javaVersion: { majorVersion: 17 }, assetIndex: { id: 'window-fixture', url: indexUrl, sha1: indexHash, size: Buffer.byteLength(indexBody) },
  libraries: [{ name: 'org.example:library:1', downloads: { artifact: library, classifiers: { 'natives-windows': native } }, natives: { windows: 'natives-windows' } }],
  arguments: { game: ['--username', '${auth_player_name}', '--gameDir', '${game_directory}'], jvm: ['-cp', '${classpath}', '-Djava.library.path=${natives_directory}'] } });
const descriptorHash = sha1(descriptor); const descriptorUrl = `https://piston-meta.mojang.com/v1/packages/${descriptorHash}/window-fixture.json`;
const metadata = new Map<string, string>([[indexUrl, indexBody], [descriptorUrl, descriptor],
  ['https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', JSON.stringify({ versions: [{ id: 'window-fixture', type: 'release', url: descriptorUrl,
    sha1: descriptorHash, time: '2026-01-01T00:00:00+00:00', releaseTime: '2026-01-01T00:00:00+00:00' }] })]]);
globalThis.fetch = async (input, options) => {
  const url = String(input); const document = metadata.get(url); const bytes = document === undefined ? bodies.get(url) : Buffer.from(document);
  assert.ok(bytes, 'UNEXPECTED_FIXTURE_REQUEST');
  if (document === undefined) artifactRequests++; else metadataRequests++;
  if (options?.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  return new Response(new Uint8Array(bytes), { headers: { 'content-length': String(bytes.length), 'content-type': document === undefined ? 'application/octet-stream' : 'application/json' } });
};
async function waitFor(window: BrowserWindow, condition: string): Promise<void> {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (await window.webContents.executeJavaScript(`Boolean(${condition})`)) return;
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
  throw new Error('WINDOW_CONDITION_TIMEOUT');
}
async function verify(window: BrowserWindow): Promise<void> {
  const hide = (): void => { window.hide(); };
  window.on('show', hide); window.hide(); window.setSize(1160, 900); window.webContents.setBackgroundThrottling(false);
  await new Promise<void>(resolve => { window.webContents.once('did-finish-load', () => { resolve(); }); });
  stage = 'window-ready';
  await waitFor(window, `document.querySelector('[data-status="connected"]') && document.querySelector('.registered-root') && document.querySelector('.version-select')`);
  // Electron exposes this diagnostic at runtime but omits it from the public WebContents declaration.
  const preferences = (window.webContents as unknown as { getLastWebPreferences(): { contextIsolation?: boolean; sandbox?: boolean; nodeIntegration?: boolean } }).getLastWebPreferences();
  assert.equal(preferences.contextIsolation, true); assert.equal(preferences.sandbox, true); assert.equal(preferences.nodeIntegration, false);
  assert.deepEqual(await window.webContents.executeJavaScript(`({require:typeof window.require,process:typeof window.process})`), { require: 'undefined', process: 'undefined' });
  await window.webContents.executeJavaScript(`document.querySelector('.version-select').click()`);
  await waitFor(window, `document.querySelector('.install-confirm button.primary') && !document.querySelector('.install-confirm button.primary').disabled`);
  stage = 'first-install'; await window.webContents.executeJavaScript(`document.querySelector('.install-confirm button.primary').click()`);
  await waitFor(window, `document.querySelectorAll('li[data-instance-state="ready"]').length === 1 && document.querySelectorAll('[data-task-state="completed"]').length === 1`);
  assert.equal(artifactRequests, 4);
  let realJavaExitObserved = false;
  if (javaExecutable) {
    stage = 'launch-from-dom';
    await waitFor(window, `document.querySelector('.launch-controls button.primary') && !document.querySelector('.launch-controls button.primary').disabled`);
    await window.webContents.executeJavaScript(`document.querySelector('.launch-controls button.primary').click()`);
    await waitFor(window, `document.querySelector('.launch-controls[data-game-state="exited"]')`);
    const sessions: unknown = await window.webContents.executeJavaScript(`window.oucl.listSessions({limit:100})`);
    assert.ok(typeof sessions === 'object' && sessions !== null && 'ok' in sessions && sessions.ok === true && 'data' in sessions);
    const result = sessions as { data: { items: { exitCode?: number; state: string }[] } };
    assert.equal(result.data.items.length, 1); assert.equal(result.data.items[0]?.state, 'exited'); assert.equal(result.data.items[0]?.exitCode, 1);
    // These fixture JARs are text. The trusted JVM exits for missing Main; this is not a Minecraft success claim.
    realJavaExitObserved = true;
  }
  stage = 'cache-reuse';
  await window.webContents.executeJavaScript(`(() => { const field=document.querySelector('.install-confirm input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'Second window fixture'); field.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(window, `!document.querySelector('.install-confirm button.primary').disabled`);
  await window.webContents.executeJavaScript(`document.querySelector('.install-confirm button.primary').click()`);
  await waitFor(window, `document.querySelectorAll('li[data-instance-state="ready"]').length === 2 && document.querySelectorAll('[data-task-state="completed"]').length === 2`);
  assert.equal(artifactRequests, 4);
  const instanceIds: unknown = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('li[data-instance-state="ready"]'), node => node.dataset.instanceId)`);
  assert.ok(Array.isArray(instanceIds) && instanceIds.length === 2);
  for (const instanceId of instanceIds) {
    assert.ok(typeof instanceId === 'string' && /^[a-f0-9-]{36}$/.test(instanceId));
    const directory = path.join(root!, 'games', 'roots', rootId, '.minecraft', 'versions', instanceId);
    assert.equal(await readFile(path.join(directory, `${instanceId}.jar`), 'utf8'), 'non executable client window fixture');
    assert.equal(await readFile(path.join(directory, 'natives', 'native.dll'), 'utf8'), 'non executable native window fixture');
    const record: unknown = JSON.parse(await readFile(path.join(directory, 'oucl.instance.json'), 'utf8'));
    assert.ok(typeof record === 'object' && record !== null && 'data' in record);
  }
  stage = 'reload';
  await new Promise<void>(resolve => { window.webContents.once('did-finish-load', () => { resolve(); }); window.reload(); });
  await waitFor(window, `document.querySelector('[data-status="connected"]') && document.querySelectorAll('li[data-instance-state="ready"]').length === 2 && document.querySelectorAll('[data-task-state="completed"]').length === 2`);
  assert.equal(artifactRequests, 4);
  stage = 'screenshot';
  // Windows needs a compositor surface after reload; keep this nonactivating surface fully transparent.
  window.removeListener('show', hide); window.setOpacity(0); window.showInactive();
  window.webContents.invalidate(); await new Promise<void>(resolve => setTimeout(resolve, 250));
  await writeFile(path.join(root!, 'installer-window.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  window.hide();
  const report = { status: 'PASS', fixture: true, gameLaunched: false, packagedPayload: false, nativePickerSelected: false,
    rootPreRegistered: true, actualMainPreloadRenderer: true, actualMetadataAndArtifactServices: true, actualDomInstallClicks: 2,
    readyInstances: 2, completedTasks: 2, artifactRequests, metadataRequests, cacheReused: true, reloadPreservedInstancesAndTasks: true,
    clientNativeAndManifestVerified: true, contextIsolation: true, sandbox: true, rendererNodeAbsent: true,
    launchButtonClicked: Boolean(javaExecutable), realJavaExitObserved, expectedMissingMainExitCode: javaExecutable ? 1 : undefined,
    javaPreRegistered: Boolean(javaExecutable), productionJavaPickerOperated: false,
    electron: process.versions.electron, node: process.versions.node };
  process.stdout.write(`OUCL_INSTALL_WINDOW_RESULT:${JSON.stringify(report)}\n`);
  globalThis.fetch = originalFetch; window.destroy(); app.quit();
}
let complete = false;
const deadline = setTimeout(() => { if (!complete) { process.stdout.write(`OUCL_INSTALL_WINDOW_RESULT:${JSON.stringify({ status: 'FAIL', code: 'RUNTIME_TIMEOUT', stage, fixture: true, gameLaunched: false })}\n`); app.exit(1); } }, 30000);
app.once('will-quit', () => { complete = true; clearTimeout(deadline); });
void app.whenReady().then(async () => {
  const directory = path.join(root!, 'profile', 'metadata'); await mkdir(directory, { recursive: true }); await mkdir(path.join(root!, 'games'));
  const storage = await StorageClient.open(entry!, directory);
  try {
    await storage.createInstallation({ rootId, dataDirectory: path.join(root!, 'games') });
    if (javaExecutable) { assert.ok(path.isAbsolute(javaExecutable)); const profiles = new ProfileService(storage); await profiles.registerJava(javaExecutable); await profiles.createOffline('00000000-0000-4000-8000-000000000017', { displayName: 'Window fixture', gameName: 'OUCL_Fixture' }); await profiles.close(); }
  } finally { await storage.close(); }
  app.once('browser-window-created', (_event, window) => { void verify(window).catch(error => {
    const failureType = error instanceof Error && ['Error', 'TypeError', 'AssertionError'].includes(error.name) ? error.name : 'UNKNOWN';
    process.stdout.write(`OUCL_INSTALL_WINDOW_RESULT:${JSON.stringify({ status: 'FAIL', code: 'WINDOW_VERIFICATION_FAILED', stage, failureType, fixture: true, gameLaunched: false, artifactRequests, metadataRequests })}\n`);
    globalThis.fetch = originalFetch; process.exitCode = 1; window.destroy(); app.quit();
  }); });
  createRequire(main!)(main!);
}).catch(() => {
  process.stdout.write(`OUCL_INSTALL_WINDOW_RESULT:${JSON.stringify({ status: 'FAIL', code: 'RUNTIME_INITIALIZATION_FAILED', stage, fixture: true, gameLaunched: false })}\n`); app.exit(1);
});
