import { mkdir, copyFile, writeFile, readFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const round = process.argv[2] ?? 'round1';
if (!['round1', 'round2'].includes(round)) throw new Error('Only two bounded rounds are allowed');
const root = 'D:/MC_start/OUCL/tmp/file-guard-r2-20261116';
const evidence = path.resolve('docs/execution/20261116-r2/native-evidence');
const source = path.resolve('spikes/distribution-file-guard/v2');
await mkdir(root, { recursive: true }); await mkdir(evidence, { recursive: true });
for (const name of ['NativeGuard.cs', 'Program.cs']) await copyFile(path.join(source, name), path.join(root, name));
const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const args = ['/nologo', '/platform:x64', '/r:System.Web.Extensions.dll', '/out:file-guard-v2.exe', 'NativeGuard.cs', 'Program.cs'];
const compile = spawnSync(compiler, args, { cwd: root, windowsHide: true });
await writeFile(path.join(evidence, `${round}-compile.stdout.log`), compile.stdout ?? Buffer.alloc(0));
await writeFile(path.join(evidence, `${round}-compile.stderr.log`), compile.stderr ?? Buffer.alloc(0));
const status = { round, compiler, args, compileExitCode: compile.status, compileError: compile.error?.message, environment: 'caller tool records sandbox approval' };
if (compile.status !== 0) {
  await writeFile(path.join(evidence, `${round}-status.json`), JSON.stringify(status, null, 2));
  console.log(JSON.stringify(status)); process.exit(compile.status ?? 1);
}
const executable = path.join(root, 'file-guard-v2.exe');
const result = spawnSync(executable, [path.join(root, 'fixtures')], { cwd: root, windowsHide: true, timeout: 45000 });
// Preserve exact child bytes before parsing. Native Console.OutputEncoding is BOM-free UTF-8.
await writeFile(path.join(evidence, `${round}.stdout.json`), result.stdout ?? Buffer.alloc(0));
await writeFile(path.join(evidence, `${round}.stderr.log`), result.stderr ?? Buffer.alloc(0));
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
Object.assign(status, { exitCode: result.status, signal: result.signal, error: result.error?.message,
  executableSha256: await digest(executable), nativeGuardSha256: await digest(path.join(source, 'NativeGuard.cs')), programSha256: await digest(path.join(source, 'Program.cs')) });
const parsed = JSON.parse(result.stdout.toString('utf8'));
const rename = parsed.results.find(item => item.name === 'normal native rename retains exact inode and same-handle hash');
if (rename?.status === 'PASS') {
  const proof = rename.details.proof; const file = rename.details.target; const info = await lstat(file, { bigint: true });
  const node = { dev: String(info.dev), ino: String(info.ino), size: String(info.size), sha256: await digest(file), links: String(info.nlink) };
  Object.assign(status, { crossLanguage: { path: file, native: proof, node, equal: proof.Volume === node.dev && proof.Inode === node.ino && String(proof.Size) === node.size && proof.Sha256 === node.sha256 } });
}
await writeFile(path.join(evidence, `${round}-status.json`), JSON.stringify(status, null, 2));
console.log(JSON.stringify({ ...status, summary: { cases: parsed.cases, pass: parsed.pass, fail: parsed.fail, notExercised: parsed.notExercised, admission: parsed.admission }, results: parsed.results.map(({ name, status: state, error, details }) => ({ name, status: state, error, details })) }, null, 2));
process.exitCode = result.status ?? 1;
