# v3最终EXE冷/热验收最小流程（只读审查）

2026-11-12，Asia/Shanghai。候选固定v3 / bc01f07；本轮只读检查脚本、Launcher和E证据，仅新增本文，未打包、运行GUI、提交、改候选源码或触碰旧根/其他聊天进程。开工五小时usedPercent=4、剩余96%、resetsAt=1794493614；周额度不作为门槛。已读取最新TASK_PLAN、DECISIONS、AGENTS：活跃树新Quilt双摘要及P-C进度不自动加入固定v3。

## 结论与验收轴

最小可靠流程是：从已经验过且有七文件manifest的**原v3产品产物**建立独立打包工作目录，调用原bootstrap-package，不重新build；在全新便携目录预置匹配Electron、保持app/profile不存在，经最终EXE首次启动和同目录正常重开，实际选择固定样本/取消/不匹配并核对包与数据证据。另将“运行时完全缺失、官方ZIP下载”单列，不用预置运行时的结果冒充。

| 层级 | 首次条件 | 可证明 | 不能证明 |
| --- | --- | --- | --- |
| 预置运行时、应用首次 | 新EXE目录；仅electron-官方ZIP摘要目录；无app/profile | 最终EXE验证预置runtime、解出嵌入app、便携profile/根创建及picker | 运行时下载 |
| 同目录热重开 | 上轮正常关闭后的同一EXE/runtime/app/profile | 相同app/runtime namespace复用、账户/根等持久化、picker重开 | 空运行时冷启动 |
| 运行时真冷（另项） | 另一个全新EXE目录，完全没有OUCL.runtime | 官方下载、ZIP SHA256、提取/manifest验证、之后启动 | 不能以从缓存拷贝、预先解压或替代harness声称该项通过 |

第一行同样不能证明runtime下载，第三行的网络失败应保存BLOCKED/FAIL，不掩盖前两行结果。当前任务仅制定流程，表内无新增PASS。

## 脚本审查与使用边界

- `scripts/bootstrap-package.mjs:15`固定读取cwd的dist，不读取OUCL_BUILD_ROOT；`:44`起将Electron checksums中的官方ZIP摘要写configuration；输出release/OUCL-版本[-tag].exe，已存在即拒绝。它会生成工作目录和打包证据，所以必须在新打包目录执行。package.json版本维持0.3.0，使用唯一OUCL_BUILD_TAG区分候选，不覆盖旧EXE。
- `scripts/build.mjs`虽然支持OUCL_BUILD_ROOT，但此次不能为打包方便重跑构建后直接假定与已验七文件相同。应把`acceptance-results/product`物化复制到独立stage/dist并逐文件比对`product-manifest.json`。
- `bootstrap/Launcher.cs:73`–`:99`对每个manifest文件校验内容并拒绝额外文件/链接；`:156`–`:181`找不到正确runtime/app才下载或解嵌入包。损坏已存在namespace会另建带UUID的新目录，不原地覆盖。**不能在已验不可变app目录塞日志、修改worker或加测试脚本**。
- `Launcher.cs:134`–`:145`未传user-data-dir时默认EXE同级OUCL.runtime/profile，显式传入则保留；`:185`–`:191`子Electron cwd为app目录，并设置OUCL_PORTABLE_ROOT为EXE目录。引导器Process.Start后返回，**引导器退出0不等于产品/游戏退出0**。bootstrap.lock文件存在不等于仍持锁；其排他句柄生命周期与metadata/owner.lock不同。
- `scripts/bootstrap-smoke.mjs:49`硬编码44方法/16能力，已落后于B/C/E候选。`:8`每次新建profile，因此两次脚本运行并不验证同profile重开；`:11`COPY=1还会每次新建EXE目录，连runtime也不是同根热复用。`:9`HARNESS模式是替代引导入口，不能算最终EXE；finally `:69`有child.kill。**本轮不要直接执行该旧脚本当最终验收门槛，不改候选去迎合旧计数。**
- `scripts/portable-smoke.mjs:18`起自建新目录，复制Electron预置，三场景为正常新根/同profile重开/目录阻塞后重试；不传user-data-dir，能覆盖真实默认便携行为。它采用CDP驱动且finally `:107`有child.kill，失败时可能不能精确覆盖派生窗口归属；当前主聊天独占GUI，建议只取其夹具和断言设计，由主聊天按GUI技能正常关闭自有窗口，不并行启动此脚本。
- `scripts/bootstrap-test.mjs`是编译Launcher/Tests的非产品窗口检查，适用于新增引导器内容验收；v3已有对应历史结果时无需无变化反复跑。它不替代真实EXE首次/重开。

## 精确打包准备命令（待主协调执行，本轮未运行）

以下在PowerShell中运行，所有写入限定全新的`acceptance-results/package-v6`，脚本已有拒绝覆盖检查。stage没有src，不会从活跃树编译；依赖只复制原候选已有包，无安装。所有cp解引用，不把写操作导向候选node_modules。

```powershell
Set-Location -LiteralPath 'D:\MC_start\OUCL-acceptance-v3-20261112'
@'
import {cp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=process.cwd();
const stage=path.join(root,'acceptance-results/package-v6');
try {await access(stage);throw Error('STAGE_ALREADY_EXISTS');}
catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(stage,{recursive:true});
const copy=async(a,b)=>cp(path.join(root,a),path.join(stage,b),{recursive:true,dereference:true,errorOnExist:true,force:false});
await copy('package.json','package.json');
await copy('scripts/bootstrap-package.mjs','scripts/bootstrap-package.mjs');
await copy('bootstrap','bootstrap');
await copy('acceptance-results/product','dist');
const manifest=JSON.parse(await readFile('acceptance-results/product-manifest.json','utf8'));
for(const item of manifest){
 const hash=createHash('sha256').update(await readFile(path.join(stage,'dist',item.path))).digest('hex');
 if(hash!==item.sha256)throw Error('PRODUCT_MISMATCH:'+item.path);
}
for(const name of ['react','react-dom','zustand','smol-toml','electron'])
 await copy('node_modules/'+name,'node_modules/'+name);
const requireReact=createRequire(path.resolve('node_modules/react-dom/package.json'));
await cp(path.dirname(requireReact.resolve('scheduler/package.json')),path.join(stage,'node_modules/scheduler'),{recursive:true,dereference:true,errorOnExist:true,force:false});
await writeFile(path.join(stage,'product-input-manifest.json'),JSON.stringify(manifest,null,2));
console.log(stage);
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'PACKAGE_STAGE_FAILED' }
Set-Location -LiteralPath 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\package-v6'
$env:OUCL_BUILD_TAG='acceptance-v6-20261112'
node scripts/bootstrap-package.mjs
if ($LASTEXITCODE -ne 0) { throw 'BOOTSTRAP_PACKAGE_FAILED' }
Get-FileHash -LiteralPath '.\release\OUCL-0.3.0-acceptance-v6-20261112.exe' -Algorithm SHA256
```

产物：`<v3>/acceptance-results/package-v6/release/OUCL-0.3.0-acceptance-v6-20261112.exe`；打包证据在同stage下`docs/validation/BOOTSTRAP-0.3.0-acceptance-v6-20261112/package.json`。保留完整stage，包括.test-build/bootstrap-*中的configuration/app.manifest/runtime.manifest/app.zip。包装app比产品七文件多package.json和THIRD_PARTY_NOTICES，是打包所需文件，不把这些当原产品哈希漂移。

脚本对runtime.manifest使用的是候选已安装Electron45.0.0解包树；预置后仍按这份manifest逐文件验证。目录名中的checksum是官方Electron ZIP SHA256，不是目录合并摘要。若需证明真冷下载信任链，必须实际下载并验证ZIP；预置树通过不能代替该证明。

## 精确预置命令与目录（待主协调执行）

沿用上方stage cwd；下面仅创建新的中文空格便携目录，**只复制Electron，不预置app/profile/游戏数据**：

```powershell
$pkgStage=(Get-Location).Path
$portableCase=Join-Path $pkgStage 'cases\最终包 预置首次与热重开'
if (Test-Path -LiteralPath $portableCase) { throw 'CASE_ALREADY_EXISTS' }
New-Item -ItemType Directory -Path $portableCase | Out-Null
Copy-Item -LiteralPath '.\release\OUCL-0.3.0-acceptance-v6-20261112.exe' -Destination (Join-Path $portableCase 'OUCL.exe')
$electronMeta=Get-Content -LiteralPath '.\node_modules\electron\package.json' -Raw | ConvertFrom-Json
$checksums=Get-Content -LiteralPath '.\node_modules\electron\checksums.json' -Raw | ConvertFrom-Json
$zipName="electron-v$($electronMeta.version)-win32-x64.zip"
$runtimeDigest=$checksums.$zipName
if ($runtimeDigest -notmatch '^[a-f0-9]{64}$') { throw 'CHECKSUM_MISSING' }
$runtimeCase=Join-Path $portableCase "OUCL.runtime\electron-$runtimeDigest"
New-Item -ItemType Directory -Path (Split-Path -Parent $runtimeCase) | Out-Null
Copy-Item -LiteralPath '.\node_modules\electron\dist' -Destination $runtimeCase -Recurse
Get-FileHash -LiteralPath (Join-Path $portableCase 'OUCL.exe') -Algorithm SHA256
```

预置前后记录目录清单，核对不存在app-*和profile；每个文件摘要必须按stage唯一打包工作目录中的runtime.manifest核对，不能仅检查electron.exe存在。不要拷其他聊天运行中runtime、可写profile或旧缓存；不要迁移D已使用实例来代替空便携根。D实机结果已独立在v5完成，最终包本轮以入口/打包/picker为最小闭环。

## 主聊天唯一GUI执行顺序

1. 通过GUI驱动启动上方case的完整`OUCL.exe`路径，参数为空（不传user-data-dir、不传harness）；如需验证cwd独立，可从与EXE不同的工作目录启动，但不要改变EXE路径。正常进入窗口后核对准备完成和独立默认游戏根。预置模式不应下载Electron，但catalog等产品网络可能发生，不能宣称全程无网络。
2. 核对解包的`OUCL.runtime/app-<package.json.appHash>/dist`七文件与v3 product-manifest逐字节一致，确认有fixed-pack.cjs；同一app完整manifest也应无缺失/额外文件。需要握手则只读调用公开bridge：能力必须包含packs.fixed-preview.v1及当前候选预期能力，不沿用44/16总数。可记录完整实际列表，不把枚举数量代替字段验证。
3. 在下载页通过真实原生picker选择固定1355字节样本（下一节），确认目标MC/Forge/Java/FerriteCore与“尚未验证、当前不可安装”；再打开并取消，确认“未选择文件”；选择不同字节样本，确认只支持固定样本提示，无ready/安装。把实际picker与产品结果配成同轮证据，不能只根据click返回。
4. 正常关闭该自有窗口。确认窗口消失、metadata/owner.lock释放；若能取到产品子进程退出码则记录，不能凭引导器退出码补0。保留所有产物/失败材料，不强杀其他聊天进程。
5. 同一个case、同一个EXE、空参数再次启动。确认根身份与installation记录不变、同profile复用、runtime/app namespace名称及不可变摘要不变，无额外下载/解包namespace；再实际选择固定样本至少一次。正常关闭，复核owner释放。这里才是最终包同profile热重开。
6. 如最终验收还要求真冷，另建空case只复制同一SHA256的EXE，绝不预置runtime；经GUI启动并实际记录官方ZIP下载/摘要与提取，之后同样比对产物。该项可受网络阻塞，不得借用预置case结果补PASS。

预置首次与热轮应保存：EXE SHA256/size、打包report/configuration、源/解包七文件manifest、runtime目录清单/摘要、独立profile和installation before/after、picker截图与结果、关闭/owner状态。只读预览前后对实例/包记录及游戏目录文件内容做比较；catalog/operations/profile正常变化单列，避免要求整个Electron profile所有缓存完全不变。新空profile requests/tasks计数应无安装任务增加；不单凭计数声称所有文件未变化。

## E固定picker与missing-worker证据关联

- 固定样本原件：活跃资料`D:/MC_start/OUCL/docs/work-packages/P-E/sample/OUCL-PE-Forge-Smoke-1.0.0.mrpack`（或候选内同字节文件），size1355，SHA256 `e4cf7d5607a70582cfcec200a381892a83c75e122f5be6bad926de23ff7278f2`。复制到新case外的独立fixtures/并重算摘要，不改原样本；许可范围见sample/NOTICE.md（原始安排/配置CC0，不包含第三方JAR许可转让）。
- 不匹配样本可用P-E/evidence/20261111/different.mrpack，size1355，SHA256 `7f81fd6f3a5bd8344d030e15c144bba0ed80e8ab8b1eb8f0025eb196458b092b`；或在本轮fixture副本仅改一字节并记新摘要。固定SHA256门禁拒绝不证明通用恶意ZIP解析。
- `docs/acceptance/20261112-v3/REPORT.md:40`–`:44`覆盖**未打包正式七产物**的空profile/重开和省略worker后不广告packs.fixed-preview.v1；专用worker4项通过见`:28`。这对服务装配/缺组件的证据有效，不是最终EXE冷热通过。
- `docs/acceptance/20261112-v4/REPORT.md:17`覆盖实际原生picker打开时销毁自有BrowserWindow、同profile重开；未捕获退出前原生回调settled，不能扩成所有迟到回调/worker竞态。`P-E/E2-REOPEN-20261111.md:15`已有operations变化限制，最终包沿用诚实边界。
- 最终EXE应验证**worker存在、摘要正确、能力存在、picker实际可用**。不在最终app目录删除worker：Launcher完整manifest会重新解包，得到的不是main缺worker分支。missing-worker继续引用v3独立受控构建证据，明确与最终EXE正常组件证据层级不同。
- 若主协调要求missing-worker也经过引导器，必须另生成有意省略worker的**独立测试包/新appHash**，与最终EXE不同SHA256，不能改最终包或声称它代表最终正常功能；这是可选补证，不是本轮最小必需流程，需明确标记测试变体。本任务未生成该包。

## 完成判据与排除

仅在同一最终EXE SHA256的预置首次+同profile热重开均有实际窗口、picker和解包产物/owner证据后，关闭E最终包这两项缺口；真冷下载结果另列。旧v17/v19、未打包harness、v3 missing-worker与v4销毁证据不改写为本次EXE通过。

候选Quilt别名仍排除；A产品强制中断恢复继续DEFERRED。只读预览不扩大为通用mrpack、Mod下载或安装。主协调热窗口仍是其独占，本轮未启动任何脚本/窗口来干扰。后续实际打包/GUI执行由主协调安排，本文全部命令均为经源码核对后的待执行方案。
