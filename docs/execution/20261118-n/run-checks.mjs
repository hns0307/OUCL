import { mkdir, open, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const directory = path.resolve('docs/execution/20261118-n/checks-evidence');
await mkdir(directory, { recursive: true });
const checks = [
  ['tests', ['scripts/test.mjs'], { OUCL_TEST_ROOT: 'D:/MC_start/OUCL/tmp/20261118-n-final-tests' }],
  ['typecheck', ['../../node_modules/typescript/bin/tsc', '--noEmit'], {}],
  ['lint', ['../../node_modules/eslint/bin/eslint.js', 'src', 'tests', 'scripts', 'vite.config.ts'], {}],
  ['build', ['scripts/build.mjs'], { OUCL_BUILD_ROOT: 'D:/MC_start/OUCL/tmp/20261118-n-final-build/dist' }],
];
await Promise.all(checks.map(async ([name, args, environment]) => {
  const fd = await open(path.join(directory, `${name}.log`), 'w');
  const started = new Date().toISOString();
  const child = spawn(process.execPath, args, { env: { ...process.env, ...environment }, stdio: ['ignore', fd.fd, fd.fd] });
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  await fd.close();
  const result = { name, args, environment, started, ended: new Date().toISOString(), exitCode };
  await writeFile(path.join(directory, `${name}-status.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (exitCode !== 0) process.exitCode = 1;
}));
