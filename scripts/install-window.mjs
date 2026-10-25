import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, lstat, mkdir, mkdtemp, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import electron from 'electron';

await build({ entryPoints: ['tests/runtime/install-window.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], outfile: '.test-build/install-window.cjs' });
const root = await mkdtemp(path.join(tmpdir(), 'oucl-install-window-'));
if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('oucl-install-window-')) throw new Error('INVALID_FIXTURE_ROOT');
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const javaExecutable = process.argv[2]; if (javaExecutable && !path.isAbsolute(javaExecutable)) throw new Error('JAVA_PATH_MUST_BE_ABSOLUTE');
const child = spawn(electron, [path.resolve('.test-build/install-window.cjs'), root, path.resolve('dist/workers/entry.cjs'), path.resolve('dist/main/index.cjs'), ...(javaExecutable ? [javaExecutable] : [])],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: environment });
const ended = once(child, 'exit'); let output = ''; let timedOut = false;
child.stdout.on('data', bytes => { output += bytes.toString(); }); child.stderr.resume();
const deadline = setTimeout(() => { timedOut = true; child.kill(); }, 40000);
async function cleanup(entry) {
  const relative = path.relative(root, entry);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('oucl-install-window-')) throw new Error('OUTSIDE_FIXTURE_ROOT');
  const info = await lstat(entry);
  if (info.isSymbolicLink() || !info.isDirectory()) return unlink(entry);
  for (const name of await readdir(entry)) await cleanup(path.join(entry, name));
  await rmdir(entry);
}
try {
  const [exitCode] = await ended;
  const line = output.split(/\r?\n/).find(value => value.startsWith('OUCL_INSTALL_WINDOW_RESULT:'));
  const report = line ? JSON.parse(line.slice('OUCL_INSTALL_WINDOW_RESULT:'.length)) : { status: 'FAIL', code: timedOut ? 'PARENT_TIMEOUT' : 'NO_RUNTIME_REPORT', fixture: true, gameLaunched: false };
  report.exitCode = exitCode; report.timestamp = new Date().toISOString();
  const evidence = 'docs/validation/A1-09-launch-ui/game'; await mkdir(evidence, { recursive: true });
  if (report.status === 'PASS') await copyFile(path.join(root, 'installer-window.png'), path.join(evidence, 'installer-window.png'));
  await writeFile(path.join(evidence, 'installer-window.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (report.status !== 'PASS' || exitCode !== 0) process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await ended;
  await cleanup(root);
}
