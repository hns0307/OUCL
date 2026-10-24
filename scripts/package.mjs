import { access, cp, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('ONLY_VALIDATED_PACKAGE_TARGET_WIN32_X64');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('INVALID_PACKAGE_VERSION');
const parent = path.resolve('release');
const destination = path.join(parent, `OUCL-${metadata.version}-win32-x64`);
if (!destination.startsWith(parent + path.sep)) throw new Error('OUTSIDE_RELEASE');
try { await access(destination); throw new Error('RELEASE_ALREADY_EXISTS'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(parent, { recursive: true });
await cp('node_modules/electron/dist', destination, { recursive: true, errorOnExist: true, force: false });
const appDirectory = path.join(destination, 'resources/app');
await mkdir(appDirectory, { recursive: true });
await cp('dist', path.join(appDirectory, 'dist'), { recursive: true, errorOnExist: true, force: false });
await writeFile(path.join(appDirectory, 'package.json'), JSON.stringify({ name: 'oucl', version: metadata.version, main: 'dist/main/index.cjs' }, null, 2));
const notices = ['OUCL engineering preview. No game capabilities, installer, signing or automatic updates.', 'Electron license and Chromium notices remain beside the executable.'];
for (const name of ['react', 'react-dom', 'scheduler', 'zustand']) {
  let modulePath;
  if (name === 'scheduler') {
    const { createRequire } = await import('node:module');
    const resolveFromReact = createRequire(await realpath('node_modules/react-dom/package.json'));
    modulePath = path.dirname(resolveFromReact.resolve('scheduler/package.json'));
  } else modulePath = path.resolve('node_modules', name);
  const license = await readFile(path.join(modulePath, 'LICENSE'), 'utf8');
  notices.push(`\n--- ${name} ---\n${license}`);
}
await writeFile(path.join(destination, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
await rename(path.join(destination, 'electron.exe'), path.join(destination, 'OUCL.exe'));
await mkdir('docs/validation/P0-08', { recursive: true });
await writeFile('docs/validation/P0-08/package.json', JSON.stringify({ timestamp: new Date().toISOString(), target: 'win32-x64', directory: path.relative(process.cwd(), destination), entry: 'OUCL.exe', signed: false, installer: false }, null, 2));
console.log(path.relative(process.cwd(), destination));
