import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { GameProcessService } from '../src/services/launch/process.js';
import type { JavaRuntime } from '../src/services/java/probe.js';
import type { LaunchPlan } from '../src/core/launch/plan.js';

const id = '00000000-0000-4000-8000-000000000001';
class FakeProcess extends EventEmitter {
  stdout = new PassThrough(); stderr = new PassThrough(); stdin = new PassThrough(); kills: string[] = [];
  kill(signal: string): boolean { this.kills.push(signal); queueMicrotask(() => { this.emit('close', null, 'SIGKILL'); }); return true; }
}
const runtime: JavaRuntime = { major: 17, version: '17.0.12', vendor: 'fixture', architecture: 'x64', os: 'windows', executable: 'D:\\Fixture\\java.exe' };
async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'oucl-game-process-'));
  try { await run(directory); } finally {
    assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith('oucl-game-process-'));
    await rm(directory, { recursive: true, force: true });
  }
}
function plan(directory: string): LaunchPlan { return { executableRef: id, args: ['-Xmx1024M', 'net.minecraft.client.main.Main', '--username', 'PrivateName'], cwd: directory, redactedPreview: [] }; }
test('spawn is real acceptance boundary, fixed options remove ambient Java injection and close releases lease', () => fixture(async directory => {
  const child = new FakeProcess(); let started = false;
  const canonical = await realpath(directory);
  const previous = process.env.JAVA_TOOL_OPTIONS; process.env.JAVA_TOOL_OPTIONS = '-javaagent:untrusted';
  const service = new GameProcessService({ probe: { probe: async () => runtime }, start: (file, args, options) => {
    started = true; assert.equal(file, runtime.executable); assert.deepEqual(args, plan(directory).args);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true); assert.equal(options.cwd, canonical);
    assert.equal(options.env.JAVA_TOOL_OPTIONS, undefined); assert.equal(options.stdio, 'pipe');
    queueMicrotask(() => { child.emit('spawn'); }); return child as unknown as ChildProcessWithoutNullStreams;
  } });
  try {
    const session = await service.launch(id, runtime.executable, 17, plan(directory)); assert.ok(started); assert.equal(session.state, 'running');
    assert.ok(await readFile(path.join(directory, 'oucl.session.lock'), 'utf8'));
    child.stdout.write('Setting user: PrivateName\nBackend library: private path\nsecret accessToken=xxx\nSound engine started\n');
    child.stderr.write('Created: textures/atlas/blocks.png-atlas\n');
    assert.deepEqual(service.diagnostics(session.sessionId), ['game:identity-bound', 'game:renderer-initializing', 'game:sound-ready', 'game:blocks-atlas-ready']);
    child.emit('close', 0, null); const exited = await service.wait(session.sessionId); assert.equal(exited.state, 'exited'); assert.equal(exited.exitCode, 0);
    await assert.rejects(readFile(path.join(directory, 'oucl.session.lock')), { code: 'ENOENT' });
  } finally { if (previous === undefined) delete process.env.JAVA_TOOL_OPTIONS; else process.env.JAVA_TOOL_OPTIONS = previous; }
}));
test('gameDir lease excludes another instance and foreign marker is never removed', () => fixture(async directory => {
  const lock = path.join(directory, 'oucl.session.lock'); await writeFile(lock, 'foreign');
  const service = new GameProcessService({ probe: { probe: async () => runtime }, start: () => { throw new Error('must not spawn'); } });
  await assert.rejects(service.launch(id, runtime.executable, 17, plan(directory)), { code: 'INSTANCE_BUSY' });
  assert.equal(await readFile(lock, 'utf8'), 'foreign');
}));
test('spawn exception and asynchronous start failure leave no falsely running session or lease', () => fixture(async directory => {
  const synchronous = new GameProcessService({ probe: { probe: async () => runtime }, start: () => { throw new Error('private diagnostic'); } });
  await assert.rejects(synchronous.launch(id, runtime.executable, 17, plan(directory)), { code: 'LAUNCH_FAILED' });
  await assert.rejects(readFile(path.join(directory, 'oucl.session.lock')), { code: 'ENOENT' });
  const child = new FakeProcess();
  const asynchronous = new GameProcessService({ probe: { probe: async () => runtime }, start: () => {
    queueMicrotask(() => { child.emit('error', new Error('private')); child.emit('close', -1, null); }); return child as unknown as ChildProcessWithoutNullStreams;
  } });
  await assert.rejects(asynchronous.launch(id, runtime.executable, 17, plan(directory)), { code: 'LAUNCH_FAILED' });
  await assert.rejects(readFile(path.join(directory, 'oucl.session.lock')), { code: 'ENOENT' });
}));
test('only explicit confirmed force stop kills; graceful rejection preserves the live JVM', () => fixture(async directory => {
  const child = new FakeProcess(); const service = new GameProcessService({ probe: { probe: async () => runtime }, start: () => {
    queueMicrotask(() => { child.emit('spawn'); }); return child as unknown as ChildProcessWithoutNullStreams;
  } });
  const session = await service.launch(id, runtime.executable, 17, plan(directory));
  await assert.rejects(service.stop(session.sessionId, 'graceful', true), { code: 'STOP_UNSUPPORTED' });
  await assert.rejects(service.stop(session.sessionId, 'force', false), { code: 'CONFIRMATION_REQUIRED' }); assert.equal(child.kills.length, 0);
  const stopped = await service.stop(session.sessionId, 'force', true); assert.equal(stopped.state, 'exited'); assert.deepEqual(child.kills, ['SIGKILL']);
  assert.equal((await service.stop(session.sessionId, 'force', false)).state, 'exited');
  assert.throws(() => service.get('missing'), { code: 'SESSION_NOT_FOUND' });
}));
test('changed lease after process exit remains unknown and blocks future launches', () => fixture(async directory => {
  const child = new FakeProcess(); const service = new GameProcessService({ probe: { probe: async () => runtime }, start: () => {
    queueMicrotask(() => { child.emit('spawn'); }); return child as unknown as ChildProcessWithoutNullStreams;
  } });
  const session = await service.launch(id, runtime.executable, 17, plan(directory));
  const lock = path.join(directory, 'oucl.session.lock'); await unlink(lock); await writeFile(lock, 'other-owner');
  child.emit('close', 0, null); assert.equal((await service.wait(session.sessionId)).state, 'unknown');
  assert.equal(await readFile(lock, 'utf8'), 'other-owner');
  await assert.rejects(service.stop(session.sessionId, 'force', true), { code: 'NEEDS_RECOVERY' });
}));
test('Java mismatch, failed probe and pre-spawn cancellation cannot create game effects', () => fixture(async directory => {
  const service = new GameProcessService({ probe: { probe: async () => runtime } });
  await assert.rejects(service.launch(id, runtime.executable, 21, plan(directory)), { code: 'JAVA_INCOMPATIBLE' });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(service.launch(id, runtime.executable, 17, plan(directory), { signal: abort.signal }), { code: 'CANCELLED' });
  const bad = new GameProcessService({ probe: { probe: async () => { throw new Error('private'); } } });
  await assert.rejects(bad.launch(id, runtime.executable, 17, plan(directory)), { code: 'JAVA_INCOMPATIBLE' });
  await assert.rejects(service.launch('bad', runtime.executable, 17, plan(directory)), { code: 'LAUNCH_FAILED' });
}));
