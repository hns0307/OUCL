import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const phase = process.argv[2];
if (!['red', 'final'].includes(phase)) throw new Error('Expected red or final');
const source = process.cwd(); const root = `D:/MC_start/OUCL/tmp/distribution-cancellation-20261117/${phase}`;
const evidence = path.resolve('docs/execution/20261117/cancellation-evidence');
await mkdir(root + '/tmp', { recursive: true }); await mkdir(evidence, { recursive: true });
const entries = ['tests/distribution-execution.test.ts', 'tests/distribution-transaction.test.ts'];
await build({ entryPoints: entries, bundle: true, platform: 'node', format: 'esm', target: 'node24', outdir: root, outExtension: { '.js': '.mjs' } });
const args = ['--test', '--test-reporter=spec', ...(phase === 'red' ? ['--test-name-pattern=cancellation signal reaches|cancelled artifact late'] : []),
  ...entries.map(file => path.join(root, path.basename(file).replace(/\.ts$/, '.mjs')))];
const log = path.join(evidence, `${phase}-tests.log`); const fd = openSync(log, 'w');
let result;
try { result = spawnSync(process.execPath, args, { cwd: source, windowsHide: true, env: { ...process.env, OUCL_SOURCE_ROOT: source,
  OUCL_TEST_ROOT: root, TMP: root + '/tmp', TEMP: root + '/tmp' }, stdio: ['ignore', fd, fd], timeout: 60000 }); }
finally { closeSync(fd); }
await writeFile(path.join(evidence, `${phase}-status.json`), JSON.stringify({ source, root, node: process.version, args, exitCode: result.status,
  signal: result.signal, error: result.error?.message, environment: 'see tool permission record; real FS and SQLite, no network' }, null, 2));
const output = await readFile(log, 'utf8'); console.log(output.slice(-8000)); process.exitCode = result.status ?? 1;
