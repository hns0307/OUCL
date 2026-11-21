import { spawn } from 'node:child_process';
import { mkdtemp, lstat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import electron from 'electron';
const profile = await mkdtemp(path.resolve('.test-build/download-ui-'));
for (const reopen of ['0','1']) {
  const env = { ...process.env, OUCL_DOWNLOAD_TEST_PROFILE: profile, OUCL_DOWNLOAD_TEST_REOPEN: reopen }; delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject) => {const child = spawn(electron,[path.resolve('scripts/electron-downloads-smoke.cjs')],{env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`DOWNLOAD_UI_EXIT:${code}`)));});
  await assert.rejects(lstat(path.join(profile,'metadata/owner.lock')),{code:'ENOENT'});
}
