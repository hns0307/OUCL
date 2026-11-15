import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, appendFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordStore } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/storage/records.js';
import { parseInstallation } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/storage/installation.js';
import { StorageClient } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/workers/storage-client.js';
import { ProfileService } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/launch/profiles.js';
import { parseLaunchProfiles } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/storage/launch-profiles.js';
import { parseInstanceRecord } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/storage/instance-records.js';
import { InstallerService, restoreInstallMetadata } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/install/installer.js';
import { instanceGameLayout } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/install/instance-files.js';
import { matchesLaunchProjection } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/install/launch-inputs.js';
import { parseModTransaction } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/storage/mod-transactions.js';
import { ObjectStore } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/objects/store.js';
import { HashPool } from 'file:///D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r3/.test-build/src/services/workers/hash-pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = 'D:/MC_start/OUCL-PA-clone-20261112';
const sourceMetadata = path.join(source, 'OUCL.runtime/profile/metadata');
const target = 'D:/MC_start/OUCL-acceptance-v33-20261114/game-data';
const profile = path.join(target, 'profile');
const metadata = path.join(profile, 'metadata');
const dataDirectory = path.join(target, 'games');
const ids = ['24871144-2454-505b-92aa-2741ccb05834', '5297a61f-56b1-5159-a84f-440c49b9ff5b', '34d051d5-22db-58a2-9bf0-e5990b01b87b'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = async file => { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); };
const within = (root, file) => { const relative = path.relative(path.resolve(root), path.resolve(file)); assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'OUTSIDE_APPROVED_BOUNDARY'); };
const manifest = []; const destinations = new Set(); const metadataFacts = [];
const entry = new URL("file:///D:/MC_start/OUCL-remediation-20261114-r1/dist/workers/entry.cjs");
async function noFile(file) { try { await access(file); throw new Error(`MUST_NOT_EXIST:${path.basename(file)}`); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
await noFile(target); await noFile(path.join(sourceMetadata, 'owner.lock'));
await noFile(path.join(source, 'OUCL.games/store/objects.owner.lock'));
const preflightDb = new DatabaseSync(path.join(sourceMetadata,'tasks.sqlite'),{readOnly:true});
try { assert.equal(preflightDb.prepare("SELECT COUNT(*) n FROM tasks WHERE json_extract(execution,'$.state') NOT IN ('completed','failed','cancelled','needsRecovery')").get().n,0); } finally { preflightDb.close(); }
await mkdir(metadata, { recursive: true }); await mkdir(dataDirectory);
for (const name of (await readdir(sourceMetadata)).filter(name => name.endsWith('.json'))) {
  const file = path.join(sourceMetadata, name); const s = await lstat(file); assert.ok(s.isFile() && !s.isSymbolicLink());
  const bytes = await readFile(file); metadataFacts.push({ name, size: bytes.length, sha256: digest(bytes) });
  await writeFile(path.join(metadata, name), bytes, { flag: 'wx' });
}
await writeFile(path.join(here, 'source-metadata.json'), JSON.stringify(metadataFacts, null, 2));
const sourceDb = new DatabaseSync(path.join(sourceMetadata, 'tasks.sqlite'), { readOnly: true });
let dbEvidence;
try {
  assert.deepEqual(sourceDb.prepare("SELECT DISTINCT phase FROM operations").all().map(r => r.phase), ['COMMITTED']);
  const active = sourceDb.prepare("SELECT COUNT(*) n FROM tasks WHERE json_extract(execution,'$.state') NOT IN ('completed','failed','cancelled','needsRecovery')").get().n;
  assert.equal(active, 0, 'SOURCE_HAS_ACTIVE_TASKS');
  const outcomes = new Map();
  for (const op of sourceDb.prepare('SELECT record_id,before_json,after_json FROM operations ORDER BY rowid').iterate()) {
    assert.equal(op.before_json === null ? undefined : digest(op.before_json), outcomes.get(op.record_id), 'SOURCE_OPERATION_CHAIN_MISMATCH');
    outcomes.set(op.record_id, digest(op.after_json));
  }
  const copiedNames = new Set(metadataFacts.map(f => f.name));
  for (const [recordId, expected] of outcomes) {
    assert.ok(copiedNames.has(recordId + '.json')); assert.equal(await hash(path.join(metadata, recordId + '.json')), expected, `SOURCE_JSON_COMMIT_MISMATCH:${recordId}`);
  }
  assert.equal(outcomes.size, copiedNames.size);
  dbEvidence = { tasks: sourceDb.prepare('SELECT COUNT(*) n FROM tasks').get().n, requests: sourceDb.prepare('SELECT COUNT(*) n FROM requests').get().n,
    operations: sourceDb.prepare('SELECT COUNT(*) n FROM operations').get().n, allCommitted: true, activeTasks: active, matchedRecords: outcomes.size };
  await backup(sourceDb, path.join(metadata, 'tasks.sqlite'));
} finally { sourceDb.close(); }
for (const f of metadataFacts) assert.equal(await hash(path.join(sourceMetadata, f.name)), f.sha256, 'SOURCE_CHANGED_DURING_SNAPSHOT');
await writeFile(path.join(here, 'snapshot.json'), JSON.stringify({ ...dbEvidence, method: 'node:sqlite backup of read-only connection; JSON commit points and full operation chain verified', targetDatabaseSha256: await hash(path.join(metadata, 'tasks.sqlite')) }, null, 2));
const installation = JSON.parse(await readFile(path.join(metadata, 'installation.json'), 'utf8'));
const sourceGames = installation.data.dataDirectory; within(source, sourceGames);
const rootId = installation.data.rootId;
const records = [];
for (const id of ids) {
  const e = JSON.parse(await readFile(path.join(metadata, `instance-${id}.json`), 'utf8')); const r = parseInstanceRecord(e.data);
  assert.equal(r.phase, 'ready'); assert.equal(r.summary.revision, e.revision); assert.equal(r.summary.rootId, rootId);
  assert.ok(r.receipts.every(receipt => receipt.mode === 'copy'), 'NON_COPY_RECEIPT_UNSUPPORTED'); records.push({ ...e, data: r });
}
async function planFile(origin, destination) {
  within(source, origin); within(target, destination); if (destinations.has(destination)) return;
  const actual = await realpath(origin); within(source, actual); assert.ok((await stat(actual)).isFile());
  manifest.push({ source: path.relative(source, origin), resolvedSource: path.relative(source, actual), target: path.relative(target, destination), size: (await stat(actual)).size });
  destinations.add(destination);
}
const excluded = new Set(['saves', 'logs', 'screenshots', '.oucl-launch', '.oucl-mod-staging', '.fabric']);
async function planTree(origin, destination) {
  const actual = await realpath(origin); within(source, actual);
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(actual)) {
    if (excluded.has(name) || /(?:\.lock$|\.tmp$|\.sqlite(?:-wal|-shm)?$)/i.test(name) || name.startsWith('.oucl-natives-')) continue;
    const input = path.join(origin, name); const output = path.join(destination, name);
    if ((await stat(input)).isDirectory()) await planTree(input, output); else await planFile(input, output);
  }
}
for (const area of ['assets', 'libraries']) await planTree(path.join(sourceGames, 'roots', rootId, '.minecraft', area), path.join(dataDirectory, 'roots', rootId, '.minecraft', area));
const objects = new Set();
for (const envelope of records) {
  const prepared = restoreInstallMetadata(envelope.data);
  const oldLayout = instanceGameLayout(sourceGames, envelope.data.summary, prepared); const next = instanceGameLayout(dataDirectory, envelope.data.summary, prepared);
  await planTree(oldLayout.versionDirectory, next.versionDirectory);
  if (path.dirname(oldLayout.jar) !== oldLayout.versionDirectory) {
    // Copy the inherited jar and its official metadata document together, never rewrite either.
    await planTree(path.dirname(oldLayout.jar), path.dirname(next.jar));
  }
  const transaction = envelope.data.modCommitId ? parseModTransaction(JSON.parse(await readFile(path.join(metadata, `mod-txn-${envelope.data.modCommitId}.json`))).data) : undefined;
  assert.ok(matchesLaunchProjection(JSON.parse(await readFile(oldLayout.instanceJson, 'utf8')), envelope, transaction));
  for (const object of Object.values(envelope.data.objects)) objects.add(object.digest);
}
for (const id of objects) {
  const rel = path.join('store/objects/sha256', id.slice(0, 2), id); await planFile(path.join(sourceGames, rel), path.join(dataDirectory, rel));
  await planTree(path.join(sourceGames, `${rel}.sources`), path.join(dataDirectory, `${rel}.sources`));
}
const oldProfiles = JSON.parse(await readFile(path.join(metadata, 'launch-profiles.json'), 'utf8'));
const selectedJava = oldProfiles.data.javas.find(j => j.javaId === oldProfiles.data.selectedJavaId); assert.equal(selectedJava.major, 17);
// The A clone had reused the prior test root's Java. Use its ordinary cloned cache instead;
// never follow the persisted executable outside this explicitly approved source boundary.
const javaCacheId = path.basename(path.dirname(path.dirname(selectedJava.executable)));
assert.match(javaCacheId, /^[a-f0-9]{40}$/);
const sourceJava = path.join(sourceGames, 'runtimes/java', javaCacheId);
const javaHome = path.join(target, 'java17'); await planTree(sourceJava, javaHome);
await writeFile(path.join(here, 'copy-plan.json'), JSON.stringify(manifest, null, 2));
let cursor = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  for (;;) {
    const index = cursor++; if (index >= manifest.length) return; const item = manifest[index];
    const from = path.join(source, item.resolvedSource); const to = path.join(target, item.target);
    const before = await stat(from); const first = await hash(from); await mkdir(path.dirname(to), { recursive: true });
    await pipeline(createReadStream(from), createWriteStream(to, { flags: 'wx' }));
    const sourceSha256 = await hash(from); const targetSha256 = await hash(to); const after = await stat(from); const destination = await lstat(to);
    assert.equal(first, sourceSha256); assert.equal(sourceSha256, targetSha256); assert.equal(before.size, after.size); assert.equal(before.mtimeMs, after.mtimeMs);
    assert.ok(destination.isFile() && !destination.isSymbolicLink() && destination.nlink === 1);
    Object.assign(item, { sourceSha256, targetSha256 }); await appendFile(path.join(here, 'copy-results.jsonl'), JSON.stringify(item) + '\n');
    if (index % 1000 === 0) console.log(`copied and verified ${index}/${manifest.length}`);
  }
}));
await writeFile(path.join(here, 'copy-manifest.json'), JSON.stringify(manifest, null, 2));
for (const f of metadataFacts) assert.equal(await hash(path.join(sourceMetadata, f.name)), f.sha256, 'SOURCE_METADATA_CHANGED_DURING_COPY');
// New target's real journal writes perform the path rebind; no direct SQL edits.
const store = await RecordStore.open(metadata); await store.recover();
try { await store.write('installation', installation.revision, { rootId, dataDirectory }, parseInstallation); }
finally { await store.close(); }
const storage = await StorageClient.open(entry, metadata, 120000);
let objectStore; const hashes = new HashPool(entry); let rebuilt;
try { objectStore = await ObjectStore.open(path.join(dataDirectory, 'store'), storage, hashes); rebuilt = await objectStore.rebuildIndex(); }
finally { if (objectStore) await objectStore.close(); await hashes.close(); }
await writeFile(path.join(here, 'rebuild.json'), JSON.stringify({ rebuilt }, null, 2));
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
  const account = await profileService.createOffline(randomUUID(), { displayName: 'A v33 coexistence', gameName: 'OUCLAV33' });
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
