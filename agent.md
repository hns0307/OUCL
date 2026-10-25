# OUCL 下一对话交接

## 最新现场覆盖记录（2026-10-25，优先于下方历史交接）

- 最新代码 `09366d1`，前序 `4571ada` 已完成档案/Java公开契约与UI，`fa67890` 已完成正式启动/停止任务与会话、实例启动按钮、关闭窗口保活及正常退出。下方“尚未公开接入”的历史描述已失效。
- `release/OUCL-0.1.0-win32-x64/OUCL.exe` 已生成，保留整个目录运行；未签名，无安装器，无Java/Minecraft捆绑。9能力/18方法。`pnpm check` 248测试246PASS/0FAIL/2原有SKIP、类型/lint/build通过。实际默认exe入口smoke通过，正常退出0且owner释放，证据 `docs/validation/A1-09-exe/`。
- **Goal仍active，exe真实闭环进行中。** 用户最新直接选择“交给代理继续验收”。Computer Use仅sky输入；UIA树/焦点有延迟，以新截图核对。默认exe窗口上次id68022（必须重取），已原生选择独立游戏根 `.test-build/exe-acceptance/games`、本机可信Java17并探测成功，创建生产离线档案 `OUCL 验证 / OUCL_Test1`。
- 正式UI选择官方1.20.1，从空根实际下载，无预填旧对象。第一安装任务在约103MB失败，仅通用错误不能编造物理根因；第二次确认安装复用缓存继续，上次约230MB/702MB。先查最新窗口/任务，不因观察超时重启/删锁。完整安装、世界保存/自然退出/重开仍待实际观察。
- 原生目录选择等待过长返回结果未知，重试正确读取已登记结果；Java原生选择成功。默认元数据位于系统Roaming/OUCL。另有隐藏临时exe profile `.test-build/exe-acceptance/profile`（localhost临时CDP，旧PID29228可能变化），无游戏业务数据，最后正常关闭收尾。
- **纠正下方旧运行现场：57524已Unknownprocess，正常权限进程检查未找到旧verify-game-launch/official-game-retry进程。旧official-launch.json仍RUNNING，没有自然退出/世界/重开证据，不能再称它活跃。** 保留旧owner及证据，不删锁或改成通过。
- 下一步直接完成当前exe下载→实例按钮启动→主菜单→创建验证世界→保存退出→正常关游戏/启动器→重开档案和实例→再次启动。保存脱敏证据，同步TASK_PLAN/DECISIONS/本文件并逐增量提交，审查后才goal complete。不以fixture/JVM退出1或旧CLI菜单替代。
- Git仍保留用户两项原始暂存，不混入工程提交。完整异常owner接管/所有资产修复、受管Java供应商及8/21组合等限制不写成阶段1A全部完成。

以下为历史快照，遇到上述已更新项以前文为准。

更新：2026-10-25。当前代码基线 `d796371`。每次开发先读 `OUCL-Codex/docs/TASK_PLAN.md`，再读 AGENTS.md、DECISIONS.md 及关联契约。本快照不替代用户批准或真实状态。

## 目标与授权

用户持续目标：一直做到有简易 Minecraft 启动器的 Windows exe，至少含下载与启动，下载界面可参考 MC_start 其他启动器。**Goal active，尚未达到，不能 complete。** 旧 release 仍是历史骨架；源码服务/fixture/菜单截图不等于新 exe 交付。

当前 G2、阶段1A，用户已直接批准“阶段1A下载与启动闭环，持续实现并提交”，允许并行子agent、要求每步Git提交及更新本交接。无需重问相同业务启动范围；禁止扩大到加载器、正版登录、联机或后台。偏离架构/契约/安全/新增依赖仍遵守门禁，无 push 授权。

**D-20 新的直接批准已收到并写入 DECISIONS：** 游戏名3–16位ASCII英文字母/数字/下划线，按UTF-8 `OfflinePlayer:<gameName>` UUID v3生成并永久保存；显示昵称可中文且独立，改游戏名创建新档案。不要再询问相同算法/字符规则。MD5仅兼容身份，不用于制品安全验证。大小写原样保留，精确同名冲突。

## 最近实际交付

- `1b5a116`：真实 InstallerService、固定原始官方元数据、实例JSON/index、稳定task/consumer身份、下载→共享投影→私有native→ready、main/preload/下载确认/进度/取消/实例UI。四公开能力 roots/catalog/instances/tasks，白名单10方法。221测试219 PASS/2 SKIP，Electron真实DOM两次安装fixture、缓存/重载验证。日志另提交1926f26。
- `3975b36`：真实官方1.20.1完整安装3,641制品/735,814,641字节。实际重开发现190MB操作历史全量载入导致128MiB worker OOM；独立副本复现ERR_WORKER_OUT_OF_MEMORY，改RecordStore为逐行遍历、历史映射仅留SHA256，不删日志/改schema/提高限制。相同副本恢复通过，新增112次768KiB修订大日志回归。
- 原 `.test-build/official-game` 故障owner保留，**禁止删除或抢占**。新独立 `.test-build/official-game-retry` 复制只读对象/来源、重新哈希重建索引并安装通过；metadata/root身份全新，没有继承旧view/owner。新实例 `58ffe787-b717-522f-a971-79c730e531fa`，root `235fbc3b-b852-4918-b255-b7d36c254039`。权威 `docs/validation/A1-08-official-install/`，initial-install与official-install区分两次。不要重下载或删除保留的数据。
- `ab637fa`：纯 `planOfflineLaunch`（绝对classpath/继承jar、新旧参数、占位绑定、Java/内存/argv预算、脱敏）和 `GameProcessService`（重新探测Java、gameDir wx/fsync锁、实际spawn/close、外来锁unknown、明确强停确认、不自动把graceful改强杀）。11新测试；233测试231 PASS/2 SKIP。
- **真实源码服务已启动官方1.20.1+Oracle17.0.12/x64，到完整主菜单**；66启动依赖/native树重新校验，截图 `docs/validation/A1-08-official-launch/menu.png`。Computer Use观察欢迎页/主菜单；固定里程碑identity/renderer/sound/blocks齐。世界、自然退出、再次启动与exe仍未验收。测试身份OUCL_Test1与固定fixture UUID不是生产档案。预检脚本最初native调用参数错误在spawn前退出，已修正，报告保留事实。
- `d796371`：ProfileService、固定 `launch-profiles` JSON/CAS与typed worker profiles:get/set。真实JavaProbe后的Java引用/选择保持；离线UUID与幂等请求结果同JSON事务，改payload拒绝、同名冲突、并发Java/账户不丢更新、重开身份保持。237测试235 PASS/2原有SKIP、typecheck/lint/build通过；正式Electron45/Node24.22 worker重开通过，runtime存储测试的JavaProbe明确mock。JDK17独立nameUUIDFromBytes三向量一致，OUCL_Test1=`b0cfe708-13d8-3959-b8ef-18d1540b06c9`。没有新依赖/公开IPC/SQLite格式变化。

最新契约：`docs/contracts/INSTANCE_INSTALLATION.md`、`GAME_PROCESS.md`、`LAUNCH_PROFILES.md`。最新验证：`A1-08-launch-profiles/check.log` 和 electron-runtime.json。旧installer/check.log为早期208项；其final-check.log才是221项。core覆盖100%行/函数、99.07%分支不代表IO/UI整体覆盖。

## 必须先核对的活跃运行现场

**上次确认仍活跃的 exec_command session_id = 57524。** 命令 `node scripts/verify-game-launch.mjs <可信Java17路径>`，真实游戏session `22c7e249-5eee-4381-a108-fb9fb93d04eb`。先对**同一**handle调用write_stdin/检查实际进程，不因观察超时重启。它持有新验证metadata、对象仓库和gameDir锁；用户可能正在操作游戏，**不能结束父进程或强杀/删锁来制造通过**。自然退出后会写official-launch.json、释放锁和worker。该JSON之前为RUNNING且脚本视觉字段false；独立的menu-observation.json才记录截图观察，不能混为整体验证PASS。

Computer Use工具明确检测到用户输入后，本轮停止键鼠，只保存已观察主菜单证据。不要抢用户控制。若接续窗口验证先重新列窗口/读状态，遵守computer-use技能；本轮已读技能，但新上下文需按工具规则恢复。仅使用sky API，不用PowerShell UI自动化。窗口之前由可信Java17进程持有，标题Minecraft 1.20.1；旧句柄/坐标不可复用。

## 下一步直接完成产品启动闭环

**不要再只做离散基础函数。** ProfileService还没有产品公开IPC/UI；主界面只有下载/安装与实例列表，尚无游戏启动按钮。下一增量直接：
1. 落实已批候选 `java:choose`、`accounts:list/createOffline`、`settings:get/update` 等必要严格schema/错误/超时与main/preload/UI。Java选择仅原生选择器后实测；私有Java路径/游戏UUID不能回renderer。ProfileService已可用，不重做持久化。
2. 正式LaunchService把实例ready/expectedRevision、可信Java选择、离线档案、依赖/native校验→LaunchPlan→GameProcessService接起来，使用原持久任务kind launch/stop及sessions快照，不以spawn代表菜单。将验证脚本里依赖复核整合为有类型正式服务，不把脚本当产品实现。内存还需按物理内存校验。
3. 扩展现有任务适配器：目前公共TaskSnapshot.kind仅install，InstallerAdapter拒绝非install。新launch/stop任务需要真实受理/幂等/状态/结果及订阅，session状态由实际close驱动；不要另加泛化execute/路径API。PROPOSAL_PHASE0 §7已有候选会话协议。游戏运行时关闭窗口按已批默认保活，不能直接退出拥有者/自动强杀。
4. UI Java选择、离线档案创建/选择、已安装实例启动、运行/退出状态、明确停止确认。握手目前最多4能力、10方法，新增实际能力时更新所有exact校验/烟测，避免本轮曾出现的旧max2问题。
5. 新版本Windows exe打包（保留历史release），实际默认入口下载/启动到菜单/独立测试世界、保存退出/重启、共享/隔离证据，更新交接后才审计是否完成目标。仅有CLI到菜单不足以完成。

本机此前可信Java17已实测，验证调用路径在工具记录为D:\Java\jdk-17\bin\java.exe；生产代码不要硬编码机器路径。8/21未安装，尚无受管Java下载或发行商选定，不能把Temurin/Adoptium写成批准供应商。1.20.1可用现有17推进真实exe；其余矩阵如实列未验证。完整崩溃owner接管/投影重放未实现，仍保守停写。

## Git与工具

分支main。用户暂存 `OUCL-Codex-Package.zip`、`OUCL.txt`，必须原样保留，勿git add . / reset index / 混入增量。显式自己的路径，`git -c 'user.name=Li ZeRui' commit --only ... -- @paths`；Git写入需要正常本机权限。第一次失败add后要检查cached路径，不能只用git diff --name-only漏掉已暂存代码。未授权push。

正常 `pnpm check` 在受限文件权限可能导致SQLite/链接失败并遗留测试worker；失败保留日志，确认具体本轮进程身份后才结束，使用正常本机权限复核，不修改系统策略/Electron sandbox。两个既有SKIP为文件软链接权限和Windows打开SQLite替换限制；实际fileViewMode=copy，不虚报软链接成功。

依赖/脚本以package.json为准。网络下载在主进程服务/worker，core保持纯逻辑。验证数据均gitignored .test-build，正式证据在docs/validation。不要覆盖历史报告或正在运行的验证JSON。继续每个可验证增量提交，并在成果/交接前更新本文件。
