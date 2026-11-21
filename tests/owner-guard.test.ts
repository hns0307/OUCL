import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OwnerGuard } from '../src/services/storage/owner-guard.js';
import { RecordStore } from '../src/services/storage/records.js';

const windows = { skip: process.platform !== 'win32' };

test('guard retains compatibility marker and rejects a competing writer', windows, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-owner-'));
  try {
    const owner = await OwnerGuard.acquire(root);
    await assert.rejects(OwnerGuard.acquire(root), { code: 'STORE_BUSY' });
    await assert.rejects(RecordStore.open(root), { code: 'STORE_BUSY' });
    const store = await RecordStore.open(root, owner.token);
    await store.recover(); await store.close();
    assert.equal(await readFile(path.join(root, 'owner.lock'), 'utf8'), owner.token);
    await owner.close();
    const reopened = await OwnerGuard.acquire(root); await reopened.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy marker is never taken over or modified', windows, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-owner-'));
  try {
    const marker = '1a04ed60-7925-4ed2-9446-0e174104edc5';
    await writeFile(path.join(root, 'owner.lock'), marker);
    await assert.rejects(OwnerGuard.acquire(root), { code: 'STORE_BUSY' });
    assert.equal(await readFile(path.join(root, 'owner.lock'), 'utf8'), marker);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('damaged guard cannot authorize takeover of a preserved marker', windows, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-owner-'));
  try {
    const owner = await OwnerGuard.acquire(root);
    const marker = owner.token;
    owner.abandon();
    await writeFile(path.join(root, 'owner.guard.sqlite'), 'untrusted replacement');
    await assert.rejects(OwnerGuard.acquire(root), { code: 'NEEDS_RECOVERY' });
    assert.equal(await readFile(path.join(root, 'owner.lock'), 'utf8'), marker);
    assert.equal(await readFile(path.join(root, 'owner.guard.sqlite'), 'utf8'), 'untrusted replacement');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('orphaned guard sidecars are preserved and block initialization', windows, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-owner-'));
  try {
    const sidecar = path.join(root, 'owner.guard.sqlite-journal');
    await writeFile(sidecar, 'unknown evidence');
    await assert.rejects(OwnerGuard.acquire(root), { code: 'NEEDS_RECOVERY' });
    assert.equal(await readFile(sidecar, 'utf8'), 'unknown evidence');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('new-format guard can be reacquired after real owner termination', windows, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-owner-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/owner-guard-child.js', import.meta.url)), root], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const ended = once(child, 'close');
  try {
    const [data] = await once(child.stdout, 'data'); assert.match(String(data), /ready/);
    const marker = await readFile(path.join(root, 'owner.lock'), 'utf8');
    await assert.rejects(OwnerGuard.acquire(root), { code: 'STORE_BUSY' });
    child.kill(); await ended;
    const recovered = await OwnerGuard.acquire(root);
    assert.equal(recovered.token, marker);
    await recovered.close();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended; await rm(root, { recursive: true, force: true });
  }
});
