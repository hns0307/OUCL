import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';

const root = await mkdtemp(path.resolve('.test-build/resource-ui-'));
const environment = { ...process.env, OUCL_RESOURCE_UI_ROOT: root }; delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.resolve('scripts/electron-resource-ui.cjs')], { env: environment, windowsHide: true, stdio: 'inherit' });
child.on('error', () => { process.exitCode = 1; }); child.on('exit', code => {
  void readFile('docs/validation/UI-0.2.0/resource-ui.json', 'utf8').then(text => { process.exitCode = code === 0 && JSON.parse(text).status === 'PASS' ? 0 : 1; }).catch(() => { process.exitCode = 1; });
});
