import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, appendFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordStore } from './compiled/src/services/storage/records.js';
import { parseInstallation } from './compiled/src/services/storage/installation.js';
import { StorageClient } from './compiled/src/services/workers/storage-client.js';
import { ProfileService } from './compiled/src/services/launch/profiles.js';
import { parseLaunchProfiles } from './compiled/src/services/storage/launch-profiles.js';
import { parseInstanceRecord } from './compiled/src/services/storage/instance-records.js';
import { InstallerService, restoreInstallMetadata } from './compiled/src/services/install/installer.js';
import { instanceGameLayout } from './compiled/src/services/install/instance-files.js';
import { matchesLaunchProjection } from './compiled/src/services/install/launch-inputs.js';
import { parseModTransaction } from './compiled/src/services/storage/mod-transactions.js';
import { ObjectStore } from './compiled/src/services/objects/store.js';
import { HashPool } from './compiled/src/services/workers/hash-pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = 'D:/MC_start/OUCL-PA-clone-20261112';
const sourceMetadata = path.join(source, 'OUCL.runtime/profile/metadata');
const target = path.join(here, 'isolated');
const profile = path.join(target, 'profile');
const metadata = path.join(profile, 'metadata');
const dataDirectory = path.join(target, 'games');
const ids = ['24871144-2454-505b-92aa-2741ccb05834', '5297a61f-56b1-5159-a84f-440c49b9ff5b', '34d051d5-22db-58a2-9bf0-e5990b01b87b'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = async file => { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); };
const within = (root, file) => { const relative = path.relative(path.resolve(root), path.resolve(file)); assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'OUTSIDE_APPROVED_BOUNDARY'); };
const manifest = []; const destinations = new Set(); const metadataFacts = [];
const entry = new URL('./compiled/src/services/workers/entry.js', import.meta.url);
async function noFile(file) { try { await access(file); throw new Error(`MUST_NOT_EXIST:${path.basename(file)}`); } catch (e) { if (e.code !== 'ENOENT') throw e; } }

await noFile(path.join(here, 'prepared.json'));
manifest.push(...JSON.parse(await readFile(path.join(here, 'copy-manifest.json'), 'utf8')));
metadataFacts.push(...JSON.parse(await readFile(path.join(here, 'source-metadata.json'), 'utf8')));
for (const fact of metadataFacts) assert.equal(await hash(path.join(sourceMetadata, fact.name)), fact.sha256);
const installation = JSON.parse(await readFile(path.join(metadata, 'installation.json'), 'utf8'));
const rootId = installation.data.rootId; assert.equal(installation.data.dataDirectory, dataDirectory);
const records = [];
for (const id of ids) {
  const e = JSON.parse(await readFile(path.join(metadata, `instance-${id}.json`), 'utf8'));
  records.push({...e,data:parseInstanceRecord(e.data)});
}
const oldProfiles = JSON.parse(await readFile(path.join(sourceMetadata,'launch-profiles.json'),'utf8'));
const selectedJava = oldProfiles.data.javas.find(j => j.javaId === oldProfiles.data.selectedJavaId);
const javaHome = path.join(target,'java17');
const dbEvidence = JSON.parse(await readFile(path.join(here,'snapshot.json'),'utf8'));
const rebuilt = JSON.parse(await readFile(path.join(here,'rebuild.json'),'utf8')).rebuilt;
const storage = await StorageClient.open(entry,metadata,120000);
const profileService = new ProfileService(storage);
const installer = new InstallerService(storage, entry, { prepare() { throw new Error('PREPARATION_NETWORK_DISABLED'); } });
let result;
try {
  const profiles = await storage.readLaunchProfiles();
  const executable = path.join(javaHome, 'bin/java.exe');
  // Drop outside executable candidates only in the target via exact schema/API, retaining the
  // historical account/session facts. registerJava then measures the copied candidate for real.
  const rebound = { ...profiles.data, javas: [] }; delete rebound.selectedJavaId;
  await storage.writeLaunchProfiles(profiles.revision, parseLaunchProfiles(rebound));
  const java = await profileService.registerJava(executable); assert.equal(java.version, selectedJava.version);
  const account = await profileService.createOffline(randomUUID(), { displayName: 'A v11 coexistence', gameName: 'OUCLAV11' });
  const index = await storage.readInstances();
  await storage.writeInstances(index.revision, { items: records.map(e => e.data.summary) });
  const checks = [];
  for (const envelope of records) {
    assert.deepEqual(await storage.readInstance(envelope.data.summary.instanceId), envelope, 'ORIGINAL_INSTANCE_CHANGED');
    const signal = new AbortController().signal; const id = envelope.data.summary.instanceId;
    const prepared = await installer.prepareLaunch(id, envelope.revision, signal);
    const final = await installer.verifyPreparedLaunch(id, envelope.revision, prepared.nativeFiles, signal);
    const inventory = await installer.inspectLaunchMods(id, envelope.revision, java.version, signal); assert.equal(inventory.local.state, 'satisfied');
    checks.push({ instanceId: id, displayName: envelope.data.summary.displayName, revision: envelope.revision, jar: final.layout.jar,
      indexes: final.prepared.plan.views.filter(v => v.area === 'assets' && v.path.startsWith('indexes/')).map(v => v.path),
      nativeFiles: final.nativeFiles.length, inventoryFingerprint: inventory.fingerprint, localState: inventory.local.state,
      mods: inventory.items.map(m => ({ filename: m.filename, sha256: m.sha256 })) });
  }
  result = { profile, dataDirectory, rootId, account, java, instances: checks, copiedFiles: manifest.length, copiedBytes: manifest.reduce((n, x) => n + x.size, 0), rebuiltProvenanceEntries: rebuilt,
    history: { snapshot: dbEvidence, note: 'Genuine historical tasks/sessions/committed transactions retained as history, not new launch success. Failed historical instance JSON preserved but target selection index contains only the three approved ready instances.' },
    scope: 'Preparation only, no GUI/Minecraft started, no source paths modified, no download evidence.' };
} finally { await installer.close(); await profileService.close(); await storage.close(); }
for (const f of metadataFacts) assert.equal(await hash(path.join(sourceMetadata, f.name)), f.sha256);
await writeFile(path.join(here, 'prepared.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
