import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import electron from 'electron';
import { build } from 'esbuild';

await build({ entryPoints: ['tests/mod-transaction.test.ts', 'tests/mod-preparation.test.ts'], bundle: false, platform: 'node', format: 'esm', target: 'node24', outbase: '.', outdir: '.test-build' });
const child = spawn(electron, ['--test', '--test-reporter=tap', path.resolve('.test-build/tests/mod-transaction.test.js'), path.resolve('.test-build/tests/mod-preparation.test.js')],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OUCL_MOD_TXN_BUNDLED_WORKER: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; let oversized = false;
const capture = bytes => { if (output.length + bytes.length > 2 * 1024 ** 2) { oversized = true; child.kill(); } else output += bytes.toString(); };
child.stdout.on('data', capture); child.stderr.on('data', capture);
const deadline = setTimeout(() => { child.kill(); }, 60000);
try {
  const [exitCode] = await once(child, 'close');
  const count = name => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(output)?.[1] ?? -1);
  const report = { status: exitCode === 0 && !oversized && count('tests') === 27 && count('pass') === 27 && count('fail') === 0 ? 'PASS' : 'FAIL',
    timestamp: new Date().toISOString(), electron: JSON.parse(await readFile('node_modules/electron/package.json', 'utf8')).version,
    mode: 'Electron as Node, bundled production worker, real filesystem and SQLite', tests: count('tests'), pass: count('pass'), fail: count('fail'), exitCode };
  const evidence = path.resolve('docs/validation/MOD-EXECUTOR-20261028'); await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'electron-runtime.json'), JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') await writeFile(path.join(evidence, 'electron-runtime-failure.txt'), output);
  console.log(JSON.stringify(report)); if (report.status !== 'PASS') process.exitCode = 1;
} finally { clearTimeout(deadline); }
