import { mkdir, mkdtemp, writeFile, readFile, copyFile, readdir, lstat, symlink, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = 'D:/MC_start/OUCL/tmp/file-guard-r2-20261116';
const evidence = path.resolve('docs/execution/20261116-r2/native-evidence');
await mkdir(root, { recursive: true }); await mkdir(evidence, { recursive: true });
const base = await mkdtemp(path.join(root, 'junction-probe-')); const target = path.join(base, 'external-target'); const junction = path.join(base, 'junction');
await mkdir(target); await writeFile(path.join(target, 'sentinel.txt'), 'preserve-external-bytes');
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const before = { files: await readdir(target), sha256: await digest(path.join(target, 'sentinel.txt')) };
const status = { base, before, nativeGuardSha256: await digest('spikes/distribution-file-guard/v2/NativeGuard.cs') };
try { await symlink(target, junction, 'junction'); }
catch (error) {
  Object.assign(status, { status: 'NOT_EXERCISED', code: error.code, syscall: error.syscall });
  await writeFile(path.join(evidence, 'junction-status.json'), JSON.stringify(status, null, 2)); console.log(JSON.stringify(status)); process.exit(2);
}
Object.assign(status, { junction: { isSymbolicLink: (await lstat(junction)).isSymbolicLink(), resolvedLink: await readlink(junction) } });
await copyFile('spikes/distribution-file-guard/v2/NativeGuard.cs', path.join(root, 'JunctionNativeGuard.cs'));
await copyFile('spikes/distribution-file-guard/v2/JunctionProbe.cs', path.join(root, 'JunctionProbe.cs'));
const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const args = ['/nologo', '/platform:x64', '/r:System.Web.Extensions.dll', '/out:junction-probe.exe', 'JunctionNativeGuard.cs', 'JunctionProbe.cs'];
const compile = spawnSync(compiler, args, { cwd: root, windowsHide: true });
await writeFile(path.join(evidence, 'junction-compile.stdout.log'), compile.stdout ?? Buffer.alloc(0));
await writeFile(path.join(evidence, 'junction-compile.stderr.log'), compile.stderr ?? Buffer.alloc(0));
Object.assign(status, { compiler, args, compileExitCode: compile.status });
if (compile.status !== 0) { await writeFile(path.join(evidence, 'junction-status.json'), JSON.stringify(status, null, 2)); process.exit(compile.status ?? 1); }
const result = spawnSync(path.join(root, 'junction-probe.exe'), [junction], { cwd: root, windowsHide: true, timeout: 10000 });
await writeFile(path.join(evidence, 'junction.stdout.json'), result.stdout ?? Buffer.alloc(0));
await writeFile(path.join(evidence, 'junction.stderr.log'), result.stderr ?? Buffer.alloc(0));
const parsed = JSON.parse(result.stdout.toString('utf8'));
const after = { files: await readdir(target), sha256: await digest(path.join(target, 'sentinel.txt')) };
Object.assign(status, { exitCode: result.status, native: parsed, after, targetUnchanged: JSON.stringify(before) === JSON.stringify(after),
  executableSha256: await digest(path.join(root, 'junction-probe.exe')), probeSha256: await digest('spikes/distribution-file-guard/v2/JunctionProbe.cs') });
await writeFile(path.join(evidence, 'junction-status.json'), JSON.stringify(status, null, 2));
console.log(JSON.stringify(status, null, 2)); process.exitCode = result.status === 0 && status.targetUnchanged ? 0 : 1;
