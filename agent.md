# OUCL 下一对话交接

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
