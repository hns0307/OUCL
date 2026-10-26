# OUCL 下一对话交接

## 最新优先：下载源设置与多线程（2026-10-26）

用户最新明确要求先做下载源设置（官方/镜像）、参考PCL优化多线程，完成这些再继续原工作；TASK_PLAN/DECISIONS顶部已记真实授权。6948e7e为Mod只读UI完整检查点（真实UI证据已交付仓库），原Mod依赖事务尚未实现。自动化prompt已按最新优先级更新并保留其现有PAUSED状态，未擅自激活；本轮人工指令继续开发。

当前下载偏好第一增量：shared/contracts/download-preferences.ts，formatVersion1/source official|bmclapi/fileConcurrency1..8/connectionsPerFile1..8，默认官方4/4。既有launch-settings可选downloads字段，legacy原样读取/保存CAS保留memory/isolation，旧settings:get显式投影避免多字段破坏旧v1。profiles新增settings:downloadsGet/Update及preload两方法。尚未在main接入运行时/广告downloads.v1，无设置UI、无镜像/分段传输实现；不能声称用户请求已完成。完整pnpm check385项383PASS/0FAIL/2原有SKIP，类型/lint/build通过，日志.test-build/download-settings-check.log；真实worker重开/CAS/字段隔离测试通过。新cap类型已定义但main不广告，Electron烟测原30方法期望待随新增2方法更新。

下一增量先做传输：Source-aware wrapper保留官方DownloadSpec.url及trustanchor，镜像只影响网络路由。TransferRecord需受控transportSource标识，切源清除前缀与ETag，镜像每次从0避免不同CDN验证器混用；默认官方legacy允许原断点。官方大文件强ETag/Range分段，4MiB片、阈值8MiB、单文件连接1..8/文件并发1..8/全局连接16和单host8。复用已分配staging的显式位置异步写，fsync后只记录连续完整前缀；尾部恢复截断，禁止多片假完成。取消/失败abort并join所有连接，journal/disk错误优先，不覆盖未知数据。HTTP不支持Range安全回退旧单流。最终对象仍经ObjectStore完整hash。InstallDownloadService并发和DownloadCoordinator目前均固定4，需接preferences getter并提供限额；进度目前只verifiedBytes，需加入实际传输进度但不冒充已校验。HttpTransfer原有完整测试保留。

已读PCL ModNet.vb IsNoSplit/TryBeginThread/Range/SourceFail，只借鉴无复制。PCL本身对bmclapi等不分段，采用多文件并发；BMCLAPI官方文档https://bmclapidoc.bangbang93.com/要求可视署名，libs→/maven、assets→/assets；不以镜像元数据为独立信任。实际只读探测guava31.1-jre：BMCLAPI302至mirrors.cernet.edu.cn再302mirrors.qlu.edu.cn，最终200/2959479字节。拟固定HTTPS镜像host allowlist，未知跳转回退官方。原版client/Java piston对象、已支持Maven可映射，未知保持官方。无新包，不需要引入第三方下载器。

下载设置UI接好后实际切换保存/重开验证、镜像完整可信文件下载、官方大文件真并行/恢复取消/对照吞吐、无Range回退/坏片/跨源/哈希不符/连接上限测试，完整check/现有smoke；然后恢复Fabric/Quilt实机与Mod依赖计划。不要只交付纯配置。官方F/Q最新重试仍CATALOG_UNAVAILABLE（日志.test-build/fabric-retry-20261026.log、quilt-retry-20261026.log），三个官方manifest/profile GET探测200，尚未定位。两个监督器已自然失败/finally关闭，未遗留游戏。测试rootowner恢复标记和旧natives材料保留。当前无push，原两份暂存排除，额度约10%已用/窗口1793032740，继续前再核对。

## 最新：实例 Mod 只读 UI 已完成（2026-10-26）

继75918d7公共IPC后实现src/ui/ModPanel.tsx，首页所选实例下列表/一键双重检查、实际身份/摘要/来源、问题/未知/范围/依赖链、观察时间/修订。只读，无安装按钮；历史报告不作写入许可。接受超时保留requestId，tasks订阅/取消，分页恢复历史报告只取匹配实例；全局活动任务未知归属会明确标注。任务kind=mod-check所有状态显示检查文案，非安装完成/Java准备。

完整pnpm check383项381PASS/0FAIL/2原有SKIP，最后文案/布局又typecheck/lint/build通过。正式main/preload/UI真实Forge和Neo两个既有独立测试实例列表/双重检查satisfied、uXXizFIs来源、窗口重载原checkedAt不变及720×560无横向溢出通过；大/小截图已实际看过。证据docs/validation/MODS-UI-0.3.0/。脚本scripts/electron-mods-smoke.cjs固定.test-build/official-loader-*测试根；原独立root未搬动，测试Mod各一个仍在，无owned游戏或存储锁。首轮测试脚本DOM克隆失败留下自有owner标记，已按精确UUID保存为同metadata/owner-recovery-f72d43d9-d950-4a3c-947b-831d3f926f6c.lock；没有删除恢复材料；失败/超时现走正常关闭。

下一最小增量：依赖候选递归解析（固定版本、平台项目去重、32层/256项目、循环/全约束），结合真实modId证据与下载后声明复验，再玩家确认及一次安装差异/事务/恢复。此时不要把UI只读检查当作安装交付。可先重试官方Fabric/Quilt安装并补实机矩阵，禁止镜像信任放宽。仍需未来分发契约/测试适配器、原版回归及0.3.0小EXE。最近quota已用10%/周15%，窗口1793032740；不是暂停，继续时再核对。原两份暂存、无push、不碰用户游戏等边界继续。

## 最新恢复：Mod 公共接口已接通（2026-10-26）

已核对额度实际重置为0%，resetsAt1793032740，从041ea1b恢复。本段覆盖下方等待状态。当前G2批准不变、分支mod_loaders、原始两份暂存保持排除、不push。新src/ipc/mods.ts严格入口/dispatcher、preload-mods与LauncherBridge、main服务装配和mods.v1能力按初始化及InstallerAdapter实际可用才广告。Mod记录损坏初始化失败只停Mod能力，原有服务继续；关机先Mod任务close等待读取退出后存储最后关闭。通用tasks查询/列表/取消和重连已集成，kind=mod-check。

完整pnpm check383项381 PASS/0 FAIL/2原有SKIP，类型/lint/build通过；独立Electron smoke30方法/13能力含mods.v1、schema/root错误、安全边界及原四页通过。证据docs/validation/MODS-IPC-0.3.0/。新增集成测试public Mod admission验证窗口断开旧sender不可用、新sender重订阅、取消等待扫描退出/原因持久。首次受限检查权限失败，正常权限+独立TEMP最终通过；不是EXE交付。

下一增量实例Mod面板：列表/一键双重检查、证据与未知原因、历史时间/实例修订、任务订阅取消重连，mod-check不要显示Java准备文案。随后递归依赖候选/确认/事务；下方真实Forge/Neo报告和测试根仍有效，Fabric/Quilt官方网络失败待重试，版本仍0.2.2。尚未完成全部目标，保留自动化；开发前重新核对额度，10%以下保存暂停。脚本package/bootstrap-smoke仍对应旧0.2.2交付，最终0.3前需按实际新界面/API调整并重新跑，不能冒充本轮EXE通过。

## 最新检查点：052e0c9，等待额度实际重置（2026-10-26）

以下为当前唯一续接快照，后文较旧“当前有效交接”均为历史。最近get_usage_limits：5小时已用86%（剩14%）、周13%，resetsAt=1793014620。已保存停止新大增量；后续心跳剩余不足20%安静等待实际重置，10%或以下不得开发，重置后继续最新HEAD，不回退164daf3。自动化oucl保持，完整目标未完成，不停用。分支mod_loaders；原始暂存OUCL-Codex-Package.zip、OUCL.txt始终排除，不push、不碰用户原有游戏数据。

本轮主线：02e9aeb四加载器真实测试入口；f6cb194有界JAR worker；d232058官方版本语义修正；5efa1b0/4a5d39f四声明纯解析/worker解释；dc6d8b2官方Maven三次有限网络重试；7652596本地兼容；4c568e1只读库存；7a37b3a Modrinth精确SHA512来源/固定前置/候选；83821aa实际MANIFEST解析固定jarVersion；4d96fe3真实Forge/NeoForge测试Mod；67b8495双重证据；410b9bb真实文件稳定复验和官方语言对象；6e10750公开报告；9d28719版本化Mod任务/报告存储；052e0c9持久可取消检查编排。最新完整pnpm check379项/377 PASS/0 FAIL/2原有SKIP，类型/lint/build通过。日志docs/validation/LOADERS-0.3.0/check-mods-20261026.log；普通bootstrap/依赖审计沿用先前证据，本轮无新依赖，未造新EXE。

真实游戏：Forge47.4.28/MC1.20.1/Java17，FerriteCore6.0.1（项目uXXizFIs，版本DG5Fn9Sz）两次Mods列表与退出0；NeoForge21.1.265/MC1.21.1/Java21，FerriteCore7.0.3（x7kQWVju）两次Mods列表与退出0。各有两张截图；NeoForge此前不带Mod时一次3221226505失败未定位，仍保留。Fabric0.16.14/Quilt0.29.2官方安装metadata/Maven请求失败，未形成ready，不改用镜像或本地摘要绕过。所有候选仍unverified；真实完整FQ矩阵/原版回归及EXE验收未补齐。当前没有遗留owned测试游戏、安装/扫描监督器或存储owner。

独立测试根仍.test-build/official-loader-qAJLBD，rootId00f56e90-c7d1-43e8-b38c-0855a1bd7e45；Forge实例07ee75a2-fa9f-5969-86bd-01bcdb478dfb修订64，Neo实例44b298d7-9351-5f8e-b68f-3112437e1d23修订69。各自mods中只有本轮手动供应的一个测试Mod；供应入口tests/runtime/official-loader-test-mod.ts仅测试用，不是已完成的玩家确认事务。旧Forge natives恢复目录两份保留，未删除、不再用于启动。computer-use技能和三个参考文档已读，sky全局在node_repl；旧窗口ID全部失效，重新list/唯一定位。不要操作用户其他启动器/游戏窗口。

生产能力边界：ModArchiveReader有界只读worker校验实际摘要/CRC/路径、四种JSON/TOML、嵌套/体积/深度；publicModReport严格2MiB/512问题/无机器路径或原文。ModInspectionService先本地扫描、SHA512平台关联、再次完整扫描/环境复验。Forge语言版本47、NeoForge独立FML组件4.0.45来自已校验官方组件，实际日志一致；Java仍null，遇Java版本约束要保留未知，后续补受控实测，不能填major冒充完整版本。JarJar选择、Quilt unless/备选/组限定/插件等目前显式未知。普通未知文件不作为依赖或删除目标。

持久任务真实证明：Forge任务deca0569-fb6e-40ff-84fb-748bbb3ab40c、Neo任务fc72074f-fb40-41cf-b187-eaad15af1017，local/combined均satisfied、固定来源matched。公开导出FORGE_MOD_REPORT.json、NEOFORGE_MOD_REPORT.json；另起进程fetch必定失败后回读同任务/原报告通过。复现：打包tests/runtime/official-mod-inventory.ts，OUCL_LOADER_TEST_WORKSPACE设上述根，OUCL_MOD_TEST_TASKS=1；加OUCL_MOD_TEST_TASKS_REOPEN=1只重开历史报告。默认入口仍另做只读当前库存，历史报告不授权写入。真实语言对象/平台证明详见docs/contracts/MOD_ARCHIVES.md、MOD_PLATFORM.md、MODS.md。

下一最小增量必须是公开接入：实现src/ipc/mods.ts严格sender/envelope处理、ModTaskService dispatcher/适配及preload bridge；main装配ModInventory/Inspection/InstalledLanguageReader/TaskService并initialize，追加InstallerAdapter AdditionalTasks get/list/cancel和关闭顺序。仅在服务/preload均可用时广告mods.v1。现在LauncherBridge/握手能力仍27方法/12能力，mods.v1没有广告；只有shared/contracts/mods.ts定义3通道，尚无公开处理器/桥接/UI。ModTaskService可供tasks.v1订阅形状，当前非终态snapshot.stage=preparing、bytesDone=0（无假下载进度），UI需按mod-check显示模组检查，不沿用Java启动文案。任务模式list只本地、check双重；报告标时间/修订，重连不当作永久写权限。所有IPC方法先schema再双端实现；旧接口和原版保留，测试/实际Electron smoke验证能力/重连/取消/安全后提交。

之后：实例Mod面板/一键检查与资源库“安装到实例”真实方案；Modrinth前置项目/固定版本递归（32层/256项目）、真实modId对应证据、JarJar选择与复杂条件、玩家确认候选/被谁依赖、下载后实际声明复验、修订/哈希/会话复核和一次提交/恢复。游戏运行或会话未知禁止修改，不升级现有Mod/加载器、不覆盖同名不同内容，不删未知Mod/存档/配置。未来分发接口/测试适配器仍需完成，禁真实后台。最终完整质量/引导/依赖许可/UI/EXE与原版回归，0.3.0小EXE保留同级OUCL.runtime及旧交付物；现在package仍0.2.2。新第三方依赖仍需评估批准；smol-toml1.9.0已按原计划批准/审计安装，无新增包。

## 当前有效交接：mod_loaders 开发中（2026-10-26）

后续最新覆盖：4c568e1只读库存、7a37b3a Modrinth真实SHA512/候选适配、83821aa实际MANIFEST固定jarVersion、4d96fe3 Forge/NeoForge测试Mod各两次真实Mods菜单与退出0、67b8495双重证据规则。当前继续双重检查编排及语言对象复验（本次提交hash以git log为准），最新完整366测试364 PASS/0 FAIL/2原有SKIP，99.02%行/96.98%分支/99.54%函数。真实两个实例均已按SHA512关联FerriteCore项目uXXizFIs，版本分别DG5Fn9Sz与x7kQWVju；实际JAR版本6.0.1/7.0.3，受控语言对象复验后javafml为47/4.0.45，local和combined均satisfied，平台失败=[]。证据MOD_PLATFORM.md、LOADERS-0.3.0/REPORT.md，日志.test-build/mod-runtime-evidence-check.log。最近quota41%（之后还需再查），窗口1793014620；不是暂停状态。

下一最小增量明确为把现有只读库存/双重检查接持久任务与mods.v1、实际界面，再实现依赖图/确认下载/事务。当前没有公开Mod IPC/UI。任务须复用既有幂等/进度订阅/取消/重连，不把长扫描塞进会超时的同步IPC。要先定义公开DTO/错误/schema/超时，再实现主进程与preload/UI；任务结果需版本化保存、未知格式停写。Java仍不自动推断，Java要求缺确切测量时保持unknown；语言测量只对代表系列及官方组件事实开放。JarJar选择及Quilt复杂条件仍未知，不伪装已完成。实际两个测试实例现在各有一个手动供应测试Mod，不能再称空Mod目录；供应入口只是tests/runtime/official-loader-test-mod.ts，不是产品安装事务。

最新进度覆盖下文旧暂停快照：额度已实际重置，最近5小时已用24%、周4%、resetsAt=1793014620，当前可继续既定授权，不需等旧窗口。02e9aeb记录NeoForge不改参数连续两次主菜单/退出0，旧3221226505间歇失败仍未定位。Fabric0.16.14/Quilt0.29.2官方安装入口已扩展；Fabric有效官方profile已读到，但Maven证明网络持续失败，dc6d8b2三次有限重试后仍CATALOG_UNAVAILABLE；Quilt亦metadata失败，暂没有ready。不要将网络失败改成信任成功或切镜像。

本轮新实现：f6cb194有界只读JAR worker；d232058修复Fabric caret0.x/tilde及不支持运算符语义；5efa1b0四声明纯解析；4a5d39f实际worker内JSON/TOML解释与回复复验；7652596本地兼容报告；随后只读实例库存IO（以git log最新提交为准）。详见docs/contracts/MOD_ARCHIVES.md。生产worker在真实NeoForge官方共享对象读到neoforge21.1.265/javafml[3,]；对象SHA256 c12cf1a6cb0aa7792b13174b06088a4f54d8bcc92f6a32fcb03310b456936847。完整最新pnpm check350项348通过/0失败/2原有跳过，核心99.10%行/96.82%分支/99.50%函数；日志.test-build/mod-inventory-check.log。运行测试入口tests/runtime/official-mod-inventory.ts已验证本轮独立Forge/NeoForge实例目录及空Mod库存，不创建玩家文件。

下一最小增量：先将只读实例库存/本地检查接mods.v1契约和实际UI，再补Modrinth文件哈希关联、平台/本地证据冲突与来源候选。JarJar现在仅发现原文并显式未知，需实现真实声明/选择再计嵌套满足；Quilt unless/备选/组限定、未知插件/变量/排序等目前保守未知。后续依赖递归32层/256项目、确认下载、提交修订/实际哈希/会话复验与恢复仍未实现；四加载器额外测试Mod、Fabric/Quilt真实矩阵及0.3.0EXE都未交付。当前没有遗留owned游戏或安装监督进程。不要重复使用旧窗口ID。参考源码不复制、不push，原始两份暂存继续排除。

用户明确要求完整实施《四加载器接入与 Mod 管理修订方案》，分支为 `mod_loaders`，批准记录见TASK_PLAN顶部及DECISIONS顶部。北京时间2026-10-26本次交接前5小时已用89%、周额度74%，窗口resetsAt=1793002434。已保存暂停新大增量；后续心跳剩余不足20%安静等待实际重置，10%或以下不得开发。

最新增量807e85c：真实运行发现JNA/LWJGL/Netty将临时DLL和解包缓存写入受校验natives目录，导致严格复验拒绝重开。已把运行写入分离到实例`.oucl-launch/jna`与`native-cache`，不放宽原native校验。Forge完成主菜单→Quit Game退出0→再次主菜单→退出0，截图已归档。NeoForge首次主菜单/退出0通过，第二次主菜单通过但Quit Game后返回3221226505（0xC0000409），不能标重开正常退出通过；需继续排查原生退出问题。两种测试游戏和监督进程均已结束，无遗留owned游戏。

当前四加载器安装事务与下载页均已接入，最新94ec0db开放Forge/NeoForge候选（仍标运行未验证、固定隔离）；3edf918/44e59be/175553b接入共享安装器下载、对象回读、私有输入、受管Java、处理器、派生产物发布及启动复验。8735f76补齐官方实测发现的32MiB日志预算、有限元数据重试、提取排队；f473f23允许客户端JAR最多65534条目，native仍4096；2f4b9bc修复Forge模块排除列表与继承共享JAR物理文件名不一致问题。**Mod管理、四加载器游戏运行矩阵和0.3.0仍未交付**，版本0.2.2；未触碰用户游戏数据，未push。

依赖评估已完成：smol-toml 1.9.0，BSD-3-Clause，npm解包139963字节、无声明运行依赖；生产依赖audit 0漏洞，许可证检查128包无待审，记录在docs/DEPENDENCIES.md及licenses.json。Fabric/Quilt事务相关的隔离安装、取消、重开和启动链测试20/20通过；公共契约/握手目标测试、typecheck、lint、build及隔离Electron smoke通过，后者确认27方法/12能力和原版/Fabric/Quilt三选项。完整`pnpm test`本轮在受限执行环境再次出现多项既有SQLite/传输失败并长时间不结束，已中断，不能标整库通过；最终交付前须在正常权限与隔离TEMP环境保存完整`pnpm check`结果。

下一最小增量：先排查NeoForge第二次正常退出的原生异常（latest.log已记录Stopping!，未发现根目录hs_err文件；不要猜根因），复测到连续正常退出，再补Fabric/Quilt真实官方安装及四种额外测试Mod。之后实现有界JAR worker、mods.v1、Modrinth与声明双重检查、确认依赖/文件事务及UI，最后0.3.0小EXE。computer-use的SKILL/guidance/api/confirmations已完整读取且用过，跨会话应按技能恢复；窗口ID均已失效，不复用坐标。测试Java21由既有已测系统运行时复用，窗口app可能不在official-loader路径，应按新返回的NeoForge标题和对应Java窗口唯一定位。

官方安装实测：独立根`.test-build/official-loader-qAJLBD`，Forge实例`07ee75a2-fa9f-5969-86bd-01bcdb478dfb`修订64，NeoForge实例`44b298d7-9351-5f8e-b68f-3112437e1d23`修订69。两种都完成官方依赖、六步链/七产物、ready提交及断网重开prepareLaunch；本轮实际游戏结果见上文。启动复现：打包tests/runtime/official-loader-launch.ts到.test-build/official-loader-launch.mjs，设置OUCL_LOADER_TEST_WORKSPACE为此独立根、OUCL_LOADER_TEST_KIND为forge或neoforge运行；监督器会等实际游戏退出再释放存储。仅测试Forge的旧natives目录被保留为natives-recovery-20261026、natives-recovery-lwjgl-20261026，未删除，不用于未来启动。证据、截图和失败历史在docs/validation/LOADERS-0.3.0/。

实际恢复记录：首次Forge两次下载NETWORK_FAILED，另有CATALOG_UNAVAILABLE；一轮ART因原128KiB总日志预算终止。均保留材料，重试后成功，没有宽容哈希。NeoForge首轮成功。完整pnpm check已在正常权限+仓库内独立TEMP通过，整库受限环境故障不再是当前阻塞；最新日志见上述证据目录。audit无漏洞、128包无待审、19项bootstrap通过；Electron烟测确认原版+四加载器、27方法/12能力、四页/设置/小窗口均通过。0.3.0尚未打包。

Git保护：原始暂存OUCL-Codex-Package.zip、OUCL.txt继续保留，不纳入本次提交；显式路径add/commit --only，不push。历史1A及阶段0缺项不关闭。用户此前允许多agent仅在历史1A上下文，本轮尚未委派子agent。

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

2026-10-26main独立实现并验证后已精确同步mod_loaders：397项395PASS/0FAIL/2原有SKIP、实际下载设置保存重开、32方法14能力Electron通过。完整main证据/0.2.3EXE在D:/MC_start/OUCL-download-main，main:d2521bb；本分支不改为0.2.3交付、不抹加载器/Mod能力。原WIP按SHA256保存在.test-build/download-wip-preserved-20261026/，两份原始资料仍暂存且排除提交。原版重开通用缓存修复本分支此前807e85c已存在；公网严格分段仍因官方ETag/If-Range不满足而回退，不把它写通过。现恢复F/Q失败诊断与Mod原目标。
