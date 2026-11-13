// Run only after the coordinating chat finishes all games. Read-only inputs;
// the sole write is a new result JSON in this directory. No GUI/process control.
import assert from 'node:assert/strict';
import { readFile, writeFile, lstat, realpath, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGameSessions } from './compiled/src/services/storage/game-sessions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cutoff = '2026-11-13T06:00:00.000Z';
const argument = process.argv.slice(2);
assert.ok(argument.length <= 1);
const outputName = argument[0] ?? 'v12-result.json';
assert.match(outputName, /^v12-result(?:-[a-z0-9-]+)?\.json$/);
const output = path.join(here, outputName);
try { await access(output); throw new Error('RESULT_EXISTS_USE_NEW_NAME'); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const checks = [];
const check = (name, ok, detail = {}) => checks.push({ name, ok: Boolean(ok), ...detail });
const result = { status: 'INCOMPLETE', cutoff, checkedAt: new Date().toISOString(), checks,
  scope: 'New persisted sessions/real launch task admissions, local log milestones and byte/path coexistence. No GUI/menu observation by this script; no cold-download or owner-recovery claim.' };
function contained(base, file) {
  const relative = path.relative(base, file); assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'PATH_OUTSIDE_APPROVED_COPY');
}
async function ordinaryFile(base, file) {
  contained(path.resolve(base), path.resolve(file));
  const resolved = await realpath(file); contained(await realpath(base), resolved);
  const info = await lstat(file); assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'NOT_SINGLE_ORDINARY_FILE');
  return info;
}
async function stableBytes(base, file) {
  const before = await ordinaryFile(base, file); const bytes = await readFile(file); const after = await lstat(file);
  assert.equal(before.size, after.size, 'FILE_CHANGED_DURING_AUDIT'); assert.equal(before.mtimeMs, after.mtimeMs, 'FILE_CHANGED_DURING_AUDIT');
  return { bytes, info: after };
}
try {
  const preparedBytes = await readFile(path.join(here, 'prepared.json'));
  const prepared = JSON.parse(preparedBytes);
  const expectedData = path.join(here, 'isolated/games');
  const expectedProfile = path.join(here, 'isolated/profile');
  assert.equal(path.resolve(prepared.dataDirectory), expectedData, 'UNEXPECTED_GAME_ROOT');
  assert.equal(path.resolve(prepared.profile), expectedProfile, 'UNEXPECTED_PROFILE');
  assert.equal(prepared.instances.length, 3, 'EXPECTED_THREE_PREPARED_INSTANCES');
  result.preparedSha256 = hash(preparedBytes);
  const metadata = path.join(expectedProfile, 'metadata');
  const sessionsFile = path.join(metadata, 'game-sessions.json');
  const sessionBytes = (await stableBytes(metadata, sessionsFile)).bytes;
  const sessions = parseGameSessions(JSON.parse(sessionBytes).data).items;
  const targetIds = new Set(prepared.instances.map(i => i.instanceId));
  const recent = sessions.filter(s => s.rootId === prepared.rootId && targetIds.has(s.snapshot.instanceId)
    && Date.parse(s.snapshot.startedAt) >= Date.parse(cutoff));
  result.recentSessions = recent.map(s => ({ taskId: s.taskId, instanceId: s.snapshot.instanceId, startedAt: s.snapshot.startedAt,
    spawned: s.spawned, state: s.snapshot.state, exitCode: s.snapshot.exitCode ?? null, stopTaskCount: s.stopTaskIds.length,
    errors: (s.errors ?? []).map(e => ({ taskId: e.taskId, code: e.code })) }));
  const selected = new Map();
  for (const instance of prepared.instances) {
    const attempts = recent.filter(s => s.snapshot.instanceId === instance.instanceId).sort((a, b) => Date.parse(a.snapshot.startedAt) - Date.parse(b.snapshot.startedAt));
    check(`new-session:${instance.instanceId}`, attempts.length > 0, { attempts: attempts.length });
    const last = attempts.at(-1); if (last) selected.set(instance.instanceId, last);
    for (const s of attempts) check(`exit-zero:${s.taskId}`, s.spawned && s.snapshot.state === 'exited' && s.snapshot.exitCode === 0,
      { state: s.snapshot.state, exitCode: s.snapshot.exitCode ?? null });
  }
  // Correlate persisted sessions with genuine accepted launch tasks; never invent rows.
  const database = new DatabaseSync(path.join(metadata, 'tasks.sqlite'), { readOnly: true });
  result.launchAdmissions = [];
  try {
    database.exec('BEGIN');
    for (const s of recent) {
      const task = database.prepare('SELECT id,owner_id,kind,execution FROM tasks WHERE id=?').get(s.taskId);
      const requests = database.prepare('SELECT request_id,kind,owner_id FROM requests WHERE task_id=? ORDER BY request_id').all(s.taskId);
      const execution = task ? JSON.parse(task.execution) : undefined;
      check(`durable-launch:${s.taskId}`, task?.kind === 'launch' && task.owner_id === prepared.rootId && execution?.state === 'completed'
        && requests.length === 1 && requests[0].owner_id === prepared.rootId && requests[0].kind === 'launch');
      result.launchAdmissions.push({ taskId: s.taskId, kind: task?.kind ?? null, state: execution?.state ?? null, requestIds: requests.map(r => r.request_id) });
    }
    database.exec('COMMIT');
  } finally { database.close(); }
  const baseline = JSON.parse(await readFile(path.join(here, 'audit.json')));
  const copyManifest = JSON.parse(await readFile(path.join(here, 'copy-manifest.json')));
  const sourceFacts = JSON.parse(await readFile(path.join(here, 'source-metadata.json')));
  result.indexes = [];
  for (const expected of baseline.indexes) {
    const file = path.join(expectedData, 'roots', prepared.rootId, '.minecraft/assets', expected.path);
    const bytes = (await stableBytes(expectedData, file)).bytes; const sha1 = hash(bytes, 'sha1');
    check(`index:${expected.path}`, sha1 === expected.targetSha1 && sha1 === expected.sourceSha1);
    result.indexes.push({ path: expected.path, sha1, unchanged: sha1 === expected.targetSha1 });
  }
  check('two-distinct-indexes', result.indexes.length === 2 && new Set(result.indexes.map(i => i.sha1)).size === 2);
  result.instances = [];
  for (const instance of prepared.instances) {
    const recordFile = path.join(metadata, `instance-${instance.instanceId}.json`);
    const recordBytes = (await stableBytes(metadata, recordFile)).bytes;
    const original = sourceFacts.find(f => f.name === path.basename(recordFile));
    check(`instance-proof-unchanged:${instance.instanceId}`, hash(recordBytes) === original?.sha256);
    const record = JSON.parse(recordBytes).data;
    const indexes = record.receipts.filter(r => r.area === 'assets' && r.path.startsWith('indexes/')).map(r => r.path).sort();
    check(`recorded-index-path:${instance.instanceId}`, JSON.stringify(indexes) === JSON.stringify([...instance.indexes].sort()));
    const dependencyFiles = [];
    // Both the original/shared client and the metadata-bound new jar/JSON must remain
    // at their independently prepared locations with the original copied bytes.
    for (const file of [instance.jar, instance.jar.replace(/\.jar$/, '.json')]) {
      const rel = path.relative(path.join(here, 'isolated'), file);
      const entry = copyManifest.find(f => path.normalize(f.target) === path.normalize(rel));
      assert.ok(entry, 'JAR_OR_METADATA_NOT_IN_COPY_BASELINE');
      const bytes = (await stableBytes(expectedData, file)).bytes; const sha256 = hash(bytes);
      check(`dependency-bytes:${instance.instanceId}:${path.basename(file)}`, sha256 === entry.targetSha256);
      dependencyFiles.push({ path: path.relative(expectedData, file), sha256 });
    }
    const versionDir = path.join(expectedData, 'roots', prepared.rootId, '.minecraft/versions', instance.instanceId);
    const logFile = path.join(versionDir, 'logs/latest.log');
    const log = await stableBytes(expectedData, logFile); const markers = [];
    for (const [offset, line] of log.bytes.toString('utf8').split(/\r?\n/).entries()) {
      const time = /^\[(\d\d:\d\d:\d\d)\]/.exec(line)?.[1]; let marker;
      const loader = /Loading Minecraft ([0-9A-Za-z._+-]{1,64}) with (Fabric|Quilt) Loader ([0-9A-Za-z._+-]{1,64})\s*$/.exec(line);
      const ferrite = /^\s*-\s+ferritecore\s+([0-9A-Za-z._+-]{1,64})\s*$/.exec(line);
      if (loader) marker = { kind: 'loader', minecraft: loader[1], loader: loader[2].toLowerCase(), version: loader[3] };
      else if (ferrite) marker = { kind: 'ferritecore', version: ferrite[1] };
      else if (/Backend library: LWJGL version [0-9A-Za-z. _+-]{1,64}\s*$/.test(line)) marker = { kind: 'renderer-initialized' };
      else if (/Created: \d+x\d+x\d+ minecraft:textures\/atlas\/blocks\.png-atlas\s*$/.test(line)) marker = { kind: 'blocks-atlas-ready' };
      else if (/\bSound engine started\s*$/.test(line)) marker = { kind: 'sound-ready' };
      else if (/\bStopping!\s*$/.test(line)) marker = { kind: 'stopping' };
      if (marker) markers.push({ line: offset + 1, ...(time ? { time } : {}), ...marker });
    }
    const session = selected.get(instance.instanceId);
    check(`latest-log-is-current:${instance.instanceId}`, session && log.info.mtimeMs >= Date.parse(session.snapshot.startedAt));
    check(`renderer-milestones:${instance.instanceId}`, markers.some(m => m.kind === 'renderer-initialized') && markers.some(m => m.kind === 'blocks-atlas-ready'));
    check(`stopping-marker:${instance.instanceId}`, markers.some(m => m.kind === 'stopping'));
    if (record.loader.kind === 'fabric' || record.loader.kind === 'quilt') check(`loader-version:${instance.instanceId}`,
      markers.some(m => m.kind === 'loader' && m.loader === record.loader.kind && m.version === record.loader.version && m.minecraft === record.summary.mcVersionId));
    if (record.loader.kind === 'fabric') check(`ferritecore-version:${instance.instanceId}`, markers.some(m => m.kind === 'ferritecore' && m.version === '6.0.1'));
    const screenshot = path.join(here, `${record.loader.kind}-menu.png`);
    let image = { present: false, contentReviewedByScript: false };
    try { const shot = await stableBytes(here, screenshot); image = { present: true, sha256: hash(shot.bytes), contentReviewedByScript: false }; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    result.instances.push({ instanceId: instance.instanceId, dependencyFiles, indexes, log: { sha256: hash(log.bytes), mtime: new Date(log.info.mtimeMs).toISOString(), markers,
      interpretation: 'Renderer milestones support initialization; menu observation belongs to the coordinating GUI evidence, not inferred from logs.' }, screenshot: image });
  }
  const packageFile = path.join(root, 'docs/validation/BOOTSTRAP-0.3.0-acceptance-20261113-v11/package.json');
  const pack = JSON.parse(await readFile(packageFile));
  const exe = await stableBytes(path.join(root, 'release'), pack.output);
  check('release-executable', hash(exe.bytes) === pack.sha256 && exe.info.size === pack.bytes);
  const product = JSON.parse(await readFile(path.join(root, 'acceptance-results/product-manifest.json')));
  check('seven-product-files', product.length === 7);
  const app = path.join(root, 'release/OUCL.runtime', `app-${pack.appHash}`);
  result.product = { executable: { sha256: hash(exe.bytes), bytes: exe.info.size }, appHash: pack.appHash, files: [] };
  for (const expected of product) {
    const extracted = await stableBytes(app, path.join(app, 'dist', expected.path));
    const sha256 = hash(extracted.bytes); check(`release-product:${expected.path}`, sha256 === expected.sha256);
    result.product.files.push({ path: expected.path, sha256, expectedSha256: expected.sha256 });
  }
  check('sessions-stable-during-audit', hash(await readFile(sessionsFile)) === hash(sessionBytes));
  result.ownerMarkerPresent = await lstat(path.join(metadata, 'owner.lock')).then(() => true, e => { if (e.code !== 'ENOENT') throw e; return false; });
  // The launcher may remain open after all games exit; ownerMarkerPresent is an observation,
  // not a requirement to terminate or close it, nor proof of an OS process/lease lifetime.
} catch (error) {
  check('audit-completed', false, { code: error.code ?? error.name, detail: error instanceof assert.AssertionError ? String(error.message).split('\n')[0] : 'Read/parse validation failed; no product inputs modified.' });
}
result.status = checks.length > 0 && checks.every(c => c.ok) ? 'PASS' : 'FAIL_OR_INCOMPLETE';
await writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, output: outputName, checks: checks.length, failed: checks.filter(c => !c.ok) }));
if (result.status !== 'PASS') process.exitCode = 1;
