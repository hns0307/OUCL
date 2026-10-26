# OUCL 下一对话交接

## 2026-10-26 main下载优化当前检查点

用户明确批准下载优先落main，之后同步mod_loaders恢复原四加载器/Mod目标；不push/发布、不碰用户游戏数据，原两份暂存资料必须排除。主工作目录D:/MC_start/OUCL-download-main（main），原D:/MC_start/OUCL仍mod_loaders68542ab及未提交下载WIP，两份原始资料仍暂存。旧C盘download-sources托管目录访问拒绝，未修改/归档。

main提交7fab3b1下载偏好严格IPC、9ac0895有界源与分段、8fd3edd真实设置UI/验证，之后通用native运行缓存隔离修复（以git log为准）。无新依赖，无加载器/Mod代码合入main。偏好官方/BMCLAPI、文件/单文件1..8默认4，全局16/同主机8；官方标准强ETag精确Range时4MiB分段、剩余至少8MiB；镜像单流，切源零前缀/清验证器，fsync连续完整片后记录，取消失败join，最终完整hash发布，镜像hash错只官方重试一次。main启动读取设置且CAS修订单调，实际UI可见署名/保存重开，downloads.v1按Installer可用广告，26方法11能力。

完整pnpm check277项275PASS/0FAIL/2原有SKIP、Electron四页/下载设置独立重开、19引导测试、审计无漏洞/127包许可通过。真实官方1.20.1新根3641制品735814641字节安装；先Oracle shim被拒后真实Java17通过；初次菜单退出0，再发现native缓存污染，保留本轮测试natives-before-cache-fix现场。通用修复仅迁入缓存隔离，不带Forge逻辑；正式LaunchService同实例两次主菜单与Quit均实际观察、退出0，worker/storage关闭，无owned游戏。

0.2.3独立小EXE位于本工作目录release/OUCL-0.2.3.exe，精确大小/摘要见docs/validation/BOOTSTRAP-0.2.3/package.json。候选1/2及旧交付物保留；同级OUCL.runtime不变。首候选冷启动23.51s，最终候选热启动及26方法/11能力、安全边界/释放owner通过；不能将首候选冷启动写作最终载荷冷启动。所有最新证据docs/validation/DOWNLOADS-main/REPORT.md。

未通过项：官方当前节点返回未加引号的旧AzureETag，x-ms-version/no-cache未改变；正确/错误If-Range均200，所以安全回退单流，公网实际分段与吞吐提升尚未观测。不得放宽强ETag条件或把本地HTTP分段测试写成公网成功。此限制不阻断镜像/多文件及已完成原版闭环。完整1A历史世界矩阵不因本轮关闭。

下一步：先完成main本地提交和最终EXE验证，再精确同步下载增量/通用修复到mod_loaders；原WIP须先按精确路径保留为stash/独立补丁，不暂存原两份资料，不能整分支合main。mod已有下载偏好68542ab，不重复带入；installer/downloads/main装配冲突手工适配保留加载器/Mod能力。之后恢复Fabric/Quilt真实安装CATALOG_UNAVAILABLE诊断、四加载器矩阵/Mod依赖确认事务/分发测试适配器及0.3.0，当前仍未交付。原自动化PAUSED保持。

额度继续实际get_usage_limits，剩10%及以下保存提交/交接并暂停；实际重置且剩至少20%才恢复。最后已用55%仅历史参考。原受限环境首轮check存在存储权限失败/长挂测试，正常权限277检查通过，日志未伪造；main根download-preferences-check.log是该自有测试输出，若仍打开可保留，不混入提交。

---
# OUCL 下一对话交接

## 当前有效交接：0.2.2 同级运行环境（2026-10-25）

用户明确要求运行时在EXE同级准备环境，缺少下载、完整则直接启动，并美化或隐藏检查/启动界面。批准已记TASK_PLAN顶部/DECISIONS末尾。本增量交付待体验，下面0.2.1是历史系统缓存方案，不再是当前默认。

实现提交afcbb6d；报告和本交接单独提交，以git log为准。

- 交付：release/OUCL-0.2.2.exe，234496字节（229KiB），SHA256 2b1f141d0cbd7610f19117b91009ac2c76bc3b4809febfc538b3009386ef7454；未签名，无新依赖、不push/发布。
- Electron及内嵌应用固定在EXE旁OUCL.runtime，由Assembly位置确定，不依赖cwd。无环境才官方下载，完整缓存逐文件校验后复用。正常检查/准备/启动用隐藏ApplicationContext，无引导弹窗；仅下载/错误显示简洁窗口、进度/取消/重试。同级不可写则报错，不回退LocalAppData或提权。
- 不搬动/删除0.2.1 LocalAppData缓存、Roaming/OUCL账户设置或游戏根。Java仍沿用0.2.1按需准备。移动时连EXE和OUCL.runtime一起复制可复用；只复制EXE则在新目录重下。退出后删除EXE+该同级目录即可删程序环境，不含用户游戏/账户。
- 262测试260 PASS/0 FAIL/2原有SKIP；19原生引导测试、审计与127包许可通过。真实交付EXE在两份独立中文/空格目录冷启动下载约27/26秒通过；同一EXE+目录热启动约1.57秒，目录清单断言证明未创建新Electron。所有实际应用URL位于同级OUCL.runtime，24方法/10能力、无Node、正常退出释放owner通过。证据在docs/validation/BOOTSTRAP-0.2.2/REPORT.md。
- 下载UI已实际读取并以独立同布局Preview截图检查。用户实体Esc停止Computer Use后，没有继续操作窗口；人工取消验收未完成且时序断言失败，不能写成GUI取消通过。只有取消信号/暂存清理的独立单测通过。不要为补证接管用户正在玩的MC窗口。
- scripts/bootstrap-smoke.mjs按package版本写新证据目录。OUCL_BOOTSTRAP_COPY=1测试只复制单EXE至新中文目录；OUCL_EXE_TEST_PATH可对已准备目录复测。bootstrap/Preview.cs、ColdStart.cs均测试专用，产品只编译Launcher.cs。
- 历史阶段缺项保持，0.2.2不算重新跑过游戏世界/全Java矩阵。用户两份原始暂存文件仍保留，显式路径add/commit --only，作者Li ZeRui。

## 以下为0.2.1交付时历史快照

## 当前有效交接：0.2.1 小EXE（2026-10-25）

用户明确选择“小exe首次下载依赖”，了解PCL按需Java后回复“按照你说的进行”。有效范围与真实批准已记录TASK_PLAN顶部/DECISIONS末尾。本增量已实现并验证，待用户体验；下文0.2.0/0.1.0是历史，不再以ZIP为推荐交付。

实现提交：479d0e9；验证报告及本交接单独提交，以git log为准。

- 交付：release/OUCL-0.2.1.exe，232448字节（227KiB）；只复制EXE即可，首次从Electron官方固定版本下载运行环境，后续缓存复用。SHA256 a2802e49c5c323d2586e3c910ec515e869d07fb4fb3130e61aa15c0cd4361d26。未签名、不push、不发布GitHub Release。
- Windows 10/11 x64、系统.NET Framework 4.7.2+。C#引导只准备Electron并启动内嵌应用，业务仍TS/Electron/React。没安装electron-builder或NuGet依赖。缓存LocalAppData/OUCL/desktop-cache；原OUCL元数据和自选数据根不迁移。
- JavaRuntimeService由LaunchService主进程装配；优先重新探测已登记及有界常见位置，缺少8/17/21则按Mojang官方index→SHA1 manifest→raw文件下载。复用Installer的coordinator/hash/object单owner；新anchor.kind=mojang-runtime，旧记录向后兼容。全部文件验证复制到暂存后rename至游戏根runtimes/java/<manifest-sha1>，再实际probe并登记。不扩展Java16/25、加载器或登录。
- pnpm check：262测试260 PASS/0 FAIL/2原有软链接权限SKIP；14项原生bootstrap安全测试通过；audit无已知漏洞、127包许可无待审。三个真实官方Java逐文件独立摘要+实际JVM+正常重开禁止联网复用通过；最终EXE默认入口24方法/10能力、无Node、正常退出释放owner通过。隔离冷启动相同引导与前一文案候选载荷官方下载约24.8秒通过，最终EXE缓存入口约1.83秒。不要把这些写成新MC世界实测。
- 全部证据在docs/validation/BOOTSTRAP-0.2.1/REPORT.md；设计及路径/恢复约定见docs/BOOTSTRAP.md。pnpm package:exe拒绝覆盖已存在同名产物，复测先保留本轮生成的旧候选，不删除用户目录。ColdStart.cs只是独立缓存测试入口，未编进产品。
- 下载失败Electron从头重试，无自动镜像；Java复用可信断点/对象，中断暂存保留，不执行未完成目录。损坏Java保守停写。Java只显示准备提示，没有文件级进度。阶段0/1A历史缺项继续保留。
- 用户已有暂存OUCL-Codex-Package.zip/OUCL.txt保持原样；显式路径add与commit --only，作者Li ZeRui，不push。引导测试使用独立profile，不操作用户MC窗口。

## 以下为0.2.0交付时历史快照

## 当前有效交接：0.2.0（2026-10-25）

用户已明确要求完整实施《OUCL 前端改版与资源下载》，不是仅预备UI。授权记录在DECISIONS末尾，TASK_PLAN顶部为新增量状态。本次实现已交付，待用户体验验收；不自动继续后续阶段。

- 当前代码提交：d15237b（settings:update及真实内存/隔离设置）、e137ea2（Modrinth资源库、可信传输及任务）、589f704（四页前端、0.2.0版本和验证脚本）。本交接及证据将单独提交；以git log为准。
- 可运行：release/OUCL-0.2.0-win32-x64/OUCL.exe；完整ZIP同名.zip，163475449字节。必须完整解压/保留便携目录。先正常退出旧OUCL再启动新版，不结束用户游戏。未签名、不含Java/MC、无安装器，不push。
- 四页顶部导航；左侧真实实例；首页右侧原创本地头像、离线账户、原启动/停止流程；MC安装在下载页；Mod/材质/光影通过Modrinth真实下载至资源库。仅下载与校验，不安装加载器、依赖或写入实例；公告只UI，生产无假消息。
- 设置实际生效：CAS保存memoryMiB与isolationDefault，固定launch-settings JSON；启动参数读取内存。新inherit实例在创建时固定为on/off，改默认不迁移老实例。目录/Java仍复用既有原生能力。
- resources.v1为5个固定方法；总计10能力/24方法。固定resource-library JSON及任务SQLite复用，官方API/文件摘要、共享对象与安装器同owner；文件在数据根resource-library/<kind>/<taskId>/<安全文件名>，优先软链接、权限不足复制。契约见docs/RESOURCES.md与docs/SETTINGS.md。
- 最新pnpm check：257测试255 PASS/0 FAIL/2原有文件软链接权限SKIP，typecheck/lint/build通过。受限环境临时目录rename/junction曾EPERM；正常权限+工作区TEMP后通过，不改Electron安全设置。
- pnpm smoke四页/账户创建/官方MC目录/设置冲突/720×520无横向溢出通过。真实三类资源独立SHA1/大小核验与worker重开保持通过；真实Electron表单搜索FerriteCore、下载后切首页继续、资源库及隔离默认值显示通过。pnpm package:dir及smoke:package默认EXE入口、内容一致、无Node、退出0/释放owner通过。证据均在docs/validation/UI-0.2.0/REPORT.md。
- 本轮未再次操作真实MC菜单/世界，启动/停止以集成回归和0.1.0用户实测为证；不得称为0.2.0全游戏矩阵实测。原生目录/Java选择器本轮未重新自动操作。历史owner接管、Java受管下载和全版本兼容缺项继续保留。
- 首次真实样本和UI下载有失败，不伪造根因；固定错误码/失败记录已补齐，独立复测通过。UI验收脚本另一次过早结束等待导致失败，实际下载随后完成；最后更小样本完整通过。失败证据与解释在报告。
- 验证脚本node scripts/verify-resources.mjs和node scripts/verify-resource-ui.mjs只使用新.test-build目录；后者打开独立测试窗口，不自动触碰用户窗口。package:dir拒绝覆盖同名交付；不要为复测删用户数据或owner。
- 原始暂存OUCL-Codex-Package.zip和OUCL.txt仍须保留，不纳入提交。使用显式路径add与commit --only，作者Li ZeRui，不push。Git状态中这两项不是未完成工程工作。

## 以下为0.1.0交付时历史快照

仅用于追溯，不覆盖上述0.2.0当前交接、TASK_PLAN或最新批准记录。

更新：2026-10-25。每次开发首先读取 OUCL-Codex/docs/TASK_PLAN.md，再核对 AGENTS.md、DECISIONS.md 和关联契约。当前源码基线09366d1，验收进度提交f131b24，最终交付记录见Git最新提交。

## 本次结果与用户指令

用户持续目标是简易Minecraft启动器Windows exe，至少含下载与启动，下载UI可参考MC_start其他启动器。用户最新明确反馈：“我经过实测，已经可以了，接下来就是给我一个可以直接运行的EXE，并进行提交”。按用户实测确认完成本次简易exe交付，不再接管游戏窗口继续世界测试。不能将用户反馈写成代理独立观察世界保存/再次启动通过。

可直接运行 release/OUCL-0.1.0-win32-x64/OUCL.exe；同名zip是完整便携目录。复制时须完整解压，exe依赖同目录运行文件，不能单独搬走。无需Node/pnpm开发环境，需已有适配Java。包未签名，无安装器/自动更新，不含Java/Minecraft。二进制和游戏数据保留在Git忽略目录，不纳入源码提交；未push。

## 授权边界

G2阶段1A，用户已明确批准下载、Java管理、离线档案、实例隔离、实际启动UI、实机验证和逐步本地提交，允许子agent并要求更新本文件。同范围不反复确认；禁止自动扩大加载器、微软登录、联机或后台。架构/契约/存储/安全基线/新依赖偏离仍需批准。

D-20已明确批准：游戏名3–16位ASCII字母/数字/下划线，保留大小写，OfflinePlayer:<gameName> UTF-8 UUID v3永久保存；中文显示名独立，改游戏名新档案。不再询问相同算法。

本次目标交付不代表阶段1A所有缺项完成，也不构成下一阶段启动。后续先等用户给新增量。

## 产品实现与最近提交

- 3975b36：官方1.20.1完整安装及大历史日志流式恢复，避免128MiB worker载入190MB历史OOM。
- ab637fa：纯LaunchPlan和真实GameProcessService；固定spawn参数、gameDir锁、真实close和确认强停。
- d796371：持久离线档案与Java注册，正常重开保持身份。
- 4571ada：严格档案/Java/settings公开契约、main/preload/React界面。
- fa67890：LaunchService、持久launch/stop任务和session JSON、game/sessions严格契约，实例启动按钮、实际退出状态、关窗口保活和正常退出收尾。
- 09366d1：0.1.0便携打包、中文使用说明、默认入口smoke与完整检查。
- f131b24：中途真实exe验收进度，后续以最终报告为准。

当前9业务能力/18白名单方法；renderer无Node，网络/磁盘/进程都在主进程。启动复用InstallerService对象拥有者并重新校验关键依赖/native。实际spawn只说明进程创建，不等同游戏菜单。

## 验证证据

最新 pnpm check：248测试246 PASS/0 FAIL/2原有环境SKIP，typecheck/lint/build通过，docs/validation/A1-09-exe/check.log。

pnpm smoke:package：真实默认exe入口、无Node、9能力/18方法、打包main与构建一致、正常退出0并释放metadata owner。证据同目录package-smoke.json和package-window.png。core覆盖100%行/函数与99.07%分支不代表整个IO/UI覆盖。

实际native操作完成目录与本机可信Java17选择、生产离线档案 OUCL 验证 / OUCL_Test1 创建。空根官方1.20.1首次安装约103MB失败，UI保留缓存，第二次从原UI安装继续下载；随后用户实测确认可用。首失败只有通用错误，不能编造具体网络根因。目录选择长等超时为结果未知，重试读取已登记结果，不等同取消。详见docs/validation/A1-09-exe/REPORT.md。

旧源码CLI主菜单证据在A1-08-official-launch；A1-09-launch-ui/game fixture实际JVM退出1不算MC运行。不能混用这些证据替代用户当前exe验收。

## 现场保留与恢复

默认exe使用系统Roaming/OUCL元数据，登记独立根 .test-build/exe-acceptance/games、本机可信Java17、上述离线档案。用户可能继续使用，不能结束父进程/强杀游戏/删锁。另有隐藏独立exe profile .test-build/exe-acceptance/profile（临时localhost CDP，旧PID29228可能变化），没有游戏业务数据；仅在确认状态后正常关闭，不删owner制造通过。

旧exec session57524已Unknownprocess，正常权限检查未找到verify-game-launch/official-game-retry进程；旧official-launch.json仍RUNNING，无自然退出/世界/再次启动证据。不要再称它活跃或改写通过。原.test-build/official-game异常owner和独立retry副本保留，不抢占锁。

下次若继续Windows操作先读computer-use技能，使用sky新窗口对象/新截图。UIA树和焦点有延迟，截图可核实；不得复用旧坐标，检测用户操作时先协调。本次用户已完成实测，当前不继续自动输入。

## 已知后续缺项

完整异常owner接管、全资产修复、受管Java供应商下载、Java8/21及旧版兼容矩阵仍未全验收。阶段1B及以后未启动。首次下载失败的具体诊断和重试体验可在后续用户批准增量改善，不隐瞒失败或称无缺陷。

## Git保护

用户原始暂存 OUCL-Codex-Package.zip、OUCL.txt 必须保留且不纳入工程提交。使用显式路径add和commit --only，Conventional Commits，user.name Li ZeRui；不git add .、reset或push。release、.test-build、node_modules忽略是有意设计。新打包版本使用新目录，避免覆盖已验证产物。

