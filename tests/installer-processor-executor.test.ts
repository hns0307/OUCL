import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { InstallerProcessorExecutor, ProcessorExecutionError } from '../src/services/loaders/processor-executor.js';
import type { InstallerProcessorPlan } from '../src/services/loaders/processor-plan.js';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough(); readonly stderr = new PassThrough(); readonly stdin = new PassThrough();
  readonly kills: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean { this.kills.push(signal); return true; }
  close(code: number | null, signal: NodeJS.Signals | null = null): void { this.emit('close', code, signal); }
}
const plan = (): InstallerProcessorPlan => ({ workspace: process.cwd(), commands: [{ role: 'apply-client-patches', tool: 'tool.jar',
  mainClass: 'safe.Main', classpath: ['tool.jar', 'dependency.jar'], arguments: ['--output', 'output.jar'],
  outputs: [{ file: 'output.jar', expectedSha1: 'a'.repeat(40) }] }] });
const runtime = { executable: 'java.exe', major: 17 as const, version: '17', vendor: 'test', architecture: 'x64' as const, os: 'windows' as const };

test('executes with a clean environment and records upstream and local proof separately', async () => {
  const child = new FakeChild(); const starts: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  process.env.JAVA_TOOL_OPTIONS = '-javaagent:evil.jar';
  const executor = new InstallerProcessorExecutor({ probe: { probe: async () => runtime },
    hash: { hash: async () => ({ size: 10, sha1: 'a'.repeat(40), sha256: 'b'.repeat(64) }) }, validateArchive: async () => {},
    inspect: async () => 'missing', start: (_file, args, options) => { starts.push({ args, env: options.env }); queueMicrotask(() => child.close(0)); return child as unknown as ChildProcessWithoutNullStreams; } });
  try {
    const evidence = await executor.run('java.exe', 17, plan());
    assert.equal(starts[0]?.env.JAVA_TOOL_OPTIONS, undefined); assert.deepEqual(starts[0]?.args.slice(0, 3), ['-cp', ['tool.jar', 'dependency.jar'].join(process.platform === 'win32' ? ';' : ':'), 'safe.Main']);
    assert.equal(evidence[0]?.outputs[0]?.upstreamSha1, 'a'.repeat(40)); assert.equal(evidence[0]?.outputs[0]?.sha256, 'b'.repeat(64));
  } finally { delete process.env.JAVA_TOOL_OPTIONS; }
});

test('cancellation terminates and waits for child close before rejecting', async () => {
  const child = new FakeChild(); const controller = new AbortController(); let settled = false;
  const executor = new InstallerProcessorExecutor({ probe: { probe: async () => runtime }, hash: { hash: async () => { throw new Error(); } },
    validateArchive: async () => {}, inspect: async () => 'missing', start: () => child as unknown as ChildProcessWithoutNullStreams }, 1000, 20);
  const running = executor.run('java.exe', 17, plan(), controller.signal).finally(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(child.kills, ['SIGTERM']); assert.equal(settled, false);
  child.close(null, 'SIGTERM');
  await assert.rejects(running, error => error instanceof ProcessorExecutionError && error.code === 'CANCELLED');
});

test('refuses existing outputs, wrong hashes and excessive child output', async () => {
  const existing = new InstallerProcessorExecutor({ probe: { probe: async () => runtime }, hash: { hash: async () => ({ size: 1, sha1: 'a'.repeat(40), sha256: 'b'.repeat(64) }) },
    validateArchive: async () => {}, inspect: async () => 'file', start: () => new FakeChild() as unknown as ChildProcessWithoutNullStreams });
  await assert.rejects(existing.run('java.exe', 17, plan()), error => error instanceof ProcessorExecutionError && error.code === 'OUTPUT_INVALID');
  const completed = new FakeChild(); const wrongHash = new InstallerProcessorExecutor({ probe: { probe: async () => runtime },
    hash: { hash: async () => ({ size: 1, sha1: '0'.repeat(40), sha256: 'b'.repeat(64) }) }, validateArchive: async () => {}, inspect: async () => 'missing',
    start: () => { queueMicrotask(() => completed.close(0)); return completed as unknown as ChildProcessWithoutNullStreams; } });
  await assert.rejects(wrongHash.run('java.exe', 17, plan()), error => error instanceof ProcessorExecutionError && error.code === 'OUTPUT_INVALID');
  const child = new FakeChild(); const overflow = new InstallerProcessorExecutor({ probe: { probe: async () => runtime }, hash: { hash: async () => ({ size: 1, sha1: '0'.repeat(40), sha256: 'b'.repeat(64) }) },
    validateArchive: async () => {}, inspect: async () => 'missing', start: () => { queueMicrotask(() => { child.stdout.write(Buffer.alloc(128 * 1024 + 1)); child.close(null, 'SIGTERM'); }); return child as unknown as ChildProcessWithoutNullStreams; } });
  await assert.rejects(overflow.run('java.exe', 17, plan()), error => error instanceof ProcessorExecutionError && error.code === 'OUTPUT_LIMIT');
});
