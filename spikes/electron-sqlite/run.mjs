import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { fixture } from '../phase0-local/fixture.mjs';

const f = await fixture();
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [fileURLToPath(new URL('./main.cjs', import.meta.url)), f.root], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: environment,
});
const ended = once(child, 'exit');
let stdout = ''; let stderr = '';
child.stdout.on('data', bytes => { stdout += bytes.toString(); });
child.stderr.on('data', bytes => { stderr += bytes.toString(); });
const timeout = setTimeout(() => { child.kill(); }, 35000);
try {
  const [code] = await ended;
  const line = stdout.split(/\r?\n/).find(value => value.startsWith('OUCL_SQLITE_RESULT:'));
  const report = line ? JSON.parse(line.slice('OUCL_SQLITE_RESULT:'.length)) : { status: 'FAIL', reason: 'No complete runtime report' };
  report.timestamp = new Date().toISOString(); report.exitCode = code;
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(new URL('./results/latest.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (code !== 0 || report.status !== 'PASS') {
    console.error(stderr); process.exitCode = 1;
  }
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await ended;
  await f.cleanup();
}
