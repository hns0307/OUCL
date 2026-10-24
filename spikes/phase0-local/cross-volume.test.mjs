import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rename, stat } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, atomicJson, digest } from './fixture.mjs';
import { killAt } from './process-fixture.mjs';
import { recover } from './recovery.mjs';

const workspaceParent = fileURLToPath(new URL('./.runs/', import.meta.url));
const worker = fileURLToPath(new URL('./storage-worker.mjs', import.meta.url));

/** Uses OS-temp and repo-local fixtures; same-volume machines explicitly skip. */
async function pair(t) {
  await mkdir(workspaceParent, { recursive: true });
  const source = await fixture(); t.after(source.cleanup);
  const target = await fixture(workspaceParent); t.after(target.cleanup);
  if ((await stat(source.root)).dev === (await stat(target.root)).dev) {
    t.skip('Distinct authorized volumes unavailable'); return undefined;
  }
  await writeFile(path.join(source.root, 'new-object'), 'new cross-volume bytes');
  for (const file of ['entry', 'old-backup']) await writeFile(path.join(target.root, file), 'old target bytes');
  await writeFile(path.join(target.root, 'other-instance-save'), 'preserve private save');
  await atomicJson(path.join(target.root, 'instance.json'), { schemaVersion: 1, revision: 1, hash: digest('old target bytes') });
  await atomicJson(path.join(target.root, 'next.json'), { schemaVersion: 1, revision: 2, hash: digest('new cross-volume bytes') });
  t.diagnostic(`Actual volumes: ${path.parse(source.root).root} -> ${path.parse(target.root).root}`);
  return { source: source.root, target: target.root };
}

test('S-07 actual cross-volume rename is rejected without moving source', async t => {
  const p = await pair(t); if (!p) return;
  const source = path.join(p.source, 'new-object');
  const target = path.join(p.target, 'direct-rename');
  await assert.rejects(rename(source, target), { code: 'EXDEV' });
  assert.equal(await readFile(source, 'utf8'), 'new cross-volume bytes');
  await assert.rejects(stat(target), { code: 'ENOENT' });
});

for (const boundary of ['prepared', 'staged', 'applying', 'entry-replaced', 'json-committed', 'committed']) {
  test(`S-07/S-10 cross-volume staging killed at ${boundary} recovers on target volume`, async t => {
    const p = await pair(t); if (!p) return;
    await killAt('cross-operation', p.target, boundary, [p.source]);
    const committed = ['json-committed', 'committed'].includes(boundary);
    assert.equal(await recover(p.target), committed ? 'committed' : 'rolledBack');
    assert.equal(await recover(p.target), committed ? 'committed' : 'rolledBack');
    assert.equal(await readFile(path.join(p.target, 'entry'), 'utf8'), committed ? 'new cross-volume bytes' : 'old target bytes');
    const manifest = JSON.parse(await readFile(path.join(p.target, 'instance.json'), 'utf8'));
    assert.equal(manifest.revision, committed ? 2 : 1);
    assert.equal(await readFile(path.join(p.source, 'new-object'), 'utf8'), 'new cross-volume bytes');
    assert.equal(await readFile(path.join(p.target, 'other-instance-save'), 'utf8'), 'preserve private save');
  });
}

test('S-07 cross-volume corrupted copy is rejected before replacing target', async t => {
  const p = await pair(t); if (!p) return;
  await writeFile(path.join(p.source, 'new-object'), 'corrupted source bytes');
  const child = fork(worker, ['cross-operation', p.target, 'no-stop', p.source], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errorText = ''; child.stderr.on('data', bytes => { errorText += bytes.toString(); });
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 10000);
  try {
    const [code] = await once(child, 'exit');
    assert.notEqual(code, 0); assert.match(errorText, /STAGED_HASH_MISMATCH/);
  } finally { clearTimeout(timer); }
  assert.equal(await readFile(path.join(p.target, 'entry'), 'utf8'), 'old target bytes');
  assert.equal(JSON.parse(await readFile(path.join(p.target, 'instance.json'), 'utf8')).revision, 1);
  assert.equal(await recover(p.target), 'rolledBack');
  assert.equal(await readFile(path.join(p.source, 'new-object'), 'utf8'), 'corrupted source bytes');
});
