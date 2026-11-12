import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, realpath, lstat, stat, writeFile, access } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordStore } from './compiled/src/services/storage/records.js';
import { parseInstanceRecord, parseInstanceIndex } from './compiled/src/services/storage/instance-records.js';
import { parseInstallation } from './compiled/src/services/storage/installation.js';
import { parseModTransaction } from './compiled/src/services/storage/mod-transactions.js';
import { StorageClient } from './compiled/src/services/workers/storage-client.js';
import { ProfileService } from './compiled/src/services/launch/profiles.js';
import { InstallerService, restoreInstallMetadata } from './compiled/src/services/install/installer.js';
import { instanceGameLayout } from './compiled/src/services/install/instance-files.js';
import { matchesLaunchProjection } from './compiled/src/services/install/launch-inputs.js';

const source = 'D:/MC_start/OUCL-PA-current-20261106';
const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, 'isolated');
const dataDirectory = path.join(target, 'games');
const profile = path.join(target, 'profile');
const sourceMetadata = path.join(source, 'OUCL.runtime/profile/metadata');
const ids = ['24871144-2454-505b-92aa-2741ccb05834', '5297a61f-56b1-5159-a84f-440c49b9ff5b'];
const manifest = []; const metadataFacts = []; const copied = new Set();
const hash = async file => { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); };
const within = (base, file) => { const r = path.relative(path.resolve(base), path.resolve(file)); assert.ok(!r.startsWith('..') && !path.isAbsolute(r), 'OUTSIDE_APPROVED_ROOT'); };
async function json(name) {
  const file = path.join(sourceMetadata, name); const bytes = await readFile(file);
  metadataFacts.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
  return JSON.parse(bytes);
}
async function copy(sourceFile, destination) {
  within(source, sourceFile); within(target, destination);
  const origin = await realpath(sourceFile); within(source, origin);
  if (copied.has(destination)) return;
  const info = await stat(origin); const dest = await lstat(destination);
  assert.ok(info.isFile()); assert.ok(dest.isFile() && !dest.isSymbolicLink() && dest.nlink === 1);
  assert.equal(info.size, dest.size);
  manifest.push({ source: path.relative(source, sourceFile), resolvedSource: path.relative(source, origin), target: path.relative(target, destination), size: info.size });
  copied.add(destination);
}
async function tree(origin, destination, exclude = new Set()) {
  const actual = await realpath(origin); within(source, actual);
  const dir = await lstat(destination); assert.ok(dir.isDirectory() && !dir.isSymbolicLink());
  for (const item of await readdir(actual, { withFileTypes: true })) {
    if (exclude.has(item.name) || /(?:\.lock$|\.sqlite(?:-wal|-shm)?$)/i.test(item.name)) continue;
    const input = path.join(origin, item.name); const output = path.join(destination, item.name);
    const entry = await stat(input);
    if (entry.isDirectory()) await tree(input, output, exclude); else await copy(input, output);
  }
}
assert.ok((await lstat(target)).isDirectory());
const installation = await json('installation.json'); const rootId = installation.data.rootId;
assert.equal(path.resolve(installation.data.dataDirectory), path.resolve(source, 'OUCL.games'));
const records = [];
for (const id of ids) {
  const envelope = await json(`instance-${id}.json`); const record = parseInstanceRecord(envelope.data);
  assert.equal(record.phase, 'ready'); assert.equal(record.summary.rootId, rootId); assert.equal(record.summary.revision, envelope.revision);
  assert.ok(record.receipts.every(r => r.mode === 'copy'));
  records.push({ ...envelope, data: record });
}
const txnEnvelope = await json(`mod-txn-${records[1].data.modCommitId}.json`);
const transaction = parseModTransaction(txnEnvelope.data); assert.equal(transaction.phase, 'committed');
assert.equal(transaction.afterInstanceDigest, createHash('sha256').update(JSON.stringify(records[1].data)).digest('hex'));
const sourceGames = installation.data.dataDirectory;
const oldGameRoot = path.join(sourceGames, 'roots', rootId, '.minecraft');
const newGameRoot = path.join(dataDirectory, 'roots', rootId, '.minecraft');
// Materialize both shared projections. No link survives into the new writable root.
for (const area of ['assets', 'libraries']) await tree(path.join(oldGameRoot, area), path.join(newGameRoot, area));
const excludes = new Set(['saves', 'logs', '.oucl-mod-staging', '.oucl-launch', '.fabric']);
const objectDigests = new Set();
for (const envelope of records) {
  const prepared = restoreInstallMetadata(envelope.data);
  const oldLayout = instanceGameLayout(sourceGames, envelope.data.summary, prepared);
  const newLayout = instanceGameLayout(dataDirectory, envelope.data.summary, prepared);
  await tree(oldLayout.versionDirectory, newLayout.versionDirectory, excludes);
  if (path.dirname(oldLayout.jar) !== oldLayout.versionDirectory) await copy(oldLayout.jar, newLayout.jar);
  const originalProjection = JSON.parse(await readFile(oldLayout.instanceJson, 'utf8'));
  assert.ok(matchesLaunchProjection(originalProjection, envelope, envelope.data.modCommitId ? transaction : undefined));
  for (const object of Object.values(envelope.data.objects)) objectDigests.add(object.digest);
}
for (const digest of objectDigests) {
  const rel = path.join('store/objects/sha256', digest.slice(0, 2), digest);
  await copy(path.join(sourceGames, rel), path.join(dataDirectory, rel));
  await tree(path.join(sourceGames, `${rel}.sources`), path.join(dataDirectory, `${rel}.sources`));
}
const profiles = await json('launch-profiles.json'); const oldJava = profiles.data.javas.find(j => j.javaId === profiles.data.selectedJavaId);
assert.equal(oldJava.major, 17); within(sourceGames, oldJava.executable);
const javaHome = path.dirname(path.dirname(oldJava.executable)); const newJavaHome = path.join(target, 'java17');
await tree(javaHome, newJavaHome); const javaExecutable = path.join(newJavaHome, 'bin/java.exe');

await writeFile(path.join(here, 'source-metadata-resume.json'), JSON.stringify(metadataFacts, null, 2));
await writeFile(path.join(here, 'copy-plan-resume.json'), JSON.stringify(manifest, null, 2));
let cursor = 0;
await Promise.all(Array.from({length: 8}, async () => {
  for (;;) {
    const index = cursor++; if (index >= manifest.length) return;
    const item = manifest[index]; const from = path.join(source, item.resolvedSource); const to = path.join(target, item.target);
    const before = await stat(from); const sourceSha256 = await hash(from); const targetSha256 = await hash(to); const after = await stat(from);
    assert.equal(sourceSha256, targetSha256, item.target); assert.equal(before.size, after.size); assert.equal(before.mtimeMs, after.mtimeMs);
    Object.assign(item, {sourceSha256, targetSha256});
    if (index % 1000 === 0) console.log(`audited ${index}/${manifest.length}`);
  }
}));
await writeFile(path.join(here, 'copy-manifest.json'), JSON.stringify(manifest, null, 2));
for (const fact of metadataFacts) assert.equal(await hash(path.join(sourceMetadata, fact.name)), fact.sha256);
await writeFile(path.join(here, 'source-metadata.json'), JSON.stringify(metadataFacts, null, 2));
const { ObjectStore } = await import('./compiled/src/services/objects/store.js');
const { HashPool } = await import('./compiled/src/services/workers/hash-pool.js');
const entry = new URL('./compiled/src/services/workers/entry.js', import.meta.url);
const storage = await StorageClient.open(entry, path.join(profile, 'metadata'), 120000);
const hashes = new HashPool(entry); let objects;
let rebuilt;
try { objects = await ObjectStore.open(path.join(dataDirectory, 'store'), storage, hashes); rebuilt = await objects.rebuildIndex(); }
finally { if (objects) await objects.close(); await hashes.close(); }
console.log(`rebuilt provenance entries ${rebuilt}`);
await writeFile(path.join(here, 'rebuild-result.json'), JSON.stringify({rebuilt, method:'candidate ObjectStore.rebuildIndex with real HashPool'}, null, 2));
const installer = new InstallerService(storage, entry, {prepare(){throw new Error('NETWORK_DISABLED_IN_PREPARATION');}});
const { JavaProbe } = await import('./compiled/src/services/java/probe.js');
let result;
try {
  const profiles = (await storage.readLaunchProfiles()).data;
  const java = profiles.javas.find(j => j.javaId === profiles.selectedJavaId); assert.ok(java);
  const measured = await new JavaProbe().probe(java.executable); assert.equal(measured.version, java.version);
  const account = profiles.accounts.find(a => a.gameName === 'OUCLDVerify4'); assert.ok(account);
  const verification = [];
  for (const envelope of records) {
    const id = envelope.data.summary.instanceId; const signal = new AbortController().signal;
    assert.deepEqual((await storage.readInstance(id)), envelope);
    const prepared = await installer.prepareLaunch(id, envelope.revision, signal);
    const final = await installer.verifyPreparedLaunch(id, envelope.revision, prepared.nativeFiles, signal);
    const mods = await installer.inspectLaunchMods(id, envelope.revision, measured.version, signal);
    assert.equal(mods.local.state, 'satisfied');
    verification.push({instanceId:id, revision:envelope.revision, nativeFiles:final.nativeFiles.length, inventoryFingerprint:mods.fingerprint, localState:mods.local.state, mods:mods.items.map(m=>({filename:m.filename,sha256:m.sha256}))});
  }
  result = {profile,rootId,dataDirectory,account,java,measured,instances:verification,copiedFiles:manifest.length,copiedBytes:manifest.reduce((n,f)=>n+f.size,0),rebuiltProvenanceEntries:rebuilt,note:'Preparation only. No GUI or Minecraft process started.'};
} finally {await installer.close(); await storage.close();}
for (const fact of metadataFacts) assert.equal(await hash(path.join(sourceMetadata,fact.name)),fact.sha256);
await writeFile(path.join(here,'prepared.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
