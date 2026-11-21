# OUCL 下一对话交接

## 当前有效交接：界面优化（2026-10-28）

分支mod_loaders。本次目标已实现并通过验证：可收起侧栏、论坛UI及可替换前端接口、配色/品牌图标/首页布局、低频设置折叠、内存滑块、资源自身图标与拖动。用户直接批准固定外观/草稿记录和受控图标接口，并补充接口便于以后接后台；不连接后台、不恢复此前Esc停止的游戏操作、不跑外网测试。

代码提交：dfff42b修复既有Mod失败报告；473eb7e新增desktop.v1及固定desktop.json/worker/CAS和受控图标；6af8f0e完整UI与隔离窗口脚本。证据与交接另行提交，以git log为准。512项510 PASS/0 FAIL/2原有SKIP，typecheck/lint/build通过；最后样式整理后再次类型/lint/build及两轮窗口重开验证通过。证据docs/validation/UI-20261028/REPORT.md，接口docs/contracts/DESKTOP_UI.md。

论坛只投影真实本地草稿，支持分类/搜索/列表/详情/编辑/删除；ForumDataSource有list/read和可选publish，默认不发布，不在renderer直接fetch。desktop记录独立于启动/下载设置；六个新方法，总42方法/16能力。图标由主进程本地选择或官方项目/CDN读取、限流/限体积/重编码PNG；renderer仍无外部图片或网络。内存滑块沿用原保存与真实启动参数；布局支持人物左右、间距、卡片排序/隐藏和键盘替代。

实际窗口验收使用独立档案、真实main/preload/worker，所有网络为固定本地夹具，外网0；本地图标对话框返回自有文件，随后走真实读取与Electron重编码，不称人工操作原生选择器。测试覆盖侧栏/配色/暗色预览跨侧栏保存、图标、滑块、折叠、论坛草稿、资源拖入/图标、分栏键盘调宽、720×560四页与正常重开/owner释放。

预览：release/OUCL-0.3.0-ui-20261028.exe，353280字节，SHA256 aef57c68e112a5ce88853acc2bce814cf3fba8ce72385767c9ea28e23bc2f65f。本地打包及静态嵌入ZIP验证，不是完整0.3发布，没有运行该EXE的冷/热网络验证；不合并main、不push、不覆盖旧包或停止用户游戏。用户试用前需正常退出旧OUCL。既有加载器/Mod产品接入和实机矩阵缺项继续保留，不以本UI完成覆盖。

整库首轮既有Mod失败报告引用空库存外的文件且总体兼容状态矛盾，close抛NEEDS_RECOVERY遗留测试worker；只结束已确认的测试子进程后做最小修正，原用例自然退出及整库通过，未放宽schema/删owner/操作游戏。原始OUCL-Codex-Package.zip与OUCL.txt当前为未跟踪文件，继续排除，以真实git status为准，不照历史快照重新暂存。

## 以下为历史检查点，不覆盖上述当前交付

## 2026-10-27 便携目录与版本设置检查点（额度暂停）

当前分支`mod_loaders`，HEAD仍196bfd7，工作区新增便携目录/版本设置增量待提交。用户明确要求EXE同级自动游戏主目录、版本设置文件夹入口、完成后合并main并生成0.3 EXE，允许Strata。Strata本地模型ready且仅审查方案；采纳外层Bootstrap传可信目录和opaque ID+enum契约，拒绝其改Installation格式/拒绝旧根建议。实现：Launcher.cs传`OUCL_PORTABLE_ROOT`；main仅在没有Installation记录时创建并注册`OUCL.games`，已有自选根不覆盖；新增`instance-folders.v1`，主进程从持久实例元数据重建实际隔离/共享gameDir，只打开game/mods/saves/resourcepacks/shaderpacks/screenshots/logs，拒绝链接逃逸；首页新增版本设置面板；package/UI版本预置0.3.0。

验证：`pnpm typecheck` PASS，`pnpm lint` PASS，`pnpm test` 457项/455 PASS/0 FAIL/2原有SKIP，外网0。首次测试仅因Windows短/长路径表现不同失败，改为realpath比较后全过。尚未跑build、bootstrap测试、包烟测，未合并main，未生成0.3 EXE；Mod计划持久化及玩家确认安装事务仍未完成。原始`OUCL-Codex-Package.zip`和`OUCL.txt`继续保持用户暂存且排除提交。额度检查91%已用，按用户规则提交后暂停至实际重置。下一步：从本提交继续`pnpm check`、bootstrap测试/本地EXE冷热启动（不联网则复用缓存）、审查main与mod_loaders合并关系，再合并到main并生成/校验`release/OUCL-0.3.0.exe`；不得把目录入口冒充完整Mod安装交付。

## 最新加载器选择：本地 UI/IPC 通过（2026-10-27）

f45f58c为四加载器接受凭据离线恢复；本增量shared/contracts/loader-targets.ts统一参考组合（Fabric0.16.14/Quilt0.29.2/Forge47.4.28的MC1.20.1+Java17、Neo21.1.265的MC1.21.1+Java21），不声明已验证。实际目录稳定目标优先，否则其他稳定版本；没有稳定项时不自动选预发布。主进程与UI同一Forge/Neo MC接入界限。InstallPanel跨MC/loader立即清空旧options、忽略旧promise，参考组合MC/Java可见；参数接受中禁改、旧表单应答不污染新上下文，目录错误可重新获取，未就绪/不支持组合不能提交。

完整check440项438PASS/0FAIL/2原有SKIP，typecheck/lint/build通过，末尾脚本修订后lint也通过。独立Electron正式main/preload/UI，脚本进程级fetch仅固定本地响应、renderer HTTP/HTTPS被阻断，外网0；四加载器目标/Java、unsupported MC阻止、跨MC旧选项清空、快速切换旧响应不覆盖、无root不接受安装、720×560无横溢出、正常退出owner释放均通过。截图已实际检查可读性。证据docs/validation/LOADER-SELECTION-20261027/；fixture不是实际安装/游戏，不能冒充实机通过。首轮隐藏窗口超时/UnknownVizError材料保留，改独立窗口/关闭后台节流后通过，不接管用户窗口。

用户当前仍要求跳过联网测试、优先加载器。下一步tests/installer.test.ts补Quilt/Fabric目标本地安装/取消/断网夹具重开：当前fixture默认Fabric0.20.1+MC fixture，只有Fabric集成，Quilt实际共享事务未独立覆盖；建议把fixture可参数化loaderKind/MC/version，保留旧测试默认，新增参考版本本地case。假制品不得记为MC实机。Forge/Neo组件级processor本地fixture已有，真实此前曾通过但保留异常历史；别为补联网/游戏矩阵重新请求外网/Windows输入。ModReader/候选已完、确认安装事务仍缺，整体0.3.0未完成。

最近额度61%已用/周39%，窗口1793087081，继续前再查；剩10%及以下必须保存暂停等待实际重置。原始两份暂存排除、不push、不碰用户游戏。

## 最新加载器接入：本地接受凭据恢复（2026-10-27）

用户当前优先仍“跳过联网测试，优先模组加载器”，不跑外网或已停止的窗口操作。749eadc保存ModLibraryReader；本增量LoaderService.create先调用InstallerService.findAcceptedLoader，当前registered root+规范payloadDigest+requestId经StorageClient/worker/RecordStore/TaskTable.findAccepted只读查原requests/tasks。准确接受凭据直接返回原taskId，不再依赖远程catalog；同ID不同参数新增loaders.v1 REVISION_CONFLICT，不错复用。首次请求依然核对官方目录/隔离。相同在途请求合并，最多16不同待接受请求；UI TIMEOUT和UNAVAILABLE均保留requestId。新私有find-accepted协议严格无SQL/路径/额外字段，原DB表/格式不变。

完整pnpm check437项435 PASS/0 FAIL/2原有SKIP、typecheck/lint/build通过；全是本地/mocked/loopback夹具，不外网。新增3个真实SQLite/协议测试+1个服务并发测试：缺失只读不创建请求、状态不改、owner隔离/类型/摘要冲突、重开后四加载器原凭据恢复且catalog调用0。证据docs/validation/LOADER-RECEIPTS-20261027/。原始两份暂存排除，不push/改用户游戏。

下一步加载器产品接入：集中共享代表矩阵（Fabric0.16.14/Quilt0.29.2/Forge47.4.28对应MC1.20.1+Java17，Neo21.1.265对应MC1.21.1+Java21）；下载页默认优先目录实际存在的稳定代表版本，显示目标MC/Java及尚未验证状态，清掉跨MC/加载器遗留版本选项，主进程/界面统一Forge/Neo支持边界，其他组合不冒充已验。用纯逻辑/本地夹具覆盖，不联网。之后按原四加载器安装/处理器/恢复缺口与Mod确认事务继续，0.3.0仍未完成。

最近额度31%已用/周34%、窗口1793087081（历史，继续前需再查），可继续开发；10%剩余以下保存暂停。main下载已完成并同步，不回退；自动化完整交付前不删除。

## 最新优先：跳过外网测试，先加载器（2026-10-27）

用户原文“跳过联网测试，优先模组加载器”。接下来停止外网测试，优先Fabric/Quilt/Forge/NeoForge本地安装/启动接入修订与夹具验证，保留未完成的外网/实机矩阵，不恢复原Esc停止窗口操作。main下载优化已完成，不重复开发。

d066a9d为有界候选回溯（428/426/0/2）。本次来源前置ModLibraryReader只接收资源库受控标识，检查下载完成/项目版本/对象sourceKey、实际SHA1/SHA256/SHA512及大小/真实JAR声明，并在平台读取后复验资源记录、注册根和文件stamp；不写实例。433测试431PASS/0FAIL/2原有SKIP，完整check及runtime入口typecheck/lint通过。指令前联网夹具已结束：首次NETWORK_FAILED保留，同官方固定文件探测200，有限重试中三个FerriteCore真实资源下载及Reader复验均通过，测试rootId7a880384-9fdb-4800-bf92-8407425e7469、只在新建.test-build/mod-library-*根，无实例写入。证据docs/validation/MOD-LIBRARY-20261027/；无需再联网跑。当前没有该测试监督器需要取消。

加载器审查发现优先修订点：LoaderService.create先远程catalog再InstallerService.createLoader，这使已持久接受的同requestId重试受网络或目录变更阻挡。应先从受管SQLite请求幂等表只读查询同root/request/kind/payloadDigest的既有接受；匹配直接恢复原任务，不新任务/不联网，内容冲突明确拒绝；首次新请求仍验证官方目录和隔离再接受。TaskTable已有requests表，无需改DB表格式，可新增固定worker find-accepted只读指令，主进程不直连SQLite。InstallerService.enqueue/admit已有规范输入/digest及实例恢复检查，要复用/保持，不能无条件返回不同payload的任务。loaders.v1目前无REVISION_CONFLICT代码，需在原批准契约内补明确映射。渲染端接受超时或UNAVAILABLE应保留请求ID。后续确认四加载器独立本地夹具安装、取消/恢复/重开和原版兼容，不做外网或Windows输入。

原始两份暂存排除，--only显式路径本地提交，不push、不碰用户游戏。最近额度已用7%/周31%，窗口1793087081为历史，继续前重新核对。完整0.3.0、Mod确认事务、分发契约/适配器仍未完成。

## 最新执行：有界候选组合提案（2026-10-27）

用户已切回Default并明确继续完整批准方案，已核对额度0%已用/周29%、新窗口1793087081；从c2f0247继续，main下载优化已交付/同步，不重复。新增services/mods/resolver.ts：ModDependencyResolver在既有候选收集上按稳定/发布时间/ID探索项目选择并回溯；精确根/玩家选择/已装不变。候选全量512而非只展示32，默认1024搜索状态/最高4096，图评估间30秒预算/让出事件循环、最多512网络读取/8MiB缓存。耗尽上限返回SEARCH_LIMIT未知；完整穷尽冲突附NO_SOLUTION。未知证据不变通过，失败读取不伪装冲突；合法toString项目只读own selections。无新依赖/IPC/存储格式。

完整pnpm check428项426 PASS/0 FAIL/2原有SKIP，类型/lint/build通过；11新增测试。日志/证据docs/validation/MOD-RESOLUTION-20261027/，本增量无实际Mod下载/文件写入。下一最小增量从已下载资源库受控身份读取真实JAR预览，复验实际摘要与精确平台来源、当前实例库存/修订，结合候选提案；其后实现公开计划/确认/取消和持久一次安装/恢复，任何未知和文件/会话变化必须阻止写入，不覆盖外部修改。Java完整版本测量仍需补足，不能拿major猜完整范围。原用户Esc停止Windows输入尚未重新许可，不操作游戏窗口；可推进后台和只读诊断。

分支仍mod_loaders，原始OUCL-Codex-Package.zip/OUCL.txt两份暂存始终排除，所有提交--only显式路径，不push。0.3.0、Quilt实机、Fabric异常退出/重开、Mod安装事务与分发契约适配器未完成。自动化完整交付前不删除；本轮实际恢复后最新prompt需从当前HEAD与本交接执行，不能用旧优先指令重复开发main下载。

## 最新检查点：main下载完成，mod原计划已恢复（2026-10-26）

用户物理Esc停止Computer Use，本轮立即停止一切窗口输入并保存；不要在没有重新许可的情况下继续接管游戏窗口。随后日志确认本轮Fabric游戏已退出4294967295，监督器退出1并正常关闭owner；不是正常退出通过，也不推断Esc是异常原因。当前没有本轮运行中游戏需要强杀。原自动化保持PAUSED。

main独立工作目录D:/MC_start/OUCL-download-main，最新main:d2521bb。0.2.3小EXE release/OUCL-0.2.3.exe，241152字节，SHA25603206c0af601950d7d33917481b9e72288fea61abc50defa3cc3c5e5cd2b0c52。最终单EXE冷启动25.239s/热启动、同级OUCL.runtime、安全边界26方法11能力通过；原版新根3641制品735814641字节及正式服务两次菜单/Quit退出0通过。源/并发/严格偏好/实际设置UI完成，不含加载器/Mod代码，无新依赖，不push/发布。原版native运行缓存污染的通用修复已在main1bfb8c5验证。main工作区干净。

下载优化精确同步mod_loaders：f5a8fb4，保留全部四加载器/Mod能力；397测试395PASS/0FAIL/2SKIP及32方法14能力Electron、下载设置独立重开通过。原目录先前WIP已逐文件SHA256核对并保存在.test-build/download-wip-preserved-20261026/（copies/originals/tracked.patch/hashes.json）。两份原始暂存OUCL-Codex-Package.zip、OUCL.txt始终保持暂存且排除提交。固定源官方/BMCLAPI、文件/单文件1..8默认4，总16/host8、官方标准强ETag精确Range4MiB分段、镜像单流/未知跳转官方回退/连续前缀fsync/取消join/完整hash发布。官方当前公网旧AzureETag/If-Range不满足条件，安全回退单流；公网实际分段及吞吐提升未通过，不放宽校验。

mod恢复进度：45d9dde纯已选平台依赖图（全来路固定版本约束、32层/256项目、循环、旧项目精确复用、未知身份/文件选择）完成。04ce066官方后台profile网络不可用最多3次有限重试，坏数据不重试、取消不开始下次；实测捕获Fabric profile连接超时、Quilt profile/Maven也有UND_ERR_CONNECT_TIMEOUT，保留失败。最新只读ModCandidateService递归补齐固定版本、项目级候选需明确选择、按项目/版本去重/不升级/取消与体积上限完成（提交hash以git log为准）。417测试415PASS/0FAIL/2原有SKIP、typecheck/lint/build通过，日志.test-build/mod-candidates-check-verified.log。

最新Fabric新测试根.test-build/official-loader-1bwU65，实例1971f881-fa70-5385-9eb2-55a6b862a0cf，Fabric0.16.14/MC1.20.1已真实安装ready并prepareLaunch通过，739685297字节；官方元数据/摘要+BMCLAPI字节。测试FerriteCore unerR5MN（Fabric/Quilt6.0.1、无平台前置）已供应，实际SHA512/大小/声明通过，日志确认FabricLoader0.16.14、Loading5mods、ferritecore6.0.1。UI仅观察首次欢迎/Continue，下一次主菜单核实被物理Esc停止；退出码4294967295，未定位，不标实机矩阵完成。新测试入口一度误加无close接口导致清理失败，修正并保留失败；仅对该已退出自有测试的精确metadata owner350d4c06-aeb3-4874-a8c1-1a0d65d4efc6及objects.owner f2df0a2b-14d5-4273-bf77-d5f2d5ea9e47改名保存恢复材料，未改生产锁保护。完整证据docs/validation/LOADERS-NETWORK-20261026/REPORT.md。

下一最小增量：用户允许后复验Fabric主菜单/正常退出/再次启动并定位非零退出；Quilt官方真实安装/两次运行还缺。Mod尚缺候选组合求解/回溯、下载后真实声明复验、完整双重检查、玩家确认计划IPC/UI、修订/全部哈希/会话复核、一次安装差异与恢复；以及未来分发契约测试适配器和最终0.3.0EXE。不要把只读候选收集/手工测试夹具当作产品安装事务。此前Forge/NeoFerriteCore各两次正常退出证据保留，完整目标未交付。

额度本轮最近已用80%只是历史，继续前必须get_usage_limits；剩10%及以下保存提交/交接暂停，必须实际重置且剩至少20%才恢复。此次停止原因是用户停止Computer Use，不是声称额度已耗尽。所有提交本地、--only明确路径，原资料不混入，不push。

---
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

## 最新检查点：Fabric / Quilt 本地安装事务（2026-10-27）

从9b8f010继续，`tests/installer.test.ts`夹具参数化为Fabric/Quilt独立官方形状，代表目标Fabric0.16.14、Quilt0.29.2，均MC1.20.1/Java17。两者分别通过正式InstallerService、SQLite worker、对象仓库、隔离实例物化和prepareLaunch；检查主类、Java major、JVM参数及私有gameDir。关闭服务/存储并重开后，夹具强制所有元数据和传输入口失败，prepareLaunch仍只用持久证明/缓存对象通过且计数不变。下载开始后取消进入cancelled，prepareLaunch拒绝，新的requestId可用同显示名安装ready。

完整`pnpm check`444项/442 PASS/0 FAIL/2原有SKIP，typecheck/lint/coverage/build通过，证据`docs/validation/LOADERS-LOCAL-INSTALL-20261027/`。首轮受限权限检查出现基础SQLite/链接失败并已停止，不计代码失败；正常本地权限完整检查通过。所有新增字节为非可执行测试夹具，外网0、未启动游戏、未操作用户游戏数据；真实F/Q主菜单/Mod/退出矩阵仍未验证。下一步优先Forge/NeoForge本地处理器安装的取消、失败恢复和重开一致性，再汇总四加载器本地契约；不联网。原两份暂存资料继续排除，不push。

---

## 最新检查点：Forge / NeoForge取消与恢复（2026-10-27）

在9917198后补全正式InstallerPreparationService/InstallerProcessorExecutor的本地故障边界。Forge与NeoForge官方安装器URL形状分别使用非可执行归档：提取已开始时取消会join自有工作，保留已校验installer.jar私有暂存恢复材料，随后可重新从对象仓库复验/提取。Forge Java17和NeoForge Java21处理器对不响应SIGTERM的子进程升级SIGKILL，但直到FakeChild真实close才返回CANCELLED。无网络、无真实Java、无游戏窗口。

完整pnpm check448项/446 PASS/0 FAIL/2原有SKIP，typecheck/lint/coverage/build通过；证据docs/validation/INSTALLER-RECOVERY-20261027/。四加载器本地安装/取消/重开关键路径已有独立覆盖；真实F/Q游戏矩阵及既有Neo间歇退出仍保持缺项，不伪报。下一步回到已批准Mod玩家确认计划与一次安装事务，继续不联网；原两份暂存排除、不push。

---

## 最新检查点：Mod安装预览证据绑定（2026-10-27）

在742e91b后新增src/services/mods/planner.ts。ModInstallPlanner先用ModLibraryReader复验已下载根JAR，再双重检查目标实例并读取同一受控上下文，将当前修订/fingerprint、loader/MC、已装平台身份、unknown embedded/source、玩家selections交给有界resolver。结果逐节点绑定精确文件SHA1/SHA512/大小和requiredBy，处置reuse/library/download；输出不含路径/URL。根平台事实必须与LibraryReader完全一致，根文件必须与实际JAR三摘要/大小一致。仅graph resolved映射ready；unknown/conflict不授权，本地除可补的MOD_DEPENDENCY_MISSING外的硬错误直接MODS_UNSAFE。planId是公开body SHA256，仅供后续持久确认关联，不能绕过提交前重扫。

新增4测试，完整pnpm check452项/450 PASS/0 FAIL/2原有SKIP，typecheck/lint/coverage/build通过，证据docs/validation/MOD-PLAN-20261027/。尚未加入公共mods.v1、计划持久化、confirm/cancel、依赖实际下载、下载后逐JAR复验或一次实例事务，不标Mod安装完成。下一步正是这些；继续不联网，原暂存排除、不push。

---

## 最新检查点：0.3.0便携目录与版本设置交付（2026-10-28）

`main`与`mod_loaders`现均指向`e93adf5`。0.3.0外层EXE向应用传递自身目录；全新配置会实际建立同级`release/OUCL.games`，已有自选游戏根不被覆盖。选中实例后的版本设置可通过严格`instance-folders.v1`打开游戏目录、Mods、存档、资源包、光影、截图和日志目录；renderer只传实例UUID与固定键，主进程从持久实例记录重建真实隔离/共享gameDir并拒绝链接逃逸。

最终`pnpm check`458项/456 PASS/0 FAIL/2既有系统能力SKIP，typecheck/lint/coverage/build通过；`pnpm test:bootstrap`19项通过；`pnpm smoke:exe final`真实启动319,488字节EXE并复用同级runtime，33方法/15能力、renderer无Node、owner释放通过；`pnpm smoke`本地Electron安全与界面通过。交付`release/OUCL-0.3.0.exe`，SHA256 `c1ebf29f195c2553386508faaef73dade3a6419928b96d012fc2086789b251cb`，证据`docs/validation/BOOTSTRAP-0.3.0/`。按用户要求未联网、未启动真实MC、未动用户游戏数据。

完整Mod玩家确认/取消、递归依赖实际下载、下载后逐JAR复验和一次安装事务仍未完成；下次继续该已批准范围，不因0.3.0包装完成而误报完整四加载器与Mod总计划结束。原`OUCL-Codex-Package.zip`和`OUCL.txt`从保护stash恢复为工作区原始文件且继续不提交；保护stash不要删除。不push。

---

## 最新检查点：Mod安装计划公开预览（2026-10-28）

`mods.v1`新增`mods:plan`/`planMod`并在main/preload实际装配。请求仅允许实例UUID/修订、已下载资源库projectId/versionId/SHA1和最多256个显式选择；公开`ModInstallPlan`严格限制项目/版本/安全文件名/SHA1/SHA512/大小、处置、requiredBy、总下载量和最多512项冲突/未知证据，不含路径/URL/命令。主进程复用同一Modrinth客户端、本地JAR复验、双重检查、实例上下文和有界resolver。35秒preload超时不代表成功或取消，计划不授权写入。

完整`pnpm check`459项/457 PASS/0 FAIL/2既有系统能力SKIP，typecheck/lint/coverage/build通过；`pnpm smoke`确认34方法/15能力、renderer无Node以及计划桥接严格错误映射。证据`docs/validation/MOD-PLAN-IPC-20261028/`。未联网、未启动游戏、未动用户游戏数据。仍缺持久计划、玩家确认/拒绝、依赖实际下载、下载后逐JAR复验、会话/修订再检查和一次实例事务；下一增量继续这些，不重打已交付0.3.0二进制，不push。

---

## 最新检查点：资源库安装计划界面（2026-10-28）

下载页资源库现在只对已下载完成的Mod、当前ready非原版实例和可用`mods.v1`显示“生成安装计划”。调用绑定实例当前修订及资源库project/version/SHA1；切换实例/修订清除旧预览，超时保留同requestId重试。界面显示ready/conflict/unknown、计划文件数和待下载总量，并明确这是不会写实例的预览；vanilla、非Mod和未完成下载不显示入口。

完整`pnpm check`459项/457 PASS/0 FAIL/2既有系统能力SKIP，typecheck/lint/coverage/build通过；证据`docs/validation/MOD-PLAN-UI-20261028/`。未联网、未启动游戏、未动用户游戏数据。下一步仍为计划持久化、玩家确认/拒绝、依赖实际下载、逐JAR复验和一次事务；不push。

---

## 最新检查点：目录服务修复与同级资料（2026-10-28）

已按用户最新心跳优先修复目录服务不可用。检查发现旧全局metadata存在owner.lock；不清理或抢占该标记。新便携EXE默认使用同级`OUCL.runtime/profile`，自动登记同级`OUCL.games`；显式`--user-data-dir`测试参数仍保留。默认根创建失败不再终止其余服务，便携`roots:choose`重试固定默认位置。旧global资料/游戏/已有选择保留，不自动迁移；新便携profile初次为空是预期隔离行为。

完整`pnpm check`及随后脚本lint通过，26项引导检查通过。受限环境初次完整检查因SQLite提交/链接权限失败，切换正常权限后完整检查成功。真实修复EXE在独立中文空格目录（本地预置Electron，无公网测试）验证自动创建、正常退出重开同rootId/revision、阻塞文件原样保留及移除测试阻塞后自动重试；128项许可证审计无待审例外，打包补齐smol-toml许可。证据`docs/validation/PORTABLE-ROOTS-20261028/`和`BOOTSTRAP-0.3.0-directory-fix/`。新交付`release/OUCL-0.3.0-directory-fix.exe`，328704字节，SHA256 `dcbe8f777685efdd456ddc914a9f4a04856639f18801e92c8511afd063167bee`；旧EXE保留。Strata单次建议已审查，未直接使用其含语法错误的代码，返回service_stopped=true。下一步继续Mod确认及实际安装事务；不push、原始暂存保护不变。

---

## 最新检查点：持久Mod计划与取消（2026-10-28）

`ModPlanService`已在main装配：`mods:plan`返回前保存固定`mod-plan-<requestUUID>`，新记录revision1/preview，取消revision2/cancelled。body/input不可改，重试同ID返回原快照，同ID换参数拒绝，已取消不能重新激活；成功提交但ack超时只从精确JSON证据恢复。新`mods:planState`/`getModPlan`及`mods:cancelPlan`/`cancelModPlan`均严格白名单，当前共36方法/15能力。关闭等待读/写与创建取消结束。schema、未知版本保护与边界见`docs/contracts/MOD_PLANS.md`。

资源库只在浏览器保存不含路径的请求UUID指针，重载恢复同实例同修订预览；旧修订清指针并提示，旧异步结果不串实例。展示来源、精确大小、处置和被谁依赖，可实际持久取消。完整`pnpm check`471项/469 PASS/0 FAIL/2既有SKIP，coverage行98.83%/分支96.84%/函数99.56%；随后新增UI夹具/精确大小显示的typecheck/lint/build也通过。`pnpm smoke:mod-plans`使用真实组件/preload/worker及明确planner夹具，验证重载不重解析、DOM取消revision2、旧修订提示、小窗口无溢出；正式入口`OUCL_SMOKE_OFFLINE=1 pnpm smoke`使用本地manifest，36方法/15能力无Node和新增接口根检查通过，不联网。证据`docs/validation/MOD-PLAN-DURABLE-20261028/`。旧EXE和原始两份暂存资料/stash保留，不push。

下一步从本HEAD继续：确认一个仍为preview的ready计划，绑定planRequestId/planId；固定项目版本/文件下载并逐JAR双重复验，然后会话/实例修订/全部哈希复核，一次提交/恢复。未实现这些，不显示可用安装按钮，不把本次保存或取消计划当完整Mod安装交付；用户要求继续跳过公网测试。目录修复已在e6d9214交付，不重复改旧资料/生成同名覆盖EXE。

---

## 最新检查点：确认下载准备服务（2026-10-28）

新增私有`src/services/mods/preparation.ts`的ModInstallPreparation，接受精确planRequestId/planId/confirmed=true及受控consumer UUID；读取持久preview/ready计划、重验计划与当前库存/环境/会话。根用ModLibraryReader复验，依赖按固定versionId查询并精确核对项目/文件/三摘要中的上游SHA1/SHA512/大小，transferResource进入既有对象仓库，再由真实JAR worker验证SHA1/SHA256/SHA512/大小/声明。`facts.ts`统一已装和待装声明投影，预期结果双重检查后再复查文件/环境/根/计划取消/会话。已装精确依赖可保留改名，禁用文件不复用，嵌套来源未明保留unknown，任何不兼容/未知不返回ready。

完整`pnpm check`480项/478 PASS/0 FAIL/2既有SKIP，类型/lint/覆盖率/build通过。9项新增测试（含多分支）用真实SQLite/对象传输/校验/JAR worker与生成的JAR、本地metadata/HTTP适配器验证：准备成功但不写实例/资源库、固定依赖与可选不下载、实际版本非平台标签、复用/禁用、范围/重复modId/未知/客户端限制、文件名冲突、上游/下载后SHA512矛盾、取消等待清理、准备期间取消/文件变化/未知会话。正式入口`OUCL_SMOKE_OFFLINE=1 pnpm smoke`36方法/15能力无Node通过，无公网或真实游戏启动。证据`docs/validation/MOD-PREPARATION-20261028/`；说明`docs/contracts/MOD_PREPARATION.md`。

重要边界：本服务尚未在main公开确认路径装配，不是可点击安装功能。下一步接**持久确认任务与计划占用/取消互锁、实测Java版本事实、gameDir独占及一次提交/恢复**；事务必须再次实哈希/实例修订/会话复验，回滚不覆盖外部修改。生产context的java当前为null，不能按MC或加载器版本猜Java精确版本。准备结果不代表安装成功；完整目标保持进行中。旧0.3.0修复EXE与两份原始资料/stash继续保留，不push。末次额度查询5小时41%已用、周81%已用，继续按用户阈值核对并保存交接。

---

## 最新检查点：Mod文件事务与恢复（2026-10-28）

新增私有ModTransactionService及固定worker `mod-txn:get/set`。日志formatVersion1、最大512KiB/256文件，保存计划/实例关联、原修订/指纹、前后JSON摘要、token与文件三摘要/sourceKey/dev/ino。先日志后gameDir独占标记，再从共享对象复制到`.oucl-mod-staging/<taskUUID>`复验；只从私有副本独占hard link到mods，不能写通共享缓存。全部实际文件/本地平台规则/环境/会话/计划复查后，实例formatVersion2 ready加载器记录CAS写summary.revision+1及可选modCommitId=taskUUID作为提交点，再同步index/committed。未知字段/阶段停写，旧记录可读。

回退只移动身份和真实三摘要仍匹配的本次新增文件至保留材料，不清目录、不删外来文件；外部替换保留，外部修改已发布文件则needsRecovery且保留gameDir标记。recover只认自己的日志token和唯一JSON提交证明，支持提交前中断回退、提交后索引修复、终态本人标记释放；不按PID/年龄抢占。详见`docs/contracts/MOD_TRANSACTION.md`。

最终`pnpm check`491项/489 PASS/0 FAIL/2既有SKIP，core覆盖率行98.83%/分支96.90%/函数99.56%，类型/lint/build通过。11项新增事务测试用生成JAR、惰性MC metadata夹具及真实文件/worker/JSON证明，覆盖实际新增、缓存写隔离、逐文件失败/回退、外部编辑/替换/改名、外来锁/同名文件、取消边界、丢失ack、索引失败、真实存储重开恢复及未来格式逐字节保留。`node scripts/mod-transaction-runtime.mjs`在Electron45 as Node+正式dist worker下11/11 PASS；此运行器收集明确TAP统计，PS直接启动GUI EXE的空输出不作为通过证据。材料`docs/validation/MOD-TRANSACTION-20261028/`。未联网、未启动MC、未动用户游戏数据，不push。

**下一步**：持久确认任务/index、plan取消互锁、实测Java、任务进度/重连及公共确认UI。两个私有服务还未在main确认路径装配，禁止直接开放PreparedModInstall或声称产品安装已交付。确认任务必须在开始后阻止独立cancelPlan承诺撤销，提交点后取消应CANCEL_TOO_LATE；已准备快照仍需事务自己的复验。断电/真实kill全矩阵未验收，不补写通过。旧EXE/原始zip/txt/stash保留；继续从最新HEAD，不回退2bef0ac。

---


## 最新检查点：Mod确认接纳互锁（2026-10-28）

新增固定私有mod-confirm:accept/list、StorageClient.acceptModConfirmation/readModConfirmations；TaskKind增加mod-install但公共TaskSnapshot尚未扩展。主进程通用accept不能创建该kind。worker内确认/取消按消息顺序串行，计划UUID=tasks/requests请求UUID、digest=modConfirmationDigest(计划UUID,planId)，首次检查根/preview ready/实例修订MC loader，重试直接返回原task（不重放）。确认后ModPlanService.cancel明确CANCEL_TOO_LATE。SQL固定有界恢复清单最多1000项，worker核对每项计划，避免另写JSON索引造成断电孤儿；既有任务重开把running置needsRecovery，清单不能自动重跑。无新依赖/表/公共通道或按钮。

pnpm check 495项/493PASS/0FAIL/2既有SKIP；Electron45正式dist worker完整15项mod-plans测试PASS。运行器scripts/mod-confirmation-runtime.mjs；首次计数误配16实际15，修正后明确通过，原TAP保留报告。材料docs/validation/MOD-CONFIRMATION-20261028/及docs/contracts/MOD_CONFIRMATION.md。未联网/未启动MC/不碰用户数据。

下一步：实测Java事实（生产context.java仍null）、公共确认服务编排preparation/transaction、任务订阅/取消/重连/退出等待，最后UI确认按钮与0.3重打包。现有SQLite清单可直接供执行器initialize，先核对mod-txn日志与modCommitId，不自动重放未知下载/提交。产品尚未创建任何mod-install任务。保留旧EXE及zip/txt/stash，不push。

## 最新检查点：生产Mod Java事实（2026-10-28）

从a3b5d11继续，InstalledJavaFacts已接main的modInventoryContext第三参数。按实例prepared.version.javaMajor选择已登记兼容候选，selected优先，使用新JavaProbe真实完整version；失败/实际major变更跳过、全部失败null，不复用saved.version，不系统发现/下载/登记。每次探测2秒，现有输出限制/取消等待close；单活动，无缓存，前后资料变化FILES_CHANGED。候选排序与JavaRuntimeService一致；将来确认准备/提交复验不能省略，启动仍原服务复核。

pnpm check 499项/497PASS/0FAIL/2既有SKIP，4项新测试为受控probe适配器；正式入口本地fixture smoke 36方法/15能力通过。证据docs/validation/MOD-JAVA-FACTS-20261028/，契约docs/contracts/MOD_JAVA_FACTS.md。未联网/未启动MC/未动用户资料。

下一步只剩接线但仍需完整验证：持久确认执行器调用acceptModConfirmation，以返回taskId作为preparation consumer/transaction taskId；初始化readModConfirmations结合mod-txn日志和实例modCommitId判定恢复，未知不得重放。任务快照增加mod-install及相应标签；公共confirm/state响应与ResourceBrowser按钮，取消改走任务控制且提交后CANCEL_TOO_LATE；关闭等待执行器。当前产品未装配私有preparation/transaction/confirm，不声称Mod安装交付。旧EXE及原zip/txt/stash保留，不push。末次额度5小时78%已用、周86%已用，未到开发暂停阈值；下一心跳先核对额度。

## 最新检查点：确认任务内部执行器（2026-10-28）

从77584fe继续。新增src/services/mods/install-tasks.ts的私有ModInstallTaskService(storage,preparation,transaction)，confirm先固定worker接纳，返回taskId后run实际准备并提交。任务UUID作consumer/transaction身份；同计划重试不重复执行、不同活动计划SCAN_BUSY。进度写入串行并在提交前join；取消等待准备退出；verifying后同步committing标记与持久committing边界，cancel返回CANCEL_TOO_LATE；close阻止接纳、abort准备、等待提交，lost写入结果报告needsRecovery。get返回内部StoredTask，还未公共投影。

initialize以readModConfirmations枚举，交叉核对mod-txn绑定；有事务用recover原token和JSON证明恢复，committed完成/rolledBack失败；无事务的孤立确认一律needsRecovery，不重放下载。已结束任务和事务矛盾停恢复。阶段/错误细节尚未持久报告，不能直接公开内部assessment、路径、URL或原始异常。

最终pnpm check 506项/504PASS/0FAIL/2既有SKIP，核心覆盖率98.83/96.90/99.56，类型lintbuild通过。scripts/mod-transaction-runtime.mjs扩为准备+事务两组，固定计数27，报告改写新MOD-EXECUTOR-20261028目录，不覆盖历史11项；Electron45+正式worker27/27 PASS。新增本地真实准备→依赖传输→JAR核验→一次事务闭环，另6执行器测试覆盖复用确认/取消等待/回退/孤立不重放/提交后任务状态缺失恢复/提交拒绝取消及close。fixture纯生成JAR和惰性MC metadata，无公网、用户游戏或真实Java/MC。

下一步：**先补固定版本安装结果/失败报告**（ModCode及受控本地/平台证据、任务/实例/plan绑定，lost ack精确证明），再扩公共mod-install任务快照/标签，mods:confirm与结果查询/重连，main装配此执行器并关闭时等待，ResourceBrowser确认/任务取消。当前main仍未装配preparation/transaction/执行器，没有产品安装按钮、新EXE或完整目标交付。先读最新计划，继续从本HEAD，勿回退；保留旧EXE、原zip/txt/stash，不push。

## 最新检查点：WIP结果报告，额度暂停（2026-10-28）

主分支保持已验证1edbc41；mod_loaders保存未通过增量。新增src/services/storage/mod-results.ts：formatVersion1固定mod-result-taskUUID，绑定根/任务/plan/实例修订、受控ModCode、可选ModReport，终态不可变/needsRecovery可解析。worker mod-result:get/set和StorageClient读写接入，写入复核确认任务/计划/assessment指纹。install-tasks.finish先保存结果后写任务状态，TIMEOUT仅认完全相同JSON；initialize支持无事务的持久failed/cancelled恢复。

**未通过，切勿合并main/打包**：新增failed preparation persists bounded assessment测试仍抛NEEDS_RECOVERY；初次fileId非法已修正，但仍有问题。测试finally service.close抛错掩盖原始断言并跳过f.close，造成worker悬挂，最新全套与runtime已中止。优先修复清理保证，再定位publicModReport(inventory.items=[]但issues有fileId)是否违反引用校验；或验证worker writeModResult拒绝原因。不要按报告猜测根因已证实。新增lost result ack测试实际运行PASS，但整体不能说通过。原先完整506/504PASS/2SKIP仅适用于1edbc41。scripts/mod-transaction-runtime.mjs现期待29项，证据目录MOD-RESULTS-20261028，保留失败TAP和FAIL JSON，不覆盖旧27PASS材料。

已停止本轮运行会话（全套4106、runtime44814已Ctrl-C退出；旧69264/57564亦已停止），没有游戏进程操作。原始zip/txt/stash及旧EXE保留，不push。

**额度等待已开始**：get_usage_limits五小时91%使用，resetsAt=1793148801；周89%使用，resetsAt=1793601420。下一心跳先核对实际窗口重置及所有可用窗口剩余>=20%，未满足安静等待、不开发。满足后先修复此WIP再续公共确认/结果查询/任务快照/main装配/UI；不得回退丢弃当前代码，也不得把WIP当完整目标交付。

## 最新检查点：Mod公共确认/结果/任务接入（2026-10-28）

额度已实际重置（5小时1%、周0%）后从最新78bb260继续；发现另一批准UI增量已dfff42b修复旧失败（空库存问题fileId和状态不一致），本轮保留所有desktop/论坛改动，不重复修复。当前主线main历史仍待合并，工作分支mod_loaders。

增加mods:confirm(显式confirmed:true+planRequestId/planId)->taskId、mods:installState(planRequestId)->ModInstallationState(task/errorCode/assessment)。Storage/结果格式不变。私有install-tasks新增state/list/taskView严格复核根/plan/task/result关联；公开mod-install快照进入现有列表/get/订阅/取消；main装配真实preparation/transaction/任务服务，关闭先等待安装执行器。cancel通过公共InstanceContractError映射，提交后CANCEL_TOO_LATE。lost状态用递增投影revision；InstallTask接收新initial快照以显示未知恢复状态。

资源库ModInstallConfirmation明示确认、查询进度/失败证据，结果轮询和原UUID恢复，确认后隐藏cancelPlan，走原任务取消。原实例revision更新后仍能展示已接纳历史结果，但不能重放旧计划；新的计划需再次生成。items增加projectId/versionId展示。无新依赖/远程服务/用户数据迁移。

最终pnpm check513/511PASS/0FAIL/2既有SKIP，正式Electron worker29测试PASS；主入口本地fixture44方法/16能力PASS；真实UI夹具验证取消、确认未知失败不提交、重载同任务、stale及窄窗PASS，订阅fixture明确使用getTask回退；真实准备/下载/JAR/事务成功在服务层测试，不冒充窗口成功。bootstrap26、licenses128无待审通过。报告docs/validation/MOD-PUBLIC-20261028/与MOD_PUBLIC_INSTALL.md，旧失败TAP保留。

下一步：生成保留旧文件的0.3.0-mod-install EXE，本地预置Electron的portable三场景实测，再合并main与交付链接。尚缺真实四加载器运行矩阵（用户要求跳过联网/游戏）、完整断电矩阵及DistributionSource/签名分发契约适配器（搜索src未找到，不能标完成）。完整目标未结束，自动化保持。不要回退旧16d1ca7；不push，原zip/txt/stash与旧release保留。

公共Mod功能已提交0084b08，生成release/OUCL-0.3.0-mod-install.exe（363008B，SHA256 ed97b39bcc3781537848cc7c4feaacbae59ee32ef63baabb6d8b3dba41b03ea5），真实EXE本地预置Electron三场景通过；docs/validation/BOOTSTRAP-0.3.0-mod-install/保留包与portable证据。旧EXE保持。下一补原批准DistributionSource/签名分发清单契约与测试适配器（只接口/本地夹具，不接后台），然后同步main/最终交接；不把四加载器实机缺项关闭。

## 最新检查点：Mod可确认安装与0.3 EXE交付（2026-10-28）

代码0084b08、包证据1f523be后已补原计划DistributionSource/版本化Ed25519签名信封/四操作及纯差异预览，只在tests有临时密钥的内存验证适配器，无产品导入/后台或远程更新。受管UUID+旧摘要同时匹配才replace/remove，未知/遗漏文件保留；任何冲突不提供变化。实际更新仍需配置可信来源、公钥/轮换策略、验证目标和文件/会话/修订并复用事务，不能直接执行纯diff。契约docs/contracts/DISTRIBUTION_SOURCE.md。

最终pnpm check516/514PASS/0FAIL/2既有SKIP，type/lint/build通过。Mod产品公共确认与窗口/29项正式worker证据见MOD-PUBLIC-20261028；新包release/OUCL-0.3.0-mod-install.exe（363008字节，SHA256 ed97b39bcc3781537848cc7c4feaacbae59ee32ef63baabb6d8b3dba41b03ea5），固定Electron本地预置下三场景真实EXE通过：同级自动目录/重开稳定/失败重试，见BOOTSTRAP-0.3.0-mod-install。已有桌面/论坛UI全部保留。旧16d1ca7 WIP已被dfff42b和后续完整检查解决，不再按旧失败暂停。

交付边界：已接入实际确认安装到实例/任务/受控结果，未联网，未启动真实MC或接管用户游戏窗口。四加载器各自主菜单/测试Mod/正常退出/再次启动及原版回归的完整实机矩阵仍未完成，不能凭服务夹具关闭；完整断电/kill矩阵亦保留。未来后台/签名源不启用。自动化尚未停止，因为完整目标验收缺项仍在。下一轮先读最新HEAD和额度，不重复实现已交付功能；无联网/游戏授权变更时仅推进未完成的本地恢复验证和明确契约缺项。原zip/txt/stash/旧EXE不动，不push。

同步完成：main与mod_loaders已对齐28a29b4（其后仅此交接文字），正式Mod功能包与便携证据已交付。最终工作区只留原OUCL-Codex-Package.zip、OUCL.txt未跟踪，stash原样保留。下一心跳先核对额度，再审剩余验收缺项；不要重复写已完成确认功能、分发契约或覆盖旧EXE，不push。


2026-10-28最终整合交付：0.3全部既有增量保持，正式EXE release/OUCL-0.3.0-final.exe 363008字节，SHA256 3a63f5d7aaff7a7b7d5f3560b9925d75158310bcba76943f1d683a703686ec80。517项515PASS/0FAIL/2原有SKIP、正式Electron worker30PASS、界面重开、最终包官方冷/热及便携三场景通过。Forge/NeoForge各两次主菜单、FerriteCore和退出0；Fabric基本菜单/重开/退出0但测试Mod下载失败；Quilt安装/重试和原版新装受网络失败阻塞。公共Mod窗口公网安装成功及全断电矩阵未验收。新增三点真实进程中断安全阻断测试，不等同自动恢复。统一报告根docs/validation/FINAL-0.3.0-20261028/REPORT.md；完整实机验收仍开放，不push。


2026-10-28网络失败修复交付：在用户明确允许参考/照用X-CL/XMCL、KAMUCL范围内，独立实现有界退避、持久前缀续传/同镜像保持、永久HTTP错误分类、Maven校验摘要与HEAD独立预算。完整Quilt复验进一步触发Electron内置Undici Parser.finish assert(!this.paused)致命断言，因此桌面main显式注入Electron net.request一跳流，保持HTTPS/证书/无会话Cookie/跳转白名单，未加依赖或公开契约/存储字段。528项526PASS/0FAIL/2原有SKIP，正式main/窗口两轮及加载器选择、最终EXE便携和官方冷/热通过。Fabric/Quilt官方依赖证明、FerriteCore下载通过；Quilt742454177字节计划、3652项物化、ready提交及禁网重开启动准备实际通过（复制并重新验证历史对象缓存，不冒充全部冷下载）。旧崩溃锁/数据原样保留，未补记游戏菜单矩阵。交付release/OUCL-0.3.0-network-fix.exe，364544字节，SHA256 04d8ddd7062c03e71e320e60b35f4b60105727568d441bb26930156ebf800e7b；仅重试候选另保留，统一证据docs/validation/NETWORK-FIX-20261028/REPORT.md。不push。
