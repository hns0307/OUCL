import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, lstat, readFile, writeFile, link, unlink, rename, symlink } from 'node:fs/promises';
import path from 'node:path';

const supported = process.platform === 'win32' && process.arch === 'x64';
const sourceRoot = path.resolve(process.env.OUCL_SOURCE_ROOT ?? process.cwd());
const testRoot = path.resolve(process.env.OUCL_TEST_ROOT ?? 'tmp', 'distribution-native-helper');
let build: Promise<string> | undefined;
async function executable(): Promise<string> {
  build ??= (async () => {
    const output = path.join(testRoot, 'build'); await mkdir(output, { recursive: true });
    const result = spawnSync(process.execPath, ['scripts/build-distribution-files.mjs'], { cwd: sourceRoot,
      env: { ...process.env, OUCL_BUILD_ROOT: output }, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`); return path.join(output, 'native/distribution-files.exe');
  })(); return build;
}
interface Proof { dev: string; ino: string; sha256: string; size: number }
interface NativeRequest {
  version: 1; operation: 'rename' | 'link' | 'delete' | 'release'; root: string; txId: string;
  rootIdentity: { dev: string; ino: string }; leaseToken: string; source: string; destination?: string; expected: Proof;
}
async function proof(file: string): Promise<Proof> {
  const info = await lstat(file, { bigint: true });
  return { dev: String(info.dev), ino: String(info.ino), sha256: createHash('sha256').update(await readFile(file)).digest('hex'), size: Number(info.size) };
}
async function raw(input: string | Uint8Array, args: string[] = []) {
  const child = spawn(await executable(), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; }); child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const completed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  child.stdin.on('error', () => { /* Oversized input may be refused before all pipe bytes are read. */ }); child.stdin.end(input);
  const exitCode = await completed;
  assert.ok(Buffer.byteLength(stdout) <= 4096); assert.equal(stderr, '');
  const response: unknown = JSON.parse(stdout);
  assert.ok(response && typeof response === 'object' && 'version' in response && response.version === 1 && 'ok' in response && typeof response.ok === 'boolean');
  return { exitCode, stdout, response: response as { version: 1; ok: boolean; code?: string } };
}
const invoke = (request: NativeRequest) => raw(JSON.stringify(request));
async function fixture() {
  await mkdir(testRoot, { recursive: true }); const root = await mkdtemp(path.join(testRoot, 'case-')); const txId = randomUUID(), token = randomUUID();
  const mods = path.join(root, 'mods'); const stage = path.join(root, '.oucl-distribution-staging', txId);
  await mkdir(mods); await mkdir(stage, { recursive: true });
  const source = path.join(stage, '0.new'); await writeFile(source, 'owned fixture bytes');
  const lease = path.join(root, 'oucl.session.lock'); await writeFile(lease, token);
  const identity = await lstat(root, { bigint: true });
  const request: NativeRequest = { version: 1, operation: 'link', root, txId, rootIdentity: { dev: String(identity.dev), ino: String(identity.ino) },
    leaseToken: token, source, destination: path.join(mods, 'owned.jar'), expected: await proof(source) };
  return { root, mods, stage, source, lease, request };
}

test('native helper accepts Node dev/ino/SHA proof and publishes exactly one protected hardlink', { skip: !supported }, async () => {
  const f = await fixture(); const result = await invoke(f.request); assert.equal(result.exitCode, 0); assert.deepEqual(result.response, { version: 1, ok: true });
  assert.deepEqual(await proof(f.request.destination!), f.request.expected);
  assert.equal((await lstat(f.source)).nlink, 2); assert.equal(await readFile(f.lease, 'utf8'), f.request.leaseToken);
});
test('native helper accepts valid v7 transaction and lease UUIDs used by the shared contract', { skip: !supported }, async () => {
  const f = await fixture(); const txId = f.request.txId.slice(0, 14) + '7' + f.request.txId.slice(15);
  const leaseToken = f.request.leaseToken.slice(0, 14) + '7' + f.request.leaseToken.slice(15);
  const nextStage = path.join(path.dirname(f.stage), txId); await rename(f.stage, nextStage); await writeFile(f.lease, leaseToken);
  const result = await invoke({ ...f.request, txId, leaseToken, source: path.join(nextStage, '0.new') });
  assert.equal(result.exitCode, 0); assert.deepEqual(await proof(f.request.destination!), f.request.expected);
});
test('native no-replace rename and link preserve a preoccupied destination', { skip: !supported }, async () => {
  for (const operation of ['rename', 'link'] as const) {
    const f = await fixture(); await writeFile(f.request.destination!, 'foreign winner');
    const result = await invoke({ ...f.request, operation }); assert.equal(result.exitCode, 1); assert.equal(result.response.code, 'DESTINATION_EXISTS');
    assert.equal(await readFile(f.source, 'utf8'), 'owned fixture bytes'); assert.equal(await readFile(f.request.destination!, 'utf8'), 'foreign winner');
  }
});
test('native same-handle rename preserves Node inode and hash', { skip: !supported }, async () => {
  const f = await fixture(); const result = await invoke({ ...f.request, operation: 'rename' }); assert.equal(result.exitCode, 0);
  assert.deepEqual(await proof(f.request.destination!), f.request.expected); await assert.rejects(lstat(f.source), { code: 'ENOENT' });
});
test('native delete removes one proven alias without deleting its live published pair', { skip: !supported }, async () => {
  const f = await fixture(); assert.equal((await invoke(f.request)).exitCode, 0);
  const { destination: _unused, ...request } = f.request; assert.ok(_unused);
  assert.equal((await invoke({ ...request, operation: 'delete' })).exitCode, 0);
  await assert.rejects(lstat(f.source), { code: 'ENOENT' }); assert.deepEqual(await proof(f.request.destination!), f.request.expected);
  assert.equal((await lstat(f.request.destination!)).nlink, 1);
});
test('native lease release reuses its protected source handle and rejects a wrong token', { skip: !supported }, async () => {
  const f = await fixture(); const { destination: _unused, ...base } = f.request; assert.ok(_unused);
  const request: NativeRequest = { ...base, operation: 'release', source: f.lease, expected: await proof(f.lease) };
  assert.equal((await invoke({ ...request, leaseToken: randomUUID() })).response.code, 'LEASE_MISMATCH'); assert.equal(await readFile(f.lease, 'utf8'), f.request.leaseToken);
  assert.equal((await invoke(request)).exitCode, 0); await assert.rejects(lstat(f.lease), { code: 'ENOENT' });
});
test('native helper refuses a replaced source or wrong proof without deleting replacement bytes', { skip: !supported }, async () => {
  const f = await fixture(); await unlink(f.source); await writeFile(f.source, 'foreign replacement');
  const { destination: _unused, ...base } = f.request; assert.ok(_unused);
  assert.equal((await invoke({ ...base, operation: 'delete' })).response.code, 'PROOF_MISMATCH'); assert.equal(await readFile(f.source, 'utf8'), 'foreign replacement');
});
test('native root identity and lease gates precede mutation', { skip: !supported }, async () => {
  const f = await fixture();
  assert.equal((await invoke({ ...f.request, rootIdentity: { ...f.request.rootIdentity, ino: '1' } })).response.code, 'ROOT_CHANGED');
  assert.equal((await invoke({ ...f.request, leaseToken: randomUUID() })).response.code, 'LEASE_MISMATCH');
  assert.deepEqual(await proof(f.source), f.request.expected); await assert.rejects(lstat(f.request.destination!), { code: 'ENOENT' });
});
test('native helper refuses unknown third hardlinks', { skip: !supported }, async () => {
  const f = await fixture(); await link(f.source, path.join(f.stage, '1.new')); await link(f.source, path.join(f.stage, '2.new'));
  assert.equal((await invoke(f.request)).response.code, 'UNSAFE_PATH'); assert.equal((await lstat(f.source)).nlink, 3);
});
test('native schema rejects extra/duplicate fields, unbounded input, invalid UTF8 and future versions', { skip: !supported }, async () => {
  const f = await fixture(); const text = JSON.stringify(f.request);
  for (const input of [JSON.stringify({ ...f.request, unexpected: true }), text.replace('"version":1', '"version":1,"version":1'),
    `${text} null`, '[]', 'x'.repeat(16385), Buffer.from([0xff]), JSON.stringify({ ...f.request, expected: { ...f.request.expected, size: -1 } }),
    JSON.stringify({ ...f.request, txId: 'not-a-uuid' }), JSON.stringify({ ...f.request, expected: { ...f.request.expected, sha256: 'z'.repeat(64) } })]) {
    const result = await raw(input); assert.equal(result.exitCode, 1); assert.equal(result.response.code, 'INVALID_REQUEST'); assert.ok(!result.stdout.includes(f.root));
  }
  assert.equal((await raw(JSON.stringify({ ...f.request, version: 2 }))).response.code, 'UNSUPPORTED_VERSION');
  assert.equal((await raw(text, ['arbitrary-command'])).response.code, 'INVALID_REQUEST');
});
test('native paths reject foreign transaction staging, traversal, ADS, cross-volume and unrelated files', { skip: !supported }, async () => {
  const f = await fixture();
  for (const source of [path.join(f.root, '.oucl-distribution-staging', randomUUID(), '0.new'), `${f.mods}\\..\\oucl.session.lock`,
    path.join(f.mods, 'file.jar:stream'), path.join(f.root, 'saves', 'world.dat'), 'C:\\outside\\file.jar']) {
    const result = await invoke({ ...f.request, source }); assert.equal(result.response.code, 'UNSAFE_PATH', source);
  }
  const { destination: _unused, ...base } = f.request; assert.ok(_unused);
  assert.equal((await invoke({ ...base, operation: 'release' })).response.code, 'UNSAFE_PATH');
});
test('native helper rejects a real junction ancestor before touching its sentinel', { skip: !supported }, async () => {
  const f = await fixture(); const external = path.join(f.root, 'external'); await mkdir(external); const sentinel = path.join(external, 'sentinel.jar'); await writeFile(sentinel, 'keep');
  const junction = path.join(f.mods, 'alias'); await symlink(external, junction, 'junction');
  const request = { ...f.request, source: path.join(junction, 'sentinel.jar'), expected: await proof(sentinel) };
  assert.equal((await invoke(request)).response.code, 'UNSAFE_PATH'); assert.equal(await readFile(sentinel, 'utf8'), 'keep');
});
test('production guard source blocks source edits and ancestor renames from an independent process', { skip: !supported }, async () => {
  const f = await fixture(); const main = path.join(testRoot, 'HandleHold.cs'), hold = path.join(testRoot, 'hold.exe');
  await writeFile(main, 'using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles; internal static class HandleHold { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string file,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template); static void Main(string[] args) { if(args.Length==1) { using(var write=CreateFileW(args[0],0x40000000,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) Console.WriteLine(write.IsInvalid?Marshal.GetLastWin32Error():0); return; } using(var chain=new NativeGuard.Chain(args[0])) using(var destination=new NativeGuard.Chain(args[2])) using(var held=NativeGuard.Open(args[1],false)) { NativeGuard.Capture(held); Console.WriteLine("READY"); Console.Out.Flush(); Console.ReadLine(); } } }');
  const compiler = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const compiled = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/main:HandleHold', `/out:${hold}`, '/reference:System.dll', '/reference:System.Core.dll',
    path.join(sourceRoot, 'native/distribution-files/NativeGuard.cs'), path.join(sourceRoot, 'native/distribution-files/Program.cs'), main], { encoding: 'utf8', windowsHide: true });
  assert.equal(compiled.status, 0, `${compiled.stdout}${compiled.stderr}`);
  const child = spawn(hold, [f.stage, f.source, f.mods], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const ended = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  let output = ''; child.stdout.setEncoding('utf8');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.stdin.end('\n'); reject(new Error('HANDLE_HOLD_READY_TIMEOUT')); }, 5000);
    child.stdout.on('data', (chunk: string) => { output += chunk; if (output.includes('READY')) { clearTimeout(timer); resolve(); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (!output.includes('READY')) reject(new Error(`HANDLE_HOLD_EARLY_EXIT:${code}`)); });
  });
  try {
    // The disproven GENERIC_WRITE=32 assumption remains frozen in before-relative-v4/ and the old failed logs.
    // The v4 boundary is relative-handle no-escape, exercised by the next test, not a claim that metadata writes are impossible.
    const childFile = path.join(f.mods, 'ordinary-child.txt'); await writeFile(childFile, 'child creation remains allowed'); await unlink(childFile);
    await assert.rejects(rename(f.stage, `${f.stage}-moved`)); await assert.rejects(rename(f.root, `${f.root}-moved`));
    await assert.rejects(writeFile(f.source, 'foreign')); await assert.rejects(unlink(f.source));
    assert.equal(await readFile(f.source, 'utf8'), 'owned fixture bytes');
  } finally { child.stdin.end('\n'); assert.equal(await ended, 0); }
});
test('actual metadata-only FSCTL reparse succeeds but held-parent operations refuse and cannot escape', { skip: !supported }, async () => {
  const f = await fixture(); const external = path.join(f.root, 'external'); await mkdir(external); await writeFile(path.join(external, 'sentinel.txt'), 'preserve');
  const harness = path.join(testRoot, 'ReparseRace.cs'), binary = path.join(testRoot, 'reparse-race.exe');
  await writeFile(harness, String.raw`
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
internal static class ReparseRace {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DeviceIoControl(SafeFileHandle file,uint code,byte[] data,uint size,IntPtr output,uint outputSize,out uint written,IntPtr overlapped);
  static void Require(bool value) { if(!value) throw new Exception("RACE_BOUNDARY_FAILED"); }
  static void SetJunction(string directory,string target) {
    using(var file=CreateFileW(directory,0x100,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
      Require(!file.IsInvalid);
      byte[] substitute=Encoding.Unicode.GetBytes(@"\??\"+Path.GetFullPath(target)), print=Encoding.Unicode.GetBytes(Path.GetFullPath(target));
      byte[] data=new byte[16+substitute.Length+2+print.Length+2];
      Array.Copy(BitConverter.GetBytes(0xA0000003u),0,data,0,4); Array.Copy(BitConverter.GetBytes((ushort)(data.Length-8)),0,data,4,2);
      Array.Copy(BitConverter.GetBytes((ushort)substitute.Length),0,data,10,2); Array.Copy(BitConverter.GetBytes((ushort)(substitute.Length+2)),0,data,12,2);
      Array.Copy(BitConverter.GetBytes((ushort)print.Length),0,data,14,2); Array.Copy(substitute,0,data,16,substitute.Length); Array.Copy(print,0,data,18+substitute.Length,print.Length);
      uint written; Require(DeviceIoControl(file,0x900A4,data,(uint)data.Length,IntPtr.Zero,0,out written,IntPtr.Zero));
    }
  }
  static int Main(string[] args) {
    using(var sourceParent=new NativeGuard.Chain(Path.GetDirectoryName(args[0]))) using(var targetParent=new NativeGuard.Chain(args[1]))
    using(var source=NativeGuard.Open(sourceParent,Path.GetFileName(args[0]))) {
      var proof=NativeGuard.Capture(source,1); SetJunction(args[1],args[2]);
      bool refused=false; try { NativeGuard.Rename(source,proof,sourceParent,targetParent,Path.Combine(args[1],"checked.jar")); } catch(InvalidOperationException) { refused=true; }
      Require(refused);
      // Deliberately bypass preflight to model an attack after Verify and before the native mutation.
      int rename=NativeGuard.Name(source,proof,targetParent.LastHandle,"escaped-rename.jar",10);
      int link=NativeGuard.Name(source,proof,targetParent.LastHandle,"escaped-link.jar",11);
      Require(rename<0&&link<0); NativeGuard.Verify(source,proof);
      Require(!File.Exists(Path.Combine(args[2],"checked.jar"))&&!File.Exists(Path.Combine(args[2],"escaped-rename.jar"))&&!File.Exists(Path.Combine(args[2],"escaped-link.jar")));
      Require(File.ReadAllText(Path.Combine(args[2],"sentinel.txt"))=="preserve");
      Console.WriteLine("{\"set\":true,\"guardRefused\":true,\"renameStatus\":"+rename+",\"linkStatus\":"+link+",\"externalUnchanged\":true}");
    }
    return 0;
  }
}`);
  const compiler = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const compiled = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/main:ReparseRace', `/out:${binary}`, '/reference:System.dll', '/reference:System.Core.dll',
    path.join(sourceRoot, 'native/distribution-files/NativeGuard.cs'), path.join(sourceRoot, 'native/distribution-files/Program.cs'), harness], { encoding: 'utf8', windowsHide: true });
  assert.equal(compiled.status, 0, `${compiled.stdout}${compiled.stderr}`);
  const raced = spawnSync(binary, [f.source, f.mods, external], { encoding: 'utf8', windowsHide: true });
  await writeFile(path.join(testRoot, 'reparse-race-result.json'), raced.stdout);
  assert.equal(raced.status, 0, `${raced.stdout}${raced.stderr}`); assert.equal(raced.stderr, '');
  const result: unknown = JSON.parse(raced.stdout); assert.ok(result && typeof result === 'object' && 'set' in result && result.set === true
    && 'guardRefused' in result && result.guardRefused === true && 'externalUnchanged' in result && result.externalUnchanged === true);
  // The unmodified stdin protocol must also reject the now-reparse parent without leaking a pathname.
  const response = await invoke(f.request); assert.equal(response.response.code, 'UNSAFE_PATH'); assert.ok(!response.stdout.includes(f.root));
  assert.equal(await readFile(path.join(external, 'sentinel.txt'), 'utf8'), 'preserve'); await assert.rejects(lstat(path.join(external, 'owned.jar')), { code: 'ENOENT' });
});
