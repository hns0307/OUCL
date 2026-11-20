import { access, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runtimeNotices } from './runtime-notices.mjs';

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
await writeFile(path.join(destination, 'THIRD_PARTY_NOTICES.txt'), await runtimeNotices());
await rename(path.join(destination, 'electron.exe'), path.join(destination, 'OUCL.exe'));
await writeFile(path.join(destination, '使用说明.txt'), `OUCL ${metadata.version} · Minecraft Java 启动器\n\n1. 在“设置”中选择游戏存放位置和本机已安装的64位 java.exe。Minecraft 1.20.1建议Java17；其他版本需选择对应Java。\n2. 在“首页”右侧新建离线档案：昵称可中文，游戏名为3–16位英文字母、数字或下划线。\n3. 在“下载 → Minecraft”选择版本、实例名称和隔离方式，确认安装。\n4. 安装完成后，从左侧“游戏与整合包”选择实例，使用首页右侧按钮启动。\n5. “下载”页的Mod、材质包和光影包来自Modrinth，可搜索、筛选、选择文件后下载。文件经校验后存入资源库，可点击“打开资源库”查看。此版本不自动安装资源、加载器或依赖，不保证资源直接可运行。\n6. “设置”中的内存保存后用于下一次启动；默认隔离仅影响新建实例，不移动已有游戏目录。“公告”当前暂无远程数据。\n7. 游戏请优先在Minecraft内正常退出；强制停止前先保存进度并勾选确认。\n\n必须保留整个便携目录，不能单独移动OUCL.exe；也可将完整目录打包复制到其他电脑。游戏与资源保存在已选择的位置，暂不提供迁移功能。\n游戏运行时关闭启动器窗口会隐藏并保留进程；重新打开OUCL可返回。\n包未签名，不含安装器、自动更新、Minecraft或Java。在“工具箱”进入账号管理、皮肤中心、网站中心和联机中心。Microsoft 正版登录需要配置已获准的 OUCL 客户端 ID。联机需要导入受支持的 EasyTier Windows x64 官方包；跨网连接还需自有且获准的私有节点。\n`, 'utf8');
await mkdir('docs/validation/UI-0.2.0', { recursive: true });
await writeFile('docs/validation/UI-0.2.0/package.json', JSON.stringify({ timestamp: new Date().toISOString(), version: metadata.version, target: 'win32-x64', directory: path.relative(process.cwd(), destination), entry: 'OUCL.exe', signed: false, installer: false, minecraftBundled: false, javaBundled: false }, null, 2));
console.log(path.relative(process.cwd(), destination));
