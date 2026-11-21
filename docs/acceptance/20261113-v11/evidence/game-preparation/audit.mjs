import assert from 'node:assert/strict';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JavaProbe } from './compiled/src/services/java/probe.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = 'D:/MC_start/OUCL-PA-clone-20261112';
const target = path.join(here, 'isolated');
const metadata = path.join(target, 'profile/metadata');
const hash = async (file, algorithm = 'sha256') => { const h = createHash(algorithm); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex'); };
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const issues = []; let files = 0; let directories = 0;
async function walk(root) {
  for (const name of await readdir(root)) {
    const file = path.join(root, name); const s = await lstat(file);
    if (s.isSymbolicLink()) issues.push({ file, issue: 'SYMBOLIC_LINK' });
    else if (s.isDirectory()) { directories++; await walk(file); }
    else { files++; if (!s.isFile() || s.nlink !== 1) issues.push({ file, issue: 'NOT_SINGLE_ORDINARY_FILE' }); }
    if (name.endsWith('.lock')) issues.push({ file, issue: 'REMAINING_LOCK' });
  }
}
await walk(target); assert.equal(issues.length, 0);
const original = new DatabaseSync(path.join(source, 'OUCL.runtime/profile/metadata/tasks.sqlite'), { readOnly: true });
const copy = new DatabaseSync(path.join(metadata, 'tasks.sqlite'), { readOnly: true });
const ledger = {};
try {
  for (const table of ['tasks', 'requests']) {
    const key = table === 'tasks' ? 'id' : 'owner_id,request_id';
    const before = original.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).all(); const after = copy.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).all();
    assert.deepEqual(after, before); ledger[table] = { count: before.length, sha256: digest(before), unchanged: true };
  }
  const before = original.prepare('SELECT * FROM operations ORDER BY rowid').iterate();
  const after = copy.prepare('SELECT * FROM operations ORDER BY rowid').iterate(); let prefix = 0;
  for (const row of before) { assert.deepEqual(after.next().value, row); prefix++; }
  const appended = []; for (;;) { const row = after.next(); if (row.done) break; assert.equal(row.value.phase, 'COMMITTED'); appended.push({ recordId: row.value.record_id, phase: row.value.phase }); }
  ledger.operations = { unchangedOriginalPrefix: prefix, targetOnlyAppended: appended };
} finally { original.close(); copy.close(); }
const facts = JSON.parse(await readFile(path.join(here, 'source-metadata.json')));
for (const fact of facts) assert.equal(await hash(path.join(source, 'OUCL.runtime/profile/metadata', fact.name)), fact.sha256);
const prepared = JSON.parse(await readFile(path.join(here, 'prepared.json')));
const indexes = [];
for (const relative of [...new Set(prepared.instances.flatMap(i => i.indexes))]) {
  const rel = path.join('OUCL.games/roots', prepared.rootId, '.minecraft/assets', relative);
  const oldFile = path.join(source, rel); const newFile = path.join(prepared.dataDirectory, 'roots', prepared.rootId, '.minecraft/assets', relative);
  const sourceSha1 = await hash(oldFile, 'sha1'); const targetSha1 = await hash(newFile, 'sha1'); assert.equal(sourceSha1, targetSha1);
  indexes.push({ path: relative, sourceSha1, targetSha1 });
}
const measured = await new JavaProbe().probe(prepared.java.executable); assert.equal(measured.version, prepared.java.version);
const frozen = JSON.parse(await readFile(path.resolve(here, '../../FREEZE-MANIFEST.json')));
for (const f of frozen.files) assert.equal(await hash(path.resolve(here, '../..', f.path)), f.sha256, `FROZEN_SOURCE_DRIFT:${f.path}`);
const result = { status: 'PASS', files, directories, issues, ledger, unchangedSourceRecords: facts.length, measuredJava: measured, indexes, frozenFiles: frozen.files.length,
  scope: 'Ordinary isolated copy, genuine historical ledger retained plus API journal rebinds; no GUI/game, no cold download or original owner recovery.' };
await writeFile(path.join(here, 'audit.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
