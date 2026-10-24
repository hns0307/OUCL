import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fixture, digest, atomicJson } from './fixture.mjs';
import { recover } from './recovery.mjs';
import { killAt } from './process-fixture.mjs';

/** Creates independent known old/new bytes and the experiment's minimal journal. */
async function prepared(t, revision = 1, state = 'APPLYING') {
  const f = await fixture(); t.after(f.cleanup);
  await writeFile(path.join(f.root, 'old-backup'), 'old');
  await writeFile(path.join(f.root, 'entry'), 'new');
  await atomicJson(path.join(f.root, 'instance.json'), { schemaVersion: 1, revision, hash: digest(revision === 1 ? 'old' : 'new') });
  const file = path.join(f.root, 'tasks.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE operation (id TEXT PRIMARY KEY, state TEXT NOT NULL);');
  db.prepare('INSERT INTO operation VALUES (?, ?)').run('op-1', state); db.close();
  return { ...f, file };
}

test('S-10 regression: repeating rollback keeps the same valid terminal state', async t => {
  const f = await prepared(t);
  assert.equal(await recover(f.root), 'rolledBack');
  for (let attempt = 0; attempt < 20; attempt++) assert.equal(await recover(f.root), 'rolledBack');
  assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'old');
});

test('S-10: repeating committed recovery preserves the new revision', async t => {
  const f = await prepared(t, 2);
  for (let attempt = 0; attempt < 20; attempt++) assert.equal(await recover(f.root), 'committed');
  assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'new');
});

for (const [revision, state] of [[1, 'COMMITTED'], [2, 'ROLLED_BACK'], [2, 'PREPARED'], [1, 'UNKNOWN']]) {
  test(`S-10: contradictory revision ${revision} and journal ${state} stop without replacing entry`, async t => {
    const f = await prepared(t, revision, state);
    const before = await readFile(path.join(f.root, 'entry'));
    assert.equal(await recover(f.root), 'needsRecovery');
    assert.deepEqual(await readFile(path.join(f.root, 'entry')), before);
    const db = new DatabaseSync(f.file, { readOnly: true });
    try { assert.equal(db.prepare('SELECT state FROM operation').get().state, state); } finally { db.close(); }
  });
}

test('S-10: a missing journal never creates an empty database', async t => {
  const f = await prepared(t); await unlink(f.file);
  assert.equal(await recover(f.root), 'needsRecovery');
  await assert.rejects(stat(f.file), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'new');
});

test('S-10: malformed metadata is retained and classified, not guessed', async t => {
  const f = await prepared(t);
  for (const value of ['{broken', 'null', '[]', '{"schemaVersion":1,"revision":1}', '{"schemaVersion":1,"revision":1,"hash":"bad"}']) {
    await writeFile(path.join(f.root, 'instance.json'), value);
    assert.equal(await recover(f.root), 'needsRecovery');
    assert.equal(await readFile(path.join(f.root, 'instance.json'), 'utf8'), value);
    assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'new');
  }
});

test('S-06a/S-10: writer contention reports busy before any filesystem replacement', async t => {
  const f = await prepared(t);
  const owner = new DatabaseSync(f.file);
  owner.exec('BEGIN IMMEDIATE');
  try {
    assert.equal(await recover(f.root), 'busy');
    assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'new');
  } finally { owner.exec('ROLLBACK'); owner.close(); }
  assert.equal(await recover(f.root), 'rolledBack');
});

for (const boundary of ['recovery-staged', 'recovery-entry-replaced', 'recovery-log-updated']) {
  test(`S-07/S-10: recovery killed at ${boundary} can itself be recovered`, async t => {
    const f = await prepared(t);
    const sentinel = path.join(f.root, 'other-instance-save');
    await writeFile(sentinel, 'private player data');
    await killAt('recovery', f.root, boundary);
    assert.equal(await recover(f.root), 'rolledBack');
    assert.equal(await recover(f.root), 'rolledBack');
    assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'old');
    assert.equal(await readFile(path.join(f.root, 'old-backup'), 'utf8'), 'old');
    assert.equal(await readFile(sentinel, 'utf8'), 'private player data');
    const db = new DatabaseSync(f.file, { readOnly: true });
    try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); } finally { db.close(); }
  });
}

test('S-06a/S-10: twelve competing recovery pairs serialize writes and replay safely', async t => {
  for (let round = 0; round < 12; round++) {
    const f = await prepared(t);
    const outcomes = await Promise.all([recover(f.root), recover(f.root)]);
    assert.ok(outcomes.includes('rolledBack'));
    assert.ok(outcomes.every(value => ['rolledBack', 'busy'].includes(value)));
    assert.equal(await recover(f.root), 'rolledBack');
    assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'old');
    const db = new DatabaseSync(f.file, { readOnly: true });
    try { assert.equal(db.prepare('SELECT state FROM operation').get().state, 'ROLLED_BACK'); } finally { db.close(); }
  }
});

for (const damage of ['missing-row', 'missing-table', 'corrupt-db', 'missing-backup', 'missing-entry']) {
  test(`S-10: ${damage} preserves evidence and requires manual recovery`, async t => {
    const f = await prepared(t);
    const beforeManifest = await readFile(path.join(f.root, 'instance.json'));
    if (damage === 'missing-row' || damage === 'missing-table') {
      const db = new DatabaseSync(f.file);
      db.exec(damage === 'missing-row' ? 'DELETE FROM operation' : 'DROP TABLE operation'); db.close();
    } else if (damage === 'corrupt-db') await writeFile(f.file, 'damaged journal');
    else await unlink(path.join(f.root, damage === 'missing-backup' ? 'old-backup' : 'entry'));
    assert.equal(await recover(f.root), 'needsRecovery');
    assert.deepEqual(await readFile(path.join(f.root, 'instance.json')), beforeManifest);
    if (damage !== 'missing-entry') assert.equal(await readFile(path.join(f.root, 'entry'), 'utf8'), 'new');
    else await assert.rejects(stat(path.join(f.root, 'entry')), { code: 'ENOENT' });
    if (damage === 'corrupt-db') assert.equal(await readFile(f.file, 'utf8'), 'damaged journal');
  });
}
