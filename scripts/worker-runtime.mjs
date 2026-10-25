import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import electron from 'electron';

await build({ entryPoints: ['tests/runtime/workers.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], outfile: '.test-build/worker-runtime.cjs' });
const root = await mkdtemp(path.join(tmpdir(), 'oucl-runtime-workers-'));
if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('oucl-runtime-workers-')) throw new Error('INVALID_FIXTURE_ROOT');
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.resolve('.test-build/worker-runtime.cjs'), root, path.resolve('dist/workers/entry.cjs')],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: environment });
const ended = once(child, 'exit');
let output = '';
child.stdout.on('data', bytes => { output += bytes.toString(); });
// Drain Chromium diagnostics without archiving paths or replacing the structured runtime result.
child.stderr.resume();
const deadline = setTimeout(() => { child.kill(); }, 35000);
try {
  const [exitCode] = await ended;
  const line = output.split(/\r?\n/).find(value => value.startsWith('OUCL_WORKERS_RESULT:'));
  const report = line ? JSON.parse(line.slice('OUCL_WORKERS_RESULT:'.length)) : { status: 'FAIL', code: 'NO_RUNTIME_REPORT' };
  report.exitCode = exitCode; report.timestamp = new Date().toISOString();
  await mkdir('docs/validation/A1-08-installer', { recursive: true });
  await writeFile('docs/validation/A1-08-installer/electron-runtime.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (report.status !== 'PASS' || exitCode !== 0) process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await ended;
  await rm(root, { recursive: true, force: true });
}
