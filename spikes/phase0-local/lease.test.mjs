import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixture.mjs';
import { acquireLease, releaseLease } from './lease.mjs';

const worker = fileURLToPath(new URL('./lease-worker.mjs', import.meta.url));

/** Starts only a fixture worker; cleanup kills this exact child, never PID lookup. */
async function startWorker(t, root, mode = 'normal') {
  const child = fork(worker, [root, mode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const ended = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await ended; });
  let timer;
  try {
    const [lease] = await Promise.race([
      once(child, 'message'),
      ended.then(() => { throw new Error('LEASE_WORKER_EARLY_EXIT'); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('LEASE_TIMEOUT')), 10000); timer.unref(); }),
    ]);
    return { child, lease, ended };
  } finally { clearTimeout(timer); }
}

test('S-07 directory lease: two actual processes cannot both acquire a directory', async t => {
  const f = await fixture();
  const workers = await Promise.all([startWorker(t, f.root), startWorker(t, f.root)]);
  t.after(f.cleanup);
  assert.deepEqual(workers.map(value => value.lease.status).sort(), ['acquired', 'busy']);
  const winner = workers.find(value => value.lease.status === 'acquired');
  const response = once(winner.child, 'message'); winner.child.send('release');
  assert.deepEqual((await response)[0], { status: 'released', released: true });
  await winner.ended;
  const loser = workers.find(value => value.lease.status === 'busy'); loser.child.send('exit'); await loser.ended;
  const next = await acquireLease(f.root); assert.equal(next.status, 'acquired');
  assert.equal(await releaseLease(f.root, next.token), true);
});

test('S-07 directory lease: crashed owner leaves a fail-closed marker without PID reclaim', async t => {
  const f = await fixture(); const owner = await startWorker(t, f.root); t.after(f.cleanup);
  assert.equal(owner.lease.status, 'acquired'); owner.child.kill('SIGKILL'); await owner.ended;
  assert.equal((await acquireLease(f.root)).status, 'busy');
  const marker = path.join(f.root, '.oucl-experiment-lease');
  assert.equal(JSON.parse(await readFile(marker, 'utf8')).token, owner.lease.token);
  assert.equal(await releaseLease(f.root, 'another-owner'), false);
  // Test-only cleanup after observing our own child's exit, not production reclaim.
  await unlink(marker);
  const next = await acquireLease(f.root); assert.equal(next.status, 'acquired');
  assert.equal(await releaseLease(f.root, next.token), true);
});

test('S-07 directory lease: owner killed before writing metadata still blocks contenders', async t => {
  const f = await fixture(); const owner = await startWorker(t, f.root, 'empty'); t.after(f.cleanup);
  owner.child.kill('SIGKILL'); await owner.ended;
  assert.equal((await acquireLease(f.root)).status, 'busy');
  assert.equal(await releaseLease(f.root, owner.lease.token), false);
  assert.equal((await readFile(path.join(f.root, '.oucl-experiment-lease'))).length, 0);
});

test('S-07 directory lease: a changed owner token is never removed', async t => {
  const f = await fixture(); t.after(f.cleanup);
  const owner = await acquireLease(f.root);
  const marker = path.join(f.root, '.oucl-experiment-lease');
  await writeFile(marker, JSON.stringify({ token: 'replacement-owner' }));
  assert.equal(await releaseLease(f.root, owner.token), false);
  assert.equal(JSON.parse(await readFile(marker, 'utf8')).token, 'replacement-owner');
});

test('S-07 directory lease: directory junction aliases share the same occupancy', async t => {
  if (process.platform !== 'win32') return t.skip('Windows-specific junction alias');
  const f = await fixture(); const aliases = await fixture();
  const alias = path.join(aliases.root, 'alias');
  await symlink(f.root, alias, 'junction');
  const owner = await startWorker(t, f.root); t.after(aliases.cleanup); t.after(f.cleanup);
  assert.equal(owner.lease.status, 'acquired');
  assert.equal((await acquireLease(alias)).status, 'busy');
  const response = once(owner.child, 'message'); owner.child.send('release');
  assert.equal((await response)[0].released, true); await owner.ended;
  const throughAlias = await acquireLease(alias); assert.equal(throughAlias.status, 'acquired');
  assert.equal(await releaseLease(f.root, throughAlias.token), true);
});
