import { spawn } from 'node:child_process';
import { mkdtemp, access, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';

const profile = await mkdtemp(path.resolve('.test-build/interaction-'));
const environment = { ...process.env, OUCL_INTERACTION_PROFILE: profile }; delete environment.ELECTRON_RUN_AS_NODE;
for (let pass = 1; pass <= 2; pass++) {
  const child = spawn(electron, [path.resolve('scripts/electron-interaction-smoke.cjs')], { env: { ...environment, OUCL_INTERACTION_PASS: String(pass) }, windowsHide: true, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); assert.equal(code, 0);
  const report = JSON.parse(await readFile(`docs/validation/UI-20261028/pass-${pass}.json`, 'utf8')); assert.equal(report.status, 'PASS');
  await assert.rejects(access(path.join(profile, 'metadata/owner.lock')), { code: 'ENOENT' });
}
