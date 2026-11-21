import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { handleWebExtensions } from '../src/ipc/web-extensions.js';
import { MAX_WEB_DOWNLOAD_BYTES } from '../src/shared/contracts/web-extensions.js';
import { classifyWebFile, inspectWebFile } from '../src/services/web/classify.js';
import { WebDownloads } from '../src/services/web/downloads.js';
import type { BrowserDownloadItem } from '../src/services/web/downloads.js';
import { WebImports } from '../src/services/web/imports.js';
import { BrowserDnsScreen, downloadName, publicResolvedAddress, visibleUrl, websiteUrl } from '../src/services/web/policy.js';
import { instanceGameLayout } from '../src/services/install/instance-files.js';
import { restoreInstallMetadata } from '../src/services/install/installer.js';
import { hasCode } from '../src/services/storage/files.js';
import { modZip } from './fixtures/mod-zip.js';
import { modReadyInstance } from './fixtures/mod-ready-instance.js';

test('Web addresses require public HTTPS DNS names and do not persist query or fragment', () => {
  assert.equal(websiteUrl('example.com/view?state=secret#token', true)?.href, 'https://example.com/view?state=secret#token');
  assert.equal(visibleUrl(websiteUrl('https://example.com/view?state=secret#token')!), 'https://example.com/view');
  for (const url of ['http://example.com', 'file:///C:/Users', 'https://user@example.com', 'https://127.1', 'https://[::1]',
    'https://app.local', 'https://127.0.0.1.nip.io:10001', 'https://example.com\\server', 'https://example.com./']) {
    assert.equal(websiteUrl(url, true), undefined, url);
  }
  assert.equal(downloadName('../danger:name.jar'), '.._danger_name.jar');
  assert.equal(downloadName('CON.txt'), 'download.bin');
});

test('DNS screening rejects local, shared and mixed IP results with a coalesced lookup', async () => {
  for (const address of ['127.0.0.1', '100.64.0.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:192.168.0.1', '2001:db8::1']) {
    assert.equal(publicResolvedAddress(address), false, address);
  }
  assert.equal(publicResolvedAddress('1.1.1.1'), true);
  assert.equal(publicResolvedAddress('2606:4700::1111'), true);
  let requests = 0;
  const guard = new BrowserDnsScreen(async () => { requests++; return ['1.1.1.1', '127.0.0.1']; });
  assert.deepEqual(await Promise.all([guard.check('example.com'), guard.check('example.com')]), [false, false]);
  assert.equal(requests, 1);
});

test('web IPC refuses cross-document actions and never forwards unknown payload keys', async () => {
  const requestId = randomUUID();
  let evaluations = 0;
  const resolve = async () => {
    evaluations++;
    return { run: async () => ({ revision: 1, activeId: null, tabs: [], downloads: [], bookmarks: [], popup: null, packImport: false }) };
  };
  const envelope = { contractVersion: 1, requestId, action: { kind: 'state' } };
  assert.deepEqual(await handleWebExtensions(envelope, () => false, resolve),
    { contractVersion: 1, requestId, ok: false, error: 'INVALID_SENDER' });
  assert.deepEqual(await handleWebExtensions({ ...envelope, action: { kind: 'state', filename: 'unsafe' } }, () => true, resolve),
    { contractVersion: 1, requestId, ok: false, error: 'INVALID_ARGUMENT' });
  assert.equal(evaluations, 0);
  assert.equal((await handleWebExtensions(envelope, () => true, resolve)).ok, true);
  assert.equal(evaluations, 1);
});

test('fixed sample is recognized by content and malformed Java archives cannot reach import', async () => {
  const root = process.env.OUCL_SOURCE_ROOT ?? process.cwd();
  const original = await readFile(path.join(root, 'docs/work-packages/P-E/sample/OUCL-PE-Forge-Smoke-1.0.0.mrpack'));
  const result = classifyWebFile('example.mrpack', original);
  assert.equal(result.kind, 'modpack');
  assert.equal(result.packPreview?.minecraft, '1.20.1');
  assert.equal(result.packPreview?.overrides, 2);
  assert.deepEqual(classifyWebFile('example.jar', Buffer.from('not a zip')), { kind: 'unknown', archiveRejected: true });
});

class TestItem implements BrowserDownloadItem {
  path = '';
  paused = false;
  resumed = false;
  ended: (state: string) => void = () => {};
  constructor(private readonly url = 'https://example.com/test.zip', private readonly bytes = 3) {}
  getURLChain(): string[] { return [this.url]; }
  getURL(): string { return this.url; }
  getTotalBytes(): number { return this.bytes; }
  getFilename(): string { return '../test.zip'; }
  getReceivedBytes(): number { return this.bytes; }
  setSavePath(filename: string): void { this.path = filename; }
  pause(): void { this.paused = true; }
  resume(): void { this.resumed = true; }
  onDone(listener: (state: string) => void): void { this.ended = listener; }
  cancel(): void { this.ended('cancelled'); }
  onUpdated(): void {}
}

test('download admission rejects forbidden URL and size, then stages pending user-confirmed bytes', async () => {
  const directory = await mkdtemp(path.join(process.env.OUCL_SOURCE_ROOT ?? process.cwd(), '.oucl-web-download-'));
  const manager = new WebDownloads(directory, { read: async () => undefined }, new WebImports({}), () => {});
  try {
    assert.equal(manager.admit(new TestItem('file:///test.zip')), false);
    assert.equal(manager.admit(new TestItem('https://example.com/test.zip', MAX_WEB_DOWNLOAD_BYTES + 1)), false);
    const item = new TestItem();
    assert.equal(manager.admit(item), true);
    const id = manager.snapshots()[0]!.id;
    assert.equal(item.paused, true); assert.equal(item.resumed, false);
    assert.equal(manager.snapshots()[0]!.status, 'confirmation');
    manager.confirm(id);
    assert.equal(item.resumed, true);
    assert.equal(path.dirname(item.path), directory);
    assert.match(path.basename(item.path), /^[0-9a-f-]{36}\.bin$/);
    await writeFile(item.path, 'zip'); item.ended('completed');
    for (let attempt = 0; attempt < 20 && manager.snapshots()[0]!.status !== 'ready'; attempt++) await delay(20);
    assert.equal(manager.snapshots()[0]!.status, 'ready');
    assert.equal(manager.snapshots()[0]!.filename, '.._test.zip');
  } finally { await manager.close(); }
});

test('resourcepack import obeys the game lease and cannot replace existing bytes', async t => {
  const workspace = path.resolve(process.env.OUCL_SOURCE_ROOT ?? process.cwd());
  const directory = await mkdtemp(path.join(workspace, '.oucl-web-addon-'));
  t.after(async () => {
    if (path.dirname(path.resolve(directory)) === workspace && path.basename(directory).startsWith('.oucl-web-addon-')) {
      await rm(directory, { recursive: true, force: true });
    }
  });
  const rootId = randomUUID(); const instanceId = randomUUID();
  const instance = modReadyInstance(rootId, instanceId);
  const sha1 = createHash('sha1').update(instance.metadata!.assetIndexBody).digest('hex');
  instance.receipts!.push({ area: 'assets', path: 'indexes/5.json', artifactId: `sha1-${sha1}`, mode: 'copy' });
  const gameDir = instanceGameLayout(directory, instance.summary, restoreInstallMetadata(instance)).gameDirectory;
  await mkdir(gameDir, { recursive: true });
  const file = path.join(directory, 'test.zip');
  const bytes = modZip([['pack.mcmeta', JSON.stringify({ pack: { pack_format: 15, description: 'fixture' } })],
    ['assets/minecraft/lang/en_us.json', '{}']]);
  await writeFile(file, bytes);
  const proof = await inspectWebFile(file, 'test.zip');
  assert.equal(proof.kind, 'resourcepack');
  const importer = new WebImports({ storage: {
    async readInstallation() { return { schemaVersion: 1, revision: 1, data: { rootId, dataDirectory: directory } }; },
    async readInstance() { return { schemaVersion: 1, revision: 1, data: instance }; },
    async readGameSessions() { return undefined; },
  } });
  const source = { file, filename: 'test.zip', proof };
  const lock = path.join(gameDir, 'oucl.session.lock');
  await writeFile(lock, randomUUID());
  await assert.rejects(importer.installAddon(source, instanceId, 1, () => true), { code: 'INSTANCE_BUSY' });
  await unlink(lock);
  await assert.rejects(importer.installAddon(source, instanceId, 2, () => true), { code: 'INSTANCE_CHANGED' });
  const probe = path.join(gameDir, 'resourcepacks', 'link-probe');
  await mkdir(path.dirname(probe));
  try { await link(file, probe); await unlink(probe); }
  catch (error) {
    if (!['EACCES', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].some(code => hasCode(error, code))) throw error;
    t.skip('workspace cannot create a hard link');
    return;
  }
  await importer.installAddon(source, instanceId, 1, () => true);
  const installed = path.join(gameDir, 'resourcepacks', source.filename);
  assert.deepEqual(await readFile(installed), bytes);
  await assert.rejects(importer.installAddon(source, instanceId, 1, () => true), { code: 'FILE_EXISTS' });
  assert.deepEqual(await readFile(installed), bytes);
  await assert.rejects(readFile(lock), { code: 'ENOENT' });
});
