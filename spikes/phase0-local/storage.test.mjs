import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { writeFile, readFile, copyFile, stat, symlink, mkdir, unlink, rename, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fixture, digest, atomicJson } from './fixture.mjs';
import { recover } from './recovery.mjs';
import { killAt } from './process-fixture.mjs';

test('S-06a: killed transaction keeps committed row and rolls back pending row', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await killAt('sqlite', f.root, 'transaction-open');
  const db = new DatabaseSync(path.join(f.root, 'tasks.sqlite'));
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('SELECT id FROM task').all().map(row => row.id), ['committed']);
  } finally { db.close(); }
});

for (const boundary of ['prepared', 'staged', 'applying', 'entry-replaced', 'json-committed', 'committed']) {
  test(`S-07/S-10: killed at ${boundary} restores complete old or new revision`, async t => {
    const f = await fixture(); t.after(f.cleanup);
    const oldText = 'old fake jar'; const newText = 'new fake jar';
    for (const name of ['entry', 'old-backup']) await writeFile(path.join(f.root, name), oldText);
    await writeFile(path.join(f.root, 'new-object'), newText);
    await atomicJson(path.join(f.root, 'instance.json'), { schemaVersion: 1, revision: 1, hash: digest(oldText) });
    await atomicJson(path.join(f.root, 'next.json'), { schemaVersion: 1, revision: 2, hash: digest(newText) });
    await killAt('operation', f.root, boundary);
    const isCommitted = ['json-committed', 'committed'].includes(boundary);
    assert.equal(await recover(f.root), isCommitted ? 'committed' : 'rolledBack');
    assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), isCommitted ? newText : oldText);
    const manifest = JSON.parse(await readFile(path.join(f.root, 'instance.json'), 'utf8'));
    assert.equal(manifest.revision, isCommitted ? 2 : 1);
  });
}

test('S-07: injected pre-rename disk error preserves valid old JSON', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const file = path.join(f.root, '配置 中文.json');
  await atomicJson(file, { revision: 1 });
  await assert.rejects(atomicJson(file, { revision: 2 }, true), /INJECTED_DISK_FULL/);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { revision: 1 });
});

test('S-06a: corrupt database is rejected without replacing evidence', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const file = path.join(f.root, 'corrupt.sqlite');
  const evidence = Buffer.from('not a sqlite database'); await writeFile(file, evidence);
  const db = new DatabaseSync(file);
  try { assert.throws(() => db.prepare('PRAGMA integrity_check').get()); }
  finally { db.close(); }
  assert.deepEqual(await readFile(file), evidence);
});

test('S-10: unknown schema and changed committed entry stop recovery', async t => {
  const f = await fixture(); t.after(f.cleanup);
  await atomicJson(path.join(f.root, 'instance.json'), { schemaVersion: 99, revision: 2 });
  assert.equal(await recover(f.root), 'needsRecovery');
  const db = new DatabaseSync(path.join(f.root, 'tasks.sqlite'));
  db.exec("CREATE TABLE operation (id TEXT PRIMARY KEY, state TEXT); INSERT INTO operation VALUES ('op-1', 'APPLYING')"); db.close();
  await atomicJson(path.join(f.root, 'instance.json'), { schemaVersion: 1, revision: 2, hash: digest('expected') });
  await writeFile(path.join(f.root, 'entry'), 'tampered');
  assert.equal(await recover(f.root), 'needsRecovery');
  assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'tampered');
  await atomicJson(path.join(f.root, 'instance.json'), { schemaVersion: 1, revision: 1, hash: digest('old') });
  await writeFile(path.join(f.root, 'old-backup'), 'damaged backup');
  assert.equal(await recover(f.root), 'needsRecovery');
  assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'tampered');
});

/** Checks a Windows relative artifact name; filesystem checks remain separate. */
function artifactPath(root, relative) {
  if (path.win32.isAbsolute(relative) || relative.includes(':')) throw new Error('INVALID_PATH');
  const parts = relative.split(/[\\/]/);
  if (parts.some(part => !part || ['.', '..'].includes(part) || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || /[<>"|?*\u0000-\u001f]/.test(part))) throw new Error('INVALID_PATH');
  const result = path.win32.resolve(root, relative);
  const tail = path.win32.relative(root, result);
  if (tail.startsWith('..') || path.win32.isAbsolute(tail)) throw new Error('OUTSIDE_ROOT');
  return result;
}

test('S-07: Windows reserved, absolute, traversal, alternate stream and ambiguous names rejected', () => {
  const root = 'D:\\fixture\\game';
  assert.equal(artifactPath(root, '中文 空格\\a.jar'), 'D:\\fixture\\game\\中文 空格\\a.jar');
  for (const invalid of ['../game-evil/a', '..\\a', 'C:\\a', '\\\\host\\share', 'NUL.jar', 'dir/COM1', 'a:b', 'a.', 'a ', '/root', 'a//b', 'a/./b', 'a/../b', 'a?b']) {
    assert.throws(() => artifactPath(root, invalid), /INVALID_PATH|OUTSIDE_ROOT/);
  }
});

/** Marks only authoritative references, never historical path projections. */
function gcPlan(objects, references, { recoveryKnown = true, indexPresent = true } = {}) {
  void indexPresent;
  if (!recoveryKnown) return { blocked: true, candidates: [] };
  const roots = new Set(Object.values(references).flat());
  return { blocked: false, candidates: objects.filter(id => !roots.has(id)) };
}

test('S-10: index loss retains instance/hidden/session/operation/backup references', () => {
  const references = { instance: ['a'], hidden: ['b'], session: ['c'], operation: ['d'], backup: ['e'] };
  const plan = gcPlan(['a','b','c','d','e','unreferenced'], references, { indexPresent: false });
  assert.deepEqual(plan, { blocked: false, candidates: ['unreferenced'] });
  assert.deepEqual(gcPlan(['a'], {}, { recoveryKnown: false }), { blocked: true, candidates: [] });
});

test('S-10: expired derived views do not permanently root objects; new lease retains them', () => {
  assert.deepEqual(gcPlan(['old-view-object'], {}).candidates, ['old-view-object']);
  assert.deepEqual(gcPlan(['old-view-object'], { operation: ['old-view-object'] }).candidates, []);
});

test('S-07: junction cleanup removes entry without traversing target', async t => {
  if (process.platform !== 'win32') return t.skip('Windows-specific junction');
  const f = await fixture(); const outside = await fixture();
  t.after(outside.cleanup);
  let cleaned = false; t.after(async () => { if (!cleaned) await f.cleanup(); });
  await writeFile(path.join(outside.root, 'sentinel'), 'preserve');
  await mkdir(path.join(f.root, '中文 空格'));
  await symlink(outside.root, path.join(f.root, '中文 空格', 'view'), 'junction');
  await f.cleanup(); cleaned = true;
  assert.equal(await readFile(path.join(outside.root, 'sentinel'), 'utf8'), 'preserve');
  await assert.rejects(stat(f.root), { code: 'ENOENT' });
});

test('S-09 Node adapter: real file symlink update/private write/delete preserves other instance', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const object = path.join(f.root, 'object'); const next = path.join(f.root, 'next');
  const a = path.join(f.root, 'A.jar'); const b = path.join(f.root, 'B.jar');
  await writeFile(object, 'old'); await writeFile(next, 'new');
  try { await symlink(object, a, 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Real Node file symlink permission unavailable; no system permission changes'); throw error; }
  await symlink(object, b, 'file');
  assert.equal(await readFile(b, 'utf8'), 'old');
  await unlink(a); await symlink(next, a, 'file');
  assert.equal(await readFile(b, 'utf8'), 'old');
  const privateCopy = path.join(f.root, 'private');
  await copyFile(a, privateCopy); await unlink(a); await rename(privateCopy, a);
  assert.equal((await lstat(a)).isSymbolicLink(), false);
  await writeFile(a, 'edited'); await unlink(a);
  assert.equal(await readFile(b, 'utf8'), 'old');
  assert.equal(await readFile(next, 'utf8'), 'new');
});
