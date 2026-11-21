# v11三实例共存游戏资料准备

2026-11-13（Asia/Shanghai）。主协调已冻结v11源码并独占GUI。本任务只写`D:/MC_start/OUCL-acceptance-v11-20261113/acceptance-results/game-data/`和本文，不改597冻结文件、UI/IPC/schema/依赖，不提交、打包或启动GUI/Minecraft，不操作源根窗口/进程或清锁。开工五小时usedPercent=48、剩余52%；周额度不作门槛。已读当前TASK_PLAN/DECISIONS、v10来源限制及v5 D资料准备/续接方法。

**结果：三实例资料准备和候选正式服务预检完成，prepared.json已生成，可由主协调选择同一v11产品进入实际共存验收。准备不是菜单、Mod实际加载、游戏退出/重开、冷下载或旧锁恢复通过。**

## 来源、空间与可行性

唯一游戏数据来源为已批准历史构造副本`D:/MC_start/OUCL-PA-clone-20261112`。v10记录原A v21的旧原版/旧Fabric+FerriteCore/新Quilt共存菜单/退出证据及构造副本限制；本轮未把它改成v11实机通过。

开工D盘可用177991405568字节（约178 GB），足够本次约1.88 GB制品/Java复制及约818 MB任务库快照等材料。目标game-data原不存在才创建，原源根保持只读。来源assets/libraries虽是junction，其realpath均仍在该clone的store/views内，逐项校验边界后物化，不保留链接。

来源metadata的真实任务库有21 tasks/21 requests、640条COMMITTED操作、无活动任务；18份JSON与完整操作before/after摘要链和最后提交点一致。这使“官方SQLite备份+正式仓库API重绑新路径”可行，无需重造ready或任务。源profiles虽仍登记原测试根Java路径，clone内已有普通Java17缓存，本轮只按缓存ID选clone内实际文件，不跟随该旧绝对路径读取原测试根。

## 实际准备步骤与可信边界

脚本和结果均在v11 `acceptance-results/game-data/`：

1. `prepare.mjs`复制18份源metadata JSON并持久保存`source-metadata.json`；对源tasks.sqlite使用`node:sqlite`只读DatabaseSync及官方`backup()`生成一致目标快照。逐条核对640操作摘要链、18JSON最后提交点，确认无活动任务，备份前后源JSON摘要一致。没有直接SQL INSERT/UPDATE/DELETE，也未复制源owner.guard/owner.lock、objects-index/transfers SQLite或旧锁。
2. 三实例完整record、metadata、receipts和实例磁盘projection保持原字节/语义；Fabric原revision63 projection到revision64 metadata的已提交Mod事务证明一并保留，不重写收据/提交摘要。真实任务、请求、提交日志与历史会话来自快照，**仅作为历史，不作为新产品启动/游戏成功**。
3. 枚举source realpath必须在clone边界内，目标必须在新isolated内。计划15387文件，复制前写`copy-plan.json`；6路有界复制，每文件独立核对复制前后源SHA256、size/mtime及目标SHA256，目标普通文件且nlink=1，结果逐项追加`copy-results.jsonl`。完整`copy-manifest.json`在正式服务复验前落盘。
4. 复制15387文件、1881117097字节。包含共享assets/libraries、三实例及旧/新隐藏依赖jar与相应官方元数据、所需内容对象与.sources、clone本地完整Java17。排除saves、logs、screenshots、.fabric、.oucl-launch、.oucl-mod-staging、.oucl-natives-*临时目录、.lock/.tmp和其他SQLite。保留正式natives文件，随后用可信native归档正式复验；不复制临时worker/native工作区。
5. 在**目标**打开候选RecordStore并recover，按原installation revision使用正式write追加新dataDirectory（rootId命名空间保留）。不是手改JSON/SQL绕过日志。新StorageClient、HashPool、ObjectStore调用既有`rebuildIndex()`，重新解析.sources并哈希内容，**7302条来源证明重建成功**，正常关闭临时object owner。
6. 通过正式writeLaunchProfiles清除目标中指向外部根的Java候选，再由ProfileService.registerJava实测复制Java并登记；创建新的离线账户OUCLAV11。通过writeInstances把目标选择索引投影为三份已验证ready实例。两个历史失败实例的JSON和原任务/操作仍在快照证据中，只是不列入新测试选择索引；未删除原根任何记录，也未把失败状态改ready。
7. 对每份实例调用候选正式`prepareLaunch`、`verifyPreparedLaunch`、`inspectLaunchMods`，并断言storage读回的实例envelope与源记录一致。三者均18项native事实、local.state=satisfied；Fabric库存含FerriteCore6.0.1实际JAR摘要。没有调用GameProcessService.launch；本阶段没有持有真实游戏生命周期租约的承诺，产品后续仍须走D实际gameDir锁内最终复核。
8. 服务正常close后独立`audit.mjs`核对目标结构、真实账本保留、双索引摘要、复制Java真实属性及597冻结文件。prepared.json只在正式服务预检通过后生成。

## 实际失败与续接（保留原证据）

首次运行的验证脚本把清除selectedJavaId写成“属性存在但值undefined”，候选严格parseLaunchProfiles按设计返回INVALID_RECORD，发生在该档案写入之前。该次copy/index rebuild已经完成，finally正常关闭服务；没有删除目标、重复制或放宽产品schema。

原执行内容保留`prepare-initial.mjs`，失败日志`preparation.log`，退出1。仅修正验证脚本为真正省略该属性（delete），当前`prepare.mjs`为修正后的新空目标可重现版本。随后使用独立`finish.mjs`读取已持久保存的copy/source/snapshot/rebuild证据，先核对源JSON未变，再从现有目标续接正式profile/index API与三实例预检，`finish.log`退出0。产品源码没有修改；原失败不计通过。

操作示例（主协调无需为GUI再跑，目标已准备）：

```text
node acceptance-results/game-data/prepare.mjs
# 仅新空目标使用，已有isolated时按设计拒绝；不要重复复制覆盖。
node acceptance-results/game-data/finish.mjs
# 仅本次未生成prepared.json的已完成copy/rebuild阶段可续接；成功后拒绝重复。
node acceptance-results/game-data/audit.mjs
# 只读核对资料，写本专属audit结果；不启动GUI/游戏。
```

当前任务没有运行新的全量test/build，也未触碰主协调正在执行的完整验证或C窗口。

## 给主协调的精确新身份

前缀`D:/MC_start/OUCL-acceptance-v11-20261113/acceptance-results/game-data/`：

| 项目 | 值 |
| --- | --- |
| userData/profile | isolated/profile |
| dataDirectory | isolated/games |
| rootId | 45d6e04c-4b82-4d30-be9b-86b02d74bcc5，只在新profile绑定新dataDirectory |
| 新离线账户 | c626f7bc-b673-45bb-859e-c62f568c7ba5，A v11 coexistence / OUCLAV11，uuid bd04a80b-3c4b-3acc-8011-389a3b52df1b |
| 新Java登记 | 179db62e-bab4-485a-a7d2-d322fa745e4f，isolated/java17/bin/java.exe，Microsoft17.0.15，实测Windows/x64 |
| 旧原版 | 24871144-2454-505b-92aa-2741ccb05834，PA-v16-Vanilla，revision62，原独立jar目录和indexes/5.json |
| 旧Fabric | 5297a61f-56b1-5159-a84f-440c49b9ff5b，PA-v17-Fabric，revision64，Loader0.20.1、FerriteCore6.0.1，旧dep-0c3ec587af28e5a785c0b4a7b8a30f9a8f78f838目录和indexes/5.json |
| 新Quilt | 34d051d5-22db-58a2-9bf0-e5990b01b87b，PA-v21-Quilt，revision63，Loader0.29.2，dep-0c3ec587af28e5a785c0b4a7b8a30f9a8f78f838-3ecf2cab995685d345a257326ba72192b7911250目录和带SHA1索引别名 |

prepared.json列出全部绝对jar路径、index路径、库存fingerprint、Java/账户ID。旧历史离线账户仍在档案中，主协调应明确选择新OUCLAV11，不把旧历史游戏任务当本次尝试。准备时只保留新的目标Java候选，不会回退到原根Java路径。

## 最终审计结果

`audit.json`为PASS，`audit.log`退出0：

- 全目标15408文件、4628目录，无符号链接/多链接普通文件/剩余.lock。新目标owner.guard由正式StorageClient生成，并非复制；bootstrap/对象/实例旧锁从未移除或带入。
- 源21 tasks和21 requests与目标按主键稳定排序后逐行相等；源640条operations为目标完全不变的前缀。仅目标正式API追加5条COMMITTED：installation、launch-profiles三次、instances。不存在手写成功任务/ready/许可。
- 源18JSON全部仍为初始SHA256，三份目标实例读回与源envelope相等；597冻结文件全部无漂移。
- 原/目标indexes/5.json SHA1均`ada52cc672270e8dc69e912b2ba0ea9c141ed664`；新别名indexes/5-2b3aa959237269caa09ac97fc3f7eae651315696.json SHA1均`2b3aa959237269caa09ac97fc3f7eae651315696`。
- 两次真实目标Java测量（正式登记及最终审计）均Microsoft17.0.15/Windows/x64；没有调用旧登记的外部Java。

原已提交Mod事务中的文件identity是历史记录，未改造成目标新inode所有权；本次只使用其精确提交摘要作projection证明，不触发旧事务回滚/清理。历史session也不认定为当前进程/退出证据。主协调须记录本轮新的launch任务/会话ID、产品/游戏PID与时间，再依据实际菜单、Mod日志、自然退出、重开和两索引/旧路径不变形成v11共存证明。

## 工件SHA256

均相对game-data目录；完整逐文件源/目标SHA256在copy-manifest.json，摘要结果在audit.json：

| 工件 | SHA256 |
| --- | --- |
| prepare-initial.mjs（失败原脚本） | 42b61446662b7e89828d94fc2ef3f32c71663401c82ccbda0212fabdb181271b |
| prepare.mjs（修正后） | 4c26d005017272f5f2412b52f099de5f7c0171b5fa06bf2ad60cd8fef79b6671 |
| finish.mjs | 27853f9c4a98e9f8e73771857a39aed9524d53fac197566a5e3aec192af51541 |
| audit.mjs | 45ac8586d53419c03fda53cde5b70e001ec68308bfed05be311e7b383a9a3f52 |
| copy-manifest.json | e1c077ef7021482487bf9a1f13d8f94b9ab6753f1821f776d11762e51d538f44 |
| source-metadata.json | 6099d2a396b8fd744d8ffff8b22d1374ace9cdf195a2fa13cb89e6333b5f8160 |
| snapshot.json | 0aad42fc7964f08da39dcda346d1cf7fa67b04e44429107238280d99273dd4b0 |
| prepared.json | 0639c5c3d1d0c248c7b3e3637d914ac48bd8544f648e9a7709a722c9964d2c72 |
| audit.json | 2232beb3c4e950c44e51709482d014c0c9ae03699248604d3fb6bc7d0bf96ef7 |

本次是历史独立资料的有证据物化和候选服务预检，不是原锁恢复、全冷下载、新安装、全部加载器/中断矩阵或完整历史目标完成。来源A构造副本曾调整登记/恢复日志的限制仍保留；本次新的路径重绑通过正式日志链和API完成，没有复刻手工失配做法。后续仅主协调操作GUI和产品生命周期。
