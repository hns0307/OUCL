# OUCL 下一对话交接

更新：2026-10-25，Asia/Shanghai。代码基线：`162317e`。本文件是工作快照，不替代AGENTS或批准记录；每次开发**先读OUCL-Codex/docs/TASK_PLAN.md**，再读AGENTS.md、DECISIONS.md及关联契约。不要仅凭本文件判断新授权或测试成功。

## 用户目标与有效授权

- 最新目标原文：“一直继续直到有一个简易的MC启动器，以exe的形式，至少包含下载与启动的功能，下载界面可以参考MC_start文件夹里的其他启动器”。**尚未完成，不能标goal complete。** 最终须从实际Windows exe默认入口完成下载、安装、真实游戏启动、退出及重启验证；CLI、空窗口或旧工程预览不能代替交付。
- 用户直接批准过“阶段1A下载与启动闭环，持续实现并提交”。暂停后又明确恢复目标，允许多个子agent并行，要求每个可验证增量Git提交，并维护本交接文件。
- 当前G2、阶段1A；同范围无需反复索要启动确认。不要扩大到加载器、正版登录、联机、整合包或后台；偏离已批架构/IPC/存储/安全及新增依赖仍按AGENTS再审批。
- 先说明本次增量文件、风险和验证；实施、实际检查、同步文档、Conventional Commit。并行时划分独占文件，主agent统一复核/串行提交，避免共享index冲突。

## 已交付的真实状态

- `9614e76`：官方版本目录、描述SHA1信任链、持久缓存、versions:catalog与正式浏览界面；历史带空格的版本身份已支持，所有目录条目仍candidate，不是兼容承诺。
- `147aeb8`：roots:list/choose、系统目录选择适配、固定数据位置登记与正式UI；尚未自动操作真实native picker。
- 更早已有纯版本/路径/任务策略、JSON+SQLite恢复基础、ObjectStore、StorageClient和有界HashPool，详见TASK_PLAN及各验证报告。
- `60e91f8`：单物理HTTP下载、独立权威续传SQLite、worker桥接及ObjectStore提交。
- **`5620b0c`：安装元数据准备、纯安装计划、活跃共享下载消费者、独立来源adopt及复用哈希线程。** core记录库/索引实际声明版本，计划覆盖client/libraries/assets与旧版资源投影；现代native仅选择Windows x64解压输入。共享consumer/job目前只在内存，未持久化安装关联，不是完整安装器。
- 普通窗口当前只提供固定目录登记与官方版本浏览，**还没有可用的安装/启动按钮链路**。旧release便携目录还是历史工程骨架，未随本轮重打包。

## 本轮验证与复现

- `pnpm check`：185项，183 PASS / 0 FAIL / 2 SKIP，typecheck/lint/build通过。core行100%、分支98.98%、函数100%，不是整个服务/UI的覆盖率。
- 两个skip：文件软链接权限不足；Windows拒绝重命名打开的SQLite。确定性stat适配器覆盖了缺失/换身份/link/directory，但不冒充OS实际替换测试通过。未改系统权限。
- `pnpm test:workers-runtime`：实际Electron45/Node24.22正式worker通过fixture传输取消、正常关闭重开、206续传、对象提交/复用，共享consumer取消隔离及独立来源adopt。整次测试创建2个hash线程，包含主动取消后的替换；另有40个文件只创建1个线程的单测。
- `node scripts/verify-install-plan.mjs`（先pnpm test生成.test-build）：真实官方1.21.1、1.20.1、1.12.2、1.6.4描述/资产索引信任链与计划通过，去重制品数3960/3641/1323/613。1.20.1计划总量735,814,641字节，仅为计划；四个样本gameDownloaded/gameLaunched均false。
- `pnpm test`生成.test-build后，`node scripts/verify-download.mjs`：真实1.21.1 client.jar为26,836,906字节；取消保存15,812字节，正常worker重开后服务器实际206续传，官方SHA1匹配，随后复用无网络请求。报告明确gameDownloaded=true、gameLaunched=false，临时文件已清理。
- 最新批量执行证据：`docs/validation/A1-05-install-downloads/REPORT.md`及其check.log/electron-runtime.json/snapshot.json；安装计划证据仍在`docs/validation/A1-05-install-plan/REPORT.md`、check.log、official-plans.json、electron-runtime.json及snapshot.json。真实单JAR下载证据仍在`docs/validation/A1-05-transfer/`，不把其中gameDownloaded=true理解为完整游戏安装。首次完整检查的自动权限审查曾超时，后续重试成功；不要把未执行命令当失败测试。

## 当前接口与重要约束

| 位置 | 已有职责 |
| --- | --- |
| src/services/download/types.ts | DownloadSpec、严格TransferRecord、官方artifact URL策略、脱敏错误 |
| src/services/download/http.ts | HttpTransfer.run(file,record,checkpoint,options)，只处理一个物理传输，约每1MiB及收尾先fsync再登记前缀 |
| src/services/download/artifact-transfer.ts | ArtifactTransfer.run(spec,options)，受管staging→HTTP→摘要/对象提交→committed；同key并发返回TRANSFER_BUSY |
| src/services/storage/transfer-db.ts | 独立权威transfers.sqlite、transfers.json enabled marker、CAS及每次访问的backing身份校验，worker-only |
| src/services/workers/storage-client.ts | getTransfer/saveTransfer；私有transfer:get/set，没有renderer路径或任意SQL接口 |
| src/services/objects/store.ts | createStaging/resumeStaging、只读SHA256本体、独立来源记录、索引重建，保留损坏/未知证据不覆盖或GC |
| src/services/objects/store.ts 的 adopt | 重新校验已有本体后保存另一份独立可信来源证明，不能仅凭相同hash继承信任 |
| src/services/catalog/install-metadata.ts | prepare返回已验证版本、资产、计划和精确原始assetIndexBody；仅接受Windows x64 |
| src/core/install/ | 无IO资产解析、去重制品、多来源proof、views/classpath/native输入计划 |
| src/services/download/coordinator.ts | 有界活跃共享下载、每consumer暂停/恢复/取消及独立proof；无持久任务关联 |
| src/services/workers/hash-pool.ts / hash-session.ts | 哈希线程复用、UUID job隔离，取消/关闭先join，完成先关闭文件句柄 |
| docs/contracts/DOWNLOAD_TRANSFER.md | 精确记录格式、范围/超时/Range/取消、恢复边界 |
| docs/contracts/INSTALL_FOUNDATION.md | 安装准备、共享consumer及hash-session当前边界 |

- transfers.sqlite不是缓存，不能像objects-index.sqlite一样丢弃。marker在而库不在要停写；不能建空库继续。
- 只允许官方HTTPS artifact host，redirect/凭证/query/fragment禁用；localhost仅在测试fetch适配器映射。
- assetIndex URL使用piston-meta元数据域，该域故意未列入artifact传输白名单。现有批量执行器将prepare返回的精确assetIndexBody写受管staging并交ObjectStore校验提交，不能重编码JSON或随意放宽网络策略。
- 一个去重制品可有多个proof，批量执行器必须逐个保留独立来源。索引/库绑定实际声明父版本，不用叶子版本哈希替代；x86/ARM64 native JAR仍可在上游classpath，不能解压进x64私有natives。
- 强ETag需有引号；真实Mojang响应本次使用了Last-Modified作为If-Range。二者都不能替代官方哈希。
- 警惕清零顺序：保存0成功后必须立即清内存position，再truncate/fsync，故障时不能重新登记旧前缀。
- 缓存查找后要复核取消；committed摘要与已验证对象矛盾时必须needsRecovery。最终确认丢失已覆盖写前/写后两种情况，不重写终态。
- 进程崩溃遗留owner不能自动抢占；对象本体已移动而证明/索引未完可能保守停写。当前证明的是正常关闭重开，不是完整kill/断电恢复。

## 下一步优先顺序

1. `e834de6`已交付`services/install`批量下载执行器：精确原索引入库、默认4条lane、多proof追加、取消/失败等待本批收尾及缓存复用。新增8项实际ObjectStore测试通过；Electron验证2份fixture制品/重复批次仅1次传输。尚未真实整批下载官方游戏、持久关联或物化。`c076c47`已继续实现安全解压基础，见下节；下一处理受管文件视图和持久安装任务，仍先查实际工作区。
2. 补consumer/安装任务持久关联及已批tasks:*订阅/退订：TaskAccepted、严格TaskSnapshot/错误、进度有界合并、超时幂等、终态查询与退出/重载恢复。先核对PROPOSAL§7，不发明通用execute或临时假成功IPC。
3. 受管文件物化：身份分离、隐藏父jar、固定store、私有可写数据、受控软链接及已批复制回退。已有安全解压仅写隔离空目录，后续需绑定实例租约/操作日志并发布私有natives，不能以此代替实例事务。
4. Java检测/选择、离线档案、参数数组、gameDir排他租约、真实进程与实际安装/启动UI闭环，然后打包新exe。实际从该exe下载、到菜单/临时世界、退出重启及共享/隔离验证后，才能判断目标完成。旧release仍非该成果。

只读环境核对：PATH现有受信任Oracle Java实测17.0.12、amd64/64位；已知供应商目录未发现8/21。没有安装/下载Java。不要把Temurin/Adoptium候选写成已批准发行商；读DECISIONS的D-03及实际制品核验要求。Java17可作为相应版本的后续候选，未实测游戏不能声明兼容。

## 工具、Git与待保留现场

- Node24.x、pnpm12.3.4、Electron45已安装，命令以package.json为准。受限环境可能拒绝rename/junction/loopback；必要时在已授权的正常本机权限复核，不能关Electron sandbox或改系统权限。
- 当前观察分支为main，勿凭早期记录改回master或重置。用户暂存了`OUCL-Codex-Package.zip`与`OUCL.txt`；两者被本轮明确排除且保持暂存。不要`git add .`、清index或替用户把原始资料混入增量。
- 本轮使用显式路径及`git commit --only -- <本次路径>`保留上述暂存；提交前检查对应路径的cached diff/check。Git写入可能需要正常本机权限。
- Git邮箱已有配置；作者名本轮继续用`git -c 'user.name=Li ZeRui' commit ...`，没有改全局身份。用户只要求commit，**没有授权push**。
- CI配置存在，本轮未推送远端，不能声称远端CI通过。不要覆盖历史validation或旧release来制造新包验证。

交付前更新TASK_PLAN、DECISIONS、验证报告及本文件。下一对话应接着推进真实安装/启动，而不是重新做G0或在下载单文件/空窗口处结束目标。

## c076c47 native安全解压补充

- `src/services/install/native-archive.ts`：已验证对象SHA256/大小、严格ZIP中央/本地header/CRC/完整deflate消费、路径/链接/全局大小写和文件目录冲突，先计划后独占写入。默认排除META-INF/，排除项仍校验正文和预算。
- `src/services/workers/native-extractor.ts`及native-protocol.ts：exact私有one-shot协议；同时仅1个worker、128MiB线程堆、120s超时；最多64归档、每档64MiB、总输入/展开各256MiB、4096项；取消/关闭先terminate/join，保留隔离workspace，不冒充回滚。总RSS并非线程堆上限。
- 新增12归档测试和4worker测试；完整168项166 PASS/2既有SKIP，typecheck/lint/build通过。正式Electron45/Node24.22 worker已实际解压fixture并验证退出后文件/目录可删除。
- `node scripts/verify-native-archives.mjs`真实官方验证：1.20.1的7归档→18文件/3,354,056字节；1.12.2的2归档→7文件/462,336字节；官方SHA1→共享对象→解压前SHA256均通过，gameLaunched=false，临时文件清理。不能声称已加载DLL或游戏兼容全通过。
- 最新权威证据：`docs/validation/A1-08-native-extraction/REPORT.md`及check.log、official-natives.json、electron-runtime.json、snapshot.json；契约`docs/contracts/NATIVE_EXTRACTION.md`。最新worker-runtime输出写新目录，不覆盖旧批量/传输证据。
- 完整exe目标仍未达到：界面仍仅目录登记/版本浏览，持久安装任务、共享视图/复制回退、实例事务、Java/离线档案、实际游戏进程/UI、新exe实测均待继续。当前已有NativeExtractor不是实例natives最终发布，禁止直接将非空玩家/旧natives目录传入。主进程只传自己的受管staging和官方可信对象。

## 162317e 文件投影/Java与下一轮整合重点

- 代码已提交：`src/services/install/file-views.ts` FileViewService.materialize(directory,relative,spec,object,{mode,existing?,signal?})，ObjectStore独立来源复核，优先软链接、权限不足明确copy、256KiB有界复制+fsync+哈希、receipt核对。未知入口冲突不覆盖，已登记copy若nlink不为1拒绝。入口完整创建后返回receipt，即使此刻取消也须由安装日志记录真实副作用，不能假称无写入。未实现目录junction或安装事务，不直接用于玩家目录替换。
- `src/services/java/probe.ts` JavaProbe.probe(executable,{signal?,timeoutMs?})、parseJavaProperties；只运行明确选择/此前可信的绝对常规java.exe，固定argv，无shell，剥离Java options/CLASSPATH注入，64KiB输出预算/默认8s，取消/超量/超时kill并等close。仅Windows x64的8/17/21。没有枚举、持久注册、受管下载或新发行商选择。
- 完整185测试183 PASS/2既有SKIP、类型/lint/build通过；7项文件投影+10项Java测试。Electron实测fileViewMode=copy、fileViewVerified=true，不把权限回退说成文件软链接成功。真实Oracle17.0.12属性通过，脚本`node scripts/verify-java.mjs <可信java.exe路径>`，报告不保存绝对路径；未启动MC。
- 最新证据`docs/validation/A1-08-file-views/`（完整check.log、Electron、snapshot）和`docs/validation/A1-06-java-probe/`（报告、local-java.json、snapshot），契约`docs/contracts/FILE_VIEWS.md`。旧报告保留历史，不覆盖。
- 新目标已写入TASK_PLAN/DECISIONS：下载界面允许参考MC_start其他启动器。`docs/DOWNLOAD_UI_REFERENCE.md`已只读核对KAMUCL/PCL/PCL1/XMCL具体UI来源，建议版本筛选→安装确认→真实任务阶段/取消重试→已安装启动；没有运行它们或复制源码/素材/依赖。
- **下一轮优先整合实际安装流程，不再只新增离散基础函数**：落实原已批实例JSON提交点/操作日志与持久consumer关联，装配现有InstallMetadataService→InstallDownloadService→FileViewService→NativeExtractor，准备根视图/实例目录及受控ready记录；接已批instances:create/list和tasks:*严格契约及UI。安装后接Java选择、离线档案、LaunchPlan/参数数组、gameDir排他及真实进程；目标先用可信现有Java17与1.20.1实测，再新exe默认入口验证。没有任何完整游戏已安装或已启动的证据。
- 继续显式路径commit--only，保留用户暂存ZIP/OUCL.txt，无push授权；最终exe未完成，goal保持active。新供应商/依赖和偏离批准基线仍再审批。
