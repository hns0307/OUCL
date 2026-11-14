import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const base = path.dirname(fileURLToPath(import.meta.url)); const repository = path.resolve(base, '../..');
try { await access(path.join(base, 'seed.json')); throw new Error('ALREADY_PREPARED'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await cp(path.join(repository, 'dist'), path.join(base, 'product'), { recursive: true, force: false, errorOnExist: true });
const exports = {
  createDesktopFetch: 'main/network', LoaderInstallMetadataService: 'services/loaders/install-metadata', parseLoaderProfile: 'core/loaders/metadata', StorageClient: 'services/workers/storage-client', InstallerService: 'services/install/installer',
  restoreInstallMetadata: 'services/install/installer', InstallerAdapter: 'ipc/installer-adapter',
  CatalogService: 'services/catalog/service', InstallMetadataService: 'services/catalog/install-metadata',
  ModTaskService: 'services/mods/tasks', ModArchiveReader: 'services/workers/mod-archive-reader',
  InstalledLanguageReader: 'services/mods/languages', InstalledJavaFacts: 'services/mods/java-facts',
  ProfileService: 'services/launch/profiles', modInventoryContext: 'services/mods/context',
  ModInventoryService: 'services/mods/inventory', ModInspectionService: 'services/mods/inspection',
  ModrinthModClient: 'services/mods/modrinth', instanceGameLayout: 'services/install/instance-files',
};
await build({ absWorkingDir: repository, stdin: { resolveDir: repository, contents: Object.entries(exports)
  .map(([name, file]) => `export {${name}} from './src/${file}.ts';`).join('\n')
  + "\nexport {modZip} from './tests/fixtures/mod-zip.ts';" }, bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: path.join(base, 'services.cjs') });
const s = createRequire(import.meta.url)(path.join(base, 'services.cjs'));
const fixture=createRequire(import.meta.url)('./fixtures.cjs'); const cases=fixture.prepare(s,base);
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const profile = path.join(base, 'profile'), games = path.join(base, 'synthetic-games');
await mkdir(path.join(profile, 'metadata'), { recursive: true }); await mkdir(games, { recursive: true });
const rootId = '50000000-0000-4000-8000-000000000001';
const clientBytes = Buffer.from('SYNTHETIC NON EXECUTABLE CLIENT - GLOBAL TASK ACCEPTANCE ONLY');
const clientUrl = `https://piston-data.mojang.com/v1/objects/${sha1(clientBytes)}/client.jar`;
const indexBody = JSON.stringify({ objects: {} });
const indexUrl = `https://piston-meta.mojang.com/v1/packages/${sha1(indexBody)}/synthetic-global.json`;
const descriptor = JSON.stringify({ id: '1.20.1', type: 'release', mainClass: 'net.minecraft.client.main.Main',
  downloads: { client: { url: clientUrl, sha1: sha1(clientBytes), size: clientBytes.length } },
  javaVersion: { majorVersion: 17 }, assetIndex: { id: 'synthetic-global', url: indexUrl, sha1: sha1(indexBody), size: Buffer.byteLength(indexBody) },
  libraries: [], arguments: { game: [], jvm: [] } });
const descriptorUrl = `https://piston-meta.mojang.com/v1/packages/${sha1(descriptor)}/1.20.1.json`;
const manifest = JSON.stringify({ versions: [{ id: '1.20.1', type: 'release', url: descriptorUrl, sha1: sha1(descriptor),
  time: '2026-01-01T00:00:00+00:00', releaseTime: '2026-01-01T00:00:00+00:00' }] });
const metadataRequests = [], transferRequests = [];
const reader = { async read(url, expected) {
  metadataRequests.push(url);
  const body = url === descriptorUrl ? descriptor : url === indexUrl ? indexBody : /version_manifest_v2\.json$/.test(url) ? manifest : null;
  assert.notEqual(body, null, `unexpected metadata URL ${url}`); if (expected) assert.equal(sha1(body), expected);
  return { body, sha1: sha1(body), sha256: createHash('sha256').update(body).digest('hex') };
} };
const transport = async (input, options) => {
  const url = String(input); transferRequests.push(url); assert.equal(url, clientUrl);
  options?.signal?.throwIfAborted(); return new Response(new Uint8Array(clientBytes), { headers: { 'content-length': String(clientBytes.length) } });
};
const worker = path.join(base, 'product/workers/entry.cjs');
const loaderValue={id:'fabric-loader-0.16.14-1.20.1',inheritsFrom:'1.20.1',mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient',arguments:{game:[],jvm:[]},libraries:[{name:'net.fabricmc:fabric-loader:0.16.14',url:'https://maven.fabricmc.net/'}]};
const loaderBody=JSON.stringify(loaderValue),loaderBytes=Buffer.from('synthetic non executable loader');
const loaderUrl='https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.14/fabric-loader-0.16.14.jar';
const createInstaller=storage=>{const vanilla=new s.InstallMetadataService(new s.CatalogService(reader,storage),reader);
 const loader=new s.LoaderInstallMetadataService(vanilla,{profile:async()=>({profile:s.parseLoaderProfile('fabric','1.20.1','0.16.14',loaderValue),body:loaderBody,evidence:{sourceUrl:'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.16.14/profile/json',sha256:createHash('sha256').update(loaderBody).digest('hex')}})},
 {plan:async()=>({totalBytes:loaderBytes.length,libraries:[{path:'net/fabricmc/fabric-loader/0.16.14/fabric-loader-0.16.14.jar',spec:{url:loaderUrl,expected:{algorithm:'sha1',digest:sha1(loaderBytes),size:loaderBytes.length,provenanceId:'loader:fabric:'+sha1(loaderBytes)},anchor:{kind:'loader-maven',algorithm:'sha256',digest:'f'.repeat(64)}}}]})});
 return new s.InstallerService(storage,worker,vanilla,loader,undefined,undefined,undefined,async(input,options)=>String(input)===loaderUrl?new Response(new Uint8Array(loaderBytes),{headers:{'content-length':String(loaderBytes.length)}}):transport(input,options));};
const createMods = storage => {
  const profiles = new s.ProfileService(storage), scanner = new s.ModArchiveReader(worker);
  const context = s.modInventoryContext(storage, new s.InstalledLanguageReader(scanner), new s.InstalledJavaFacts(profiles));
  const inventory = new s.ModInventoryService(context, scanner);
  const inspections = new s.ModInspectionService(context, inventory, new s.ModrinthModClient(fixture.fetch(s,base)));
  return { profiles, service: new s.ModTaskService(storage, inventory, inspections) };
};
async function verifyGlobal(storage, installer, mods) {
  const adapter = new s.InstallerAdapter(installer, storage, {
    get: (root, id) => mods.get(root, id), list: root => mods.list(root), cancel: (root, id) => mods.cancel(root, id),
  });
  try {
    const data = await adapter.dispatcher(1, () => {})('tasks:list', { limit: 100 }, randomUUID());
    assert.equal(data.nextCursor, undefined); assert.equal(data.items.length, 4);
    assert.equal(data.items.filter(task => task.kind === 'install').length, 2);
    assert.equal(data.items.filter(task => task.kind === 'mod-check').length, 2);
    assert.ok(data.items.every(task => task.state === 'completed'));
    return data;
  } finally { adapter.close(); }
}
const storage = await s.StorageClient.open(worker, path.join(profile, 'metadata'));
const installer = createInstaller(storage), mods = createMods(storage); const instances = []; let initialGlobal;
try {
  await storage.createInstallation({ rootId, dataDirectory: games }); await installer.initialize();
  for (const suffix of ['A', 'B']) {
    const displayName = `R6-${suffix} Synthetic Fabric`;
    const accepted = await installer.createLoader(randomUUID(), { rootId, mcVersionId: '1.20.1', displayName, isolation: 'on',loader:{kind:'fabric',version:'0.16.14'} });
    const deadline = Date.now() + 30000; let completed;
    while (Date.now() < deadline) {
      const current = await installer.task(rootId, accepted.taskId);
      if (['completed','failed','cancelled','needsRecovery'].includes(current.task.execution.state)) { completed = current; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(completed?.task.execution.state, 'completed'); assert.equal(completed.instance?.state, 'ready');
    const instanceId = completed.instance.instanceId, record = await storage.readInstance(instanceId);
    const layout = s.instanceGameLayout(games, record.data.summary, s.restoreInstallMetadata(record.data));
    const modsDirectory = path.join(layout.gameDirectory, 'mods'); await mkdir(modsDirectory, { recursive: true });
    const caseInfo=cases[suffix==='A'?0:1]; const filename='provider.jar';
    for(const jar of ['provider.jar','dependent.jar'])await writeFile(path.join(modsDirectory,jar),await readFile(path.join(caseInfo.location,jar)));
    instances.push({ instanceId, displayName, installTaskId: accepted.taskId, filename });
  }
  await mods.service.initialize();
  for (const item of instances) {
    const record = await storage.readInstance(item.instanceId);
    const accepted = await mods.service.start(randomUUID(), 'check', { instanceId: item.instanceId, expectedRevision: record.revision });
    item.modTaskId = accepted.taskId;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const current = await mods.service.get(rootId, accepted.taskId);
      if (current?.snapshot.state === 'completed') break;
      assert.ok(!current || !['failed','cancelled','needsRecovery'].includes(current.snapshot.state));
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const report = await mods.service.report(accepted.taskId); assert.ok(report.report); item.report = report.report;
  }
  initialGlobal = await verifyGlobal(storage, installer, mods.service);
} finally { await mods.service.close(); await mods.profiles.close(); await installer.close(); await storage.close(); }
const reopened = await s.StorageClient.open(worker, path.join(profile, 'metadata'));
const restoredInstaller = createInstaller(reopened), restoredMods = createMods(reopened); let reopenedGlobal;
try {
  await restoredInstaller.initialize(); await restoredMods.service.initialize();
  reopenedGlobal = await verifyGlobal(reopened, restoredInstaller, restoredMods.service);
  assert.deepEqual(reopenedGlobal.items.map(task => task.taskId).sort(), initialGlobal.items.map(task => task.taskId).sort());
  for (const item of instances) assert.ok((await restoredMods.service.report(item.modTaskId)).report);
} finally { await restoredMods.service.close(); await restoredMods.profiles.close(); await restoredInstaller.close(); await reopened.close(); }
const expectedManifest = JSON.parse(await readFile(path.join(base, 'expected-product-manifest.json'), 'utf8'));
for (const item of expectedManifest) assert.equal(createHash('sha256').update(await readFile(path.join(base, 'product', item.path))).digest('hex'), item.sha256);
await writeFile(path.join(base, 'product-manifest.json'), JSON.stringify(expectedManifest, null, 2));
await writeFile(path.join(base, 'seed.json'), JSON.stringify({ synthetic: true, profile, games, rootId, cases, instances,
  initialGlobal, reopenedGlobal, metadataRequests: metadataRequests.length, transferRequests: transferRequests.length,
  limitation: 'Formal installation effects on synthetic pinned local metadata/bytes; no real upstream client/Java/game or platform known-source evidence.' }, null, 2));
console.log(JSON.stringify({ status: 'PREPARED', profile, instances: instances.map(({ instanceId, displayName, installTaskId, modTaskId }) => ({ instanceId, displayName, installTaskId, modTaskId })),
  globalBefore: initialGlobal.items.map(task => ({ taskId: task.taskId, kind: task.kind, state: task.state })), reopen: 'PASS', productHashes: '7 MATCH' }, null, 2));
