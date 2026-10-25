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
const notices = ['OUCL vanilla offline launcher preview. Portable folder, unsigned, no automatic updates.', 'Electron license and Chromium notices remain beside the executable. Minecraft and Java are not bundled.'];
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
await writeFile(path.join(destination, '使用说明.txt'), `OUCL ${metadata.version} · Minecraft Java 原版离线启动器\n\n1. 打开 OUCL.exe，选择独立的游戏文件夹。\n2. 选择电脑中已安装的 64 位 java.exe。已实测 Minecraft 1.20.1 + Java 17。\n3. 创建离线档案：显示昵称可中文，游戏名为 3–16 位英文字母、数字或下划线。\n4. 在版本列表选择 1.20.1，确认名称和隔离设置后安装；在已安装实例中点击“启动游戏”。\n5. 正常退出请在 Minecraft 内操作。强制结束前先保存进度并勾选确认。\n\n请保留并移动整个文件夹，不要单独移动 OUCL.exe。游戏与缓存保存在你选择的位置。\n游戏运行时关闭启动器窗口会隐藏并保留进程；重新打开 OUCL 可返回，游戏结束后会正常收尾。\n\n本版本无微软正版登录、加载器或联机集成。离线档案不代表正版认证。其他游戏/Java组合尚未全部实测。\n包未签名，不含安装器或自动更新；不包含 Minecraft 或 Java 本体。\n`, 'utf8');
await mkdir('docs/validation/A1-09-exe', { recursive: true });
await writeFile('docs/validation/A1-09-exe/package.json', JSON.stringify({ timestamp: new Date().toISOString(), version: metadata.version, target: 'win32-x64', directory: path.relative(process.cwd(), destination), entry: 'OUCL.exe', signed: false, installer: false, minecraftBundled: false, javaBundled: false }, null, 2));
console.log(path.relative(process.cwd(), destination));
