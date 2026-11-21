import { mkdir, mkdtemp, symlink, writeFile, readFile, copyFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
if (process.argv.length > 2) throw new Error('One metadata-anchor diagnostic only');
const round = 'anchor-share3';
const mode = 'metadata';
const root = 'D:/MC_start/OUCL/tmp/file-guard-v4-20261116';
const evidence = path.resolve('spikes/distribution-file-guard/v4/native-stats');
await mkdir(root, { recursive: true }); await mkdir(evidence, { recursive: true });
const fixture = await mkdtemp(path.join(root, 'fixture-')); const external = path.join(fixture, 'external'); await mkdir(external);
await writeFile(path.join(external, 'sentinel.txt'), 'preserve-preexisting-junction'); const junction = path.join(fixture, 'junction');
await symlink(external, junction, 'junction');
for (const name of ['RelativeNative.cs', 'Program.cs']) {
  await copyFile(`spikes/distribution-file-guard/v4/${name}`, path.join(root, name));
  await copyFile(`spikes/distribution-file-guard/v4/${name}`, path.join(evidence, `${round}-${name}`));
}
const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const args = ['/nologo', '/platform:x64', '/r:System.Web.Extensions.dll', '/out:relative-spike.exe', 'RelativeNative.cs', 'Program.cs'];
const compile = spawnSync(compiler, args, { cwd: root, windowsHide: true });
await writeFile(path.join(evidence, `${round}-compile.stdout.log`), compile.stdout ?? Buffer.alloc(0));
await writeFile(path.join(evidence, `${round}-compile.stderr.log`), compile.stderr ?? Buffer.alloc(0));
const status = { round, mode, compileExitCode: compile.status, compiler, args, fixture, preexistingJunction: (await lstat(junction)).isSymbolicLink() };
if (compile.status !== 0) { await writeFile(path.join(evidence, `${round}-status.json`), JSON.stringify(status, null, 2)); console.log(status); process.exit(compile.status ?? 1); }
const result = spawnSync(path.join(root, 'relative-spike.exe'), [path.join(root, 'cases'), mode, junction], { cwd: root, windowsHide: true, timeout: 60000 });
await writeFile(path.join(evidence, `${round}.stdout.json`), result.stdout ?? Buffer.alloc(0));
await writeFile(path.join(evidence, `${round}.stderr.log`), result.stderr ?? Buffer.alloc(0));
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const parsed = JSON.parse(result.stdout.toString('utf8'));
Object.assign(status, { exitCode: result.status, signal: result.signal, error: result.error?.message, executableSha256: await digest(path.join(root, 'relative-spike.exe')),
  nativeSourceSha256: await digest(path.join(root, 'RelativeNative.cs')), programSha256: await digest(path.join(root, 'Program.cs')),
  preexistingJunctionSentinelPreserved: (await readFile(path.join(external, 'sentinel.txt'), 'utf8')) === 'preserve-preexisting-junction' });
const renamed = parsed.results.find(item => item.name === 'relative child open and native rename preserve exact proof');
if (renamed.status === 'PASS') {
  const proof = renamed.details.proof; const file = renamed.details.target; const info = await lstat(file, { bigint: true });
  const node = { dev: String(info.dev), ino: String(info.ino), size: Number(info.size), sha256: await digest(file) };
  Object.assign(status, { crossLanguage: { native: proof, node, equal: proof.dev === node.dev && proof.ino === node.ino && proof.size === node.size && proof.sha256 === node.sha256 } });
}
await writeFile(path.join(evidence, `${round}-status.json`), JSON.stringify(status, null, 2));
console.log(JSON.stringify({ ...status, summary: { cases: parsed.cases, pass: parsed.pass, fail: parsed.fail, notExercised: parsed.notExercised }, results: parsed.results }, null, 2)); process.exitCode = result.status ?? 1;
