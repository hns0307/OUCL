import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JavaProbe, parseJavaProperties } from '../src/services/java/probe.js';
import type { JavaProbeProcess, JavaStartOptions } from '../src/services/java/probe.js';

function properties(version = '17.0.12', specification = '17'): string {
  return `Property settings:\n    java.version = ${version}\n    java.specification.version = ${specification}\n    java.vendor = Oracle Corporation\n    os.arch = amd64\n    os.name = Windows 11\n    sun.arch.data.model = 64\njava version "${version}"\nJava HotSpot(TM) 64-Bit Server VM\n`;
}
class FakeJava extends EventEmitter implements JavaProbeProcess {
  stdout = new PassThrough(); stderr = new PassThrough(); kills = 0;
  kill(signal: NodeJS.Signals): boolean { assert.equal(signal, 'SIGKILL'); this.kills++; return true; }
  finish(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.stdout.end(); this.stderr.end(); this.emit('close', code, signal);
  }
}
const executable = path.resolve('fixture-java', 'java.exe');
function mocked(child: FakeJava, inspect: (file: string) => Promise<void> = async () => {}): JavaProbe {
  return new JavaProbe({ inspect, start: () => child });
}
async function turn(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }

test('Java properties parse supported 8/17/21 versions and explicit Windows x64 metadata', () => {
  assert.deepEqual(parseJavaProperties(properties()), { major: 17, version: '17.0.12', vendor: 'Oracle Corporation', architecture: 'x64', os: 'windows' });
  assert.equal(parseJavaProperties(properties('1.8.0_421', '1.8')).major, 8);
  assert.equal(parseJavaProperties(properties('21.0.4+7-LTS', '21').replace('amd64', 'x86_64')).major, 21);
});

test('Java properties refuse incompatible majors, architecture, OS and inconsistent specification', () => {
  for (const output of [properties('11.0.2', '11'), properties('17.0.12', '21'), properties().replace('amd64', 'x86'),
    properties().replace('amd64', 'aarch64'), properties().replace('Windows 11', 'Linux'), properties().replace('model = 64', 'model = 32'),
    properties('8.0.1', '1.8'), properties('1.17.0', '17'), properties('1.8.01', '1.8')]) {
    assert.throws(() => parseJavaProperties(output), { code: 'UNSUPPORTED_JAVA' });
  }
});

test('Java properties cannot use banners, duplicate properties, malformed versions or private text as runtime evidence', () => {
  for (const output of ['openjdk version "17.0.12"\n64-Bit Server VM', properties() + 'java.version = 21\n',
    properties('17;private-secret', '17'), properties().replace('Oracle Corporation', 'private\0secret')]) {
    assert.throws(() => parseJavaProperties(output), { code: 'INVALID_JAVA' });
  }
  assert.throws(() => parseJavaProperties('x'.repeat(65537)), { code: 'OUTPUT_LIMIT' });
});

test('Java probe uses exact non-shell argv, hidden child and removes ambient agent injection settings', async () => {
  const child = new FakeJava(); let captured: JavaStartOptions | undefined;
  const previous = process.env.JAVA_TOOL_OPTIONS; process.env.JAVA_TOOL_OPTIONS = '-javaagent:private-agent';
  try {
    const probe = new JavaProbe({ inspect: async file => { assert.equal(file, executable); }, start: (file, args, options) => {
      assert.equal(file, executable); assert.deepEqual(args, ['-XshowSettings:properties', '-version']); captured = options; return child;
    } });
    const result = probe.probe(executable); await turn();
    child.stderr.write(properties()); child.finish();
    assert.equal((await result).executable, executable);
    assert.ok(captured); assert.equal(captured.shell, false); assert.equal(captured.windowsHide, true); assert.equal(captured.cwd, path.dirname(executable));
    assert.deepEqual(captured.stdio, ['ignore', 'pipe', 'pipe']); assert.equal(captured.env.JAVA_TOOL_OPTIONS, undefined);
  } finally { if (previous === undefined) delete process.env.JAVA_TOOL_OPTIONS; else process.env.JAVA_TOOL_OPTIONS = previous; }
});

test('Java cancellation kills and joins close rather than reporting termination immediately', async () => {
  const child = new FakeJava(); const controller = new AbortController(); let settled = false;
  const result = mocked(child).probe(executable, { signal: controller.signal }); void result.then(() => { settled = true; }, () => { settled = true; });
  await turn(); controller.abort(); await turn(); assert.equal(child.kills, 1); assert.equal(settled, false);
  child.finish(null, 'SIGKILL'); await assert.rejects(result, { code: 'CANCELLED' });
});

test('Java timeout and combined output budget terminate and await child close', async () => {
  for (const scenario of ['timeout', 'output'] as const) {
    const child = new FakeJava(); let settled = false;
    const result = mocked(child).probe(executable, { timeoutMs: scenario === 'timeout' ? 5 : 8000 });
    void result.then(() => { settled = true; }, () => { settled = true; }); await turn();
    if (scenario === 'timeout') await new Promise<void>(resolve => setTimeout(resolve, 15));
    else { child.stdout.write(Buffer.alloc(32768)); child.stderr.write(Buffer.alloc(32769)); }
    await turn(); assert.equal(child.kills, 1); assert.equal(settled, false);
    child.finish(null, 'SIGKILL'); await assert.rejects(result, { code: scenario === 'timeout' ? 'TIMEOUT' : 'OUTPUT_LIMIT' });
  }
});

test('Java probe rejects nonzero exit, spawn errors and malformed UTF8 without exposing diagnostics', async () => {
  for (const scenario of ['exit', 'spawn', 'encoding'] as const) {
    const child = new FakeJava(); const result = mocked(child).probe(executable); await turn();
    if (scenario === 'exit') { child.stderr.write('private-path/token'); child.finish(1); }
    if (scenario === 'spawn') { child.emit('error', new Error('private-path/token')); child.finish(-1); }
    if (scenario === 'encoding') { child.stderr.write(Buffer.from([0xff])); child.finish(); }
    await assert.rejects(result, error => {
      assert.ok(error instanceof Error); assert.equal(error.message, scenario === 'encoding' ? 'INVALID_JAVA' : 'PROBE_FAILED'); return true;
    });
  }
});

test('Java probe ignores local-code-page paths and strictly decodes recognized property values', async () => {
  const pathProbe = new FakeJava();
  const valid = mocked(pathProbe).probe(executable);
  await turn();
  pathProbe.stderr.write(Buffer.concat([Buffer.from(properties() + '    java.home = D:/'), Buffer.from([0xd6, 0xd0]), Buffer.from('/jdk\n')]));
  pathProbe.finish();
  assert.equal((await valid).major, 17);

  const vendorProbe = new FakeJava();
  const invalid = mocked(vendorProbe).probe(executable);
  const rejection = assert.rejects(invalid, { code: 'INVALID_JAVA' });
  await turn();
  const [before, after] = properties().split('Oracle Corporation');
  vendorProbe.stderr.write(Buffer.concat([Buffer.from(before!), Buffer.from([0xff]), Buffer.from(after!)]));
  vendorProbe.finish();
  await rejection;
});

test('Java probe rejects unselected paths and cancelled/invalid inspections before spawning', async () => {
  let starts = 0; const probe = new JavaProbe({ inspect: async () => { throw new Error('private-directory'); }, start: () => { starts++; return new FakeJava(); } });
  for (const file of ['java.exe', path.resolve('java.cmd'), executable + '\0']) await assert.rejects(probe.probe(file), { code: 'INVALID_JAVA' });
  await assert.rejects(probe.probe(executable), { code: 'INVALID_JAVA' });
  const controller = new AbortController(); controller.abort(); await assert.rejects(probe.probe(executable, { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(starts, 0);
});

test('Java default inspection requires an actual nonempty regular executable path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-java-probe-')); const file = path.join(root, 'java.exe'); let starts = 0;
  try {
    const child = new FakeJava(); const probe = new JavaProbe({ start: () => { starts++; return child; } });
    await assert.rejects(probe.probe(file), { code: 'INVALID_JAVA' });
    await writeFile(file, ''); await assert.rejects(probe.probe(file), { code: 'INVALID_JAVA' });
    await writeFile(file, 'fixture bytes, not executed'); const result = probe.probe(file);
    const deadline = Date.now() + 5000;
    while (starts === 0) { if (Date.now() > deadline) throw new Error('TEST_PROBE_NOT_STARTED'); await turn(); }
    child.stderr.write(properties()); child.finish();
    assert.equal((await result).major, 17); assert.equal(starts, 1);
  } finally { assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
});

test('Java default inspection refuses a directory even when named java.exe', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-java-probe-'));
  try {
    const file = path.join(root, 'java.exe'); await mkdir(file); await assert.rejects(new JavaProbe().probe(file), { code: 'INVALID_JAVA' });
  } finally { assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
});
