import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('UNSUPPORTED_PLATFORM');
const output = path.resolve(process.env.OUCL_BUILD_ROOT ?? 'dist', 'native/distribution-files.exe');
await mkdir(path.dirname(output), { recursive: true });
const compiler = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const result = spawnSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/utf8output', `/out:${output}`,
  '/reference:System.dll', '/reference:System.Core.dll', path.resolve('native/distribution-files/NativeGuard.cs'), path.resolve('native/distribution-files/Program.cs')],
{ stdio: 'inherit', windowsHide: true });
if (result.error || result.status !== 0) throw new Error('DISTRIBUTION_HELPER_BUILD_FAILED');
const bytes = await readFile(output);
await writeFile(path.join(path.dirname(output), 'distribution-files.json'), JSON.stringify({ formatVersion: 1, file: 'distribution-files.exe',
  sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }, null, 2));
console.log(JSON.stringify({ output, platform: 'win32-x64' }));
