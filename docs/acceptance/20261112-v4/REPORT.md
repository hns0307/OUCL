# 第四阶段增量报告：真实产品壳与额度交接

2026-11-12（北京时间）。状态：**B/C部分产品补证完成，D资料准备尚未通过，保存后等待额度刷新。** 候选代码仍为v3/`bc01f07`，没有新业务源码改动、合并或发布。

## 已完成

使用既有cua-driver技能，只操作本轮自有Electron PID26448/36104（E）、34852/26360（BC），均已关闭并结束会话；未操作原五聊天的窗口、游戏或旧数据。受测7个生产产物与v3摘要一致，没有替换IPC/领域服务/preload/React组件。

**B/C产品壳**：使用正式StorageClient、SQLite、JAR worker、Mod服务生成的A/B持久任务和报告；输入为本地生成的非可执行合成JAR，不是真实上游游戏。网络在测试session受控拒绝，A如实unknown、B如实unsatisfied。详[准备报告](BC-PREPARATION.md)。

- A/B切换及同profile正常关闭重开后，报告实例和所选实例始终一致，公开目标查询仅返回该实例任务。[身份摘要](evidence/bc-identity-summary.json)、[时间线](evidence/bc-timeline.json)记录两轮两实例。
- A provider的真实只读预览显示blocked、直接依赖alpha-dependent.jar；B provider显示变更前beta-dependent.jar要求>=2.0.0、实际1.0.0，变更后缺依赖。[UIA](evidence/bc-uia.json)确认文件、严重程度、来源及实际版本已进入生产界面，不再只是替代hooks探针。
- 6个JAR前后SHA256一致。只读预览后原2任务全记录也一致；随后用户界面明确点击一次A“一键检查”，新增第三任务并正常完成，不能将任务数变化误报为预览写入。网络等待为受控5秒，不称真实上游慢网络；已恢复delayMs=0。
- 首轮新增检查时切B，B始终仅显示自身目标。此次未在同一时间点获得“A仍活动+B已选”的完整全局状态证据；热重开harness追加了只读globalTasks记录，但额度不足未再提交新检查。因此不关闭全部活动态切换矩阵。C预览本来是内存观察，重开恢复的是持久mod-check报告，不能声称旧previewId持久恢复。
- [冷轮日志](evidence/bc-window-cold.jsonl)、[重开日志](evidence/bc-window-hot.jsonl)、state-before/after-preview/after-cold/after-hot及harness均保留；两轮退出日志为exit0。初次滚动/点击有未命中屏幕内按钮，重新读取坐标/实际状态后才成功，不凭click返回认定通过。

**E真实窗口生命周期**：原生选择器已由UIA确认可见时，测试harness只销毁本轮自有BrowserWindow，触发实际sender destroyed，产品窗口和原生选择器均消失，进程exit0；同profile重开显示准备完成并exit0。[窗口观察](evidence/e-window-observations.json)、[销毁日志](evidence/e-destroy.jsonl)、[重开日志](evidence/e-afterdestroy.jsonl)。harness原样调用真正dialog，仅记录调用/回调；销毁通过测试标记触发Electron API，不是用户关闭动作或强杀进程。原生回调未在退出前记录settled，因此所有迟到回调/在途worker竞态仍未由此证明。不是最终EXE冷热验证。

## D准备失败与续接点

历史独立测试根只读，复制到`D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v4-game/isolated/`，链接物化为普通文件，不复制旧owner锁、会话或在途SQLite；复制Java实际探测为Microsoft17.0.15。完整准备未通过：正式prepareLaunch在ObjectStore.lookup/FileViewService返回NEEDS_RECOVERY，新对象索引没有经现有rebuildIndex重建。

详[D准备报告](D-PREPARATION.md)。**尚无prepared.json、copy-manifest.json、source-metadata.json；不能启动此副本或宣称摘要清单交付成功。** 原脚本只在全部复验通过后写清单，首次失败导致内存复制摘要未持久化；保留失败副本与preparation.log，不覆盖重跑。

刷新后先编写独立resume脚本，严格核对来源/目标普通文件、链接数与逐文件摘要，及时持久保存清单；使用正式ObjectStore.rebuildIndex重建新索引，不复制旧SQLite、不手工伪造信任。再走prepareLaunch、verifyPreparedLaunch、inspectLaunchMods；全通过且prepared.json明确生成后才交由协调聊天唯一操作新产品窗口/游戏。Fabric旧实例投影revision63与已提交Mod后的metadata64差异需保留原完成事务证明，不改旧收据或绕过D。

## 尚未完成与暂停

当前可合并结论仍按v3技术候选分层：B/C上述产品子项补证成立，D实际游戏、E最终EXE与部分竞态、B全部规模/活动态矩阵未齐；Quilt别名继续排除，main/mod_loaders未合并。v4只有夹具/证据/报告，不需要以无变化完整回归替代缺失产品证据；v3的651项结果不改写为本轮重跑。

五小时额度最后检查已用88%、剩12%，按用户门槛保存并等待，周额度不作门槛。BC/ADE准备聊天均已完成本轮，原始五聊天保持暂停。本轮自有窗口已正常关闭、受控网络延时恢复0，现场保留。v4文档与v3候选提交追加仍在活跃树docs/acceptance中待后续独立文档提交，未混入活跃产品源码。

接续顺序：先查实际额度足够，再读本页及D准备报告，优先安全重建D副本索引；继续B活动态证据及D当前产物真实菜单/Mod/退出/重开，最后再决定合并和最终EXE。不重新复制全部资料、不清理原测试根、不将缺项标PASS。
