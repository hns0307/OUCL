import { mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (process.platform !== 'win32') throw new Error('WINDOWS_BOOTSTRAP_TEST_REQUIRED');
const directory = await mkdtemp(path.resolve('.test-build/bootstrap-tests-'));
const compiler = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const executable = path.join(directory, 'tests.exe');
function run(file, args) { const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true }); if (result.error || result.status !== 0) throw new Error('BOOTSTRAP_TEST_FAILED'); }
run(compiler, ['/nologo', '/target:exe', '/main:BootstrapTests', `/out:${executable}`, '/reference:System.dll', '/reference:System.Core.dll',
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
  path.resolve('bootstrap/Launcher.cs'), path.resolve('bootstrap/Tests.cs')]);
run(executable, [path.join(directory, 'files')]);
