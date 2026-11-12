# D隔离实机资料续接完成

日期：2026-11-12（Asia/Shanghai）。候选v3 / bc01f07。本次沿用已授权范围，只写v3 `acceptance-results/v4-game/`和本文；未改冻结产品源码、公共契约、旧收据、原测试根或v1/v2。未启动GUI/Minecraft，不解锁或终止旧进程。开工get_usage_limits确认五小时窗口已刷新：usedPercent=1、剩余99%、resetsAt=1794475541，周额度不作为门槛。

**结果：隔离资料准备与服务级复验已完成，可交主聊天通过真实产品入口操作；尚未完成当前候选游戏菜单/实际Mod加载/退出及重开验收。** 本文承接`docs/acceptance/20261112-v4/D-PREPARATION.md`的额度暂停状态，不覆盖旧失败脚本/日志。

## 本轮实际动作与证据

仅对前次已复制的`v4-game/isolated/`编写独立`resume.mjs`，没有重复制或覆盖原数据。来源仍严格限于历史独立根`D:/MC_start/OUCL-PA-current-20261106`，由P-A/runs/20261110-v17-fabric/REPORT的独立原版/Fabric/FerriteCore证据确认；不读取玩家自用目录。

续接过程：

1. 重新枚举批准来源与现有副本对应文件，来源链接realpath必须仍在原批准根内；目标必须普通文件、非链接、nlink=1，大小一致。8路有界并行核对每文件源/目标SHA256，同时检查源读取前后size/mtime。保存`copy-plan-resume.json`、`source-metadata-resume.json`后核对，完整成功后保存`copy-manifest.json`和`source-metadata.json`，这次在业务服务复验之前落盘。
2. **14,892文件、1,608,786,504字节**全部源/目标SHA256一致。来源实例/installation/launch-profiles/已提交Mod事务JSON在过程结束再次核对原摘要。没有重新改写历史记录、收据、transaction identity；前次副本里的独立Java/账户登记继续沿用。
3. 打开新StorageClient、HashPool、ObjectStore，调用候选原有`ObjectStore.rebuildIndex()`，从复制的权威.sources解析来源证明、重新哈希对象，正常写新index并关闭临时ObjectStore/HashPool。**7,146条来源证明重建成功**。未复制旧objects-index.sqlite或手工插入信任结果。此步骤解决前次新空index导致的NEEDS_RECOVERY；原失败`preparation.log`保留。
4. 正式JavaProbe重新测量复制后的Java17，完整version、vendor、architecture、os符合已登记事实。对两实例通过候选正式`prepareLaunch`、`verifyPreparedLaunch`、`inspectLaunchMods`；均local.state=satisfied，分别读到18项native事实。Fabric库存含FerriteCore JAR，SHA256与历史记录一致。没有调用GameProcessService.launch或生成游戏进程。
5. 服务正常close后，全目标结构扫描为14,901文件、4,433目录，**无符号链接、无多链接普通文件、无剩余.lock**；新tasks.sqlite只读统计tasks=0、requests=0，未导入旧在途任务/会话。新owner.guard数据库与新操作日志是本副本正常生成，不是旧锁复制。完整结果`final-audit.json`。

可复现命令（从v3根）：`node acceptance-results/v4-game/resume.mjs`。当前脚本只校验既有副本并调用现有索引重建和准备服务，不重复制资料；应在协调聊天尚未运行游戏/修改新副本时复用。游戏之后options/config等可写资料变化会使来源对比失败，不应覆盖变化以求通过。`resume.log`退出码0；resume和harness均经`node --check`通过。此次没有重新跑全仓库测试或build。

## 主聊天使用的独立身份

所有路径前缀：`D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v4-game/`。

| 项目 | 值 |
| --- | --- |
| profile/userData | isolated/profile |
| dataDirectory | isolated/games |
| rootId | 45d6e04c-4b82-4d30-be9b-86b02d74bcc5（保留历史命名空间，但只登记新dataDirectory） |
| 原版实例 | 24871144-2454-505b-92aa-2741ccb05834，PA-v16-Vanilla，MC1.20.1，revision62，无Mod |
| Fabric实例 | 5297a61f-56b1-5159-a84f-440c49b9ff5b，PA-v17-Fabric，MC1.20.1/Fabric0.20.1，revision64 |
| 离线账户 | 0c413d06-47c0-4ec0-a312-d8019b5fbd1e，OUCLDVerify4，UUID f84210f6-5567-3e60-8cb1-6c22505094e3 |
| Java | e8d40fff-49ff-4f19-b33a-5d95f9d081c1，isolated/java17/bin/java.exe，Microsoft17.0.15、x64、Windows |
| FerriteCore | ferritecore-6.0.1-fabric.jar，SHA256 c7ba1118a05b2da900d1c369fbe1017a3e3ec3cafe5e51398b851279b9becf24 |

`prepared.json`包含上述绝对路径、完整真实Java属性、两实例库存fingerprint和复验计数。该文件仅在全部服务复验通过且源JSON末次核对一致后生成。

Fabric磁盘投影仍原revision63，正式metadata保持64；原已提交事务证明afterInstanceDigest不变，候选D通过matchesLaunchProjection真实接受。旧transaction文件identity仅是历史完成事实，不能当成新文件身份而执行回滚/清理；本副本没有关联旧任务或恢复执行器重放。旧JSON/收据未重写，saves/logs/旧锁/旧在途SQLite/Quilt失败实例没有复制。

## 真实产品壳（仅准备，未启动）

`product-harness.cjs`先要求prepared.json存在且profile严格匹配独占路径，逐字节核对`acceptance-results/product-manifest.json`列出的七份v3产物，任何不匹配直接拒绝。然后设置独立userData，加载**原始**`acceptance-results/product/main/index.cjs`，主程序仍使用原preload/renderer/worker。

独立只读预检`product-preflight.json`已经核对七份产品SHA256全部一致；harness在真正启动时还会重查并写`harness-product-verified.json`。未复制、修改、注入替代产品资产。

附加记录仅包括：脱敏公共IPC channel/requestId/contractVersion/ok/errorCode、可用时的任务/会话状态，以及Electron webRequest可观察到的网络origin/resourceType；返回原公开结果，不改入参/结果、能力广告或业务决策。不记录payload、账户名、绝对路径、token、任意子进程输出；没有自动调用桥接启动游戏、没有executeJavaScript或自动点击。网络观察不是断网，也不保证覆盖OS/Java所有网络；不能用日志空缺声称全程无网络。

主聊天可通过GUI驱动启动仓库现有Electron：

```text
<v3>/node_modules/electron/dist/electron.exe <v3>/acceptance-results/v4-game/product-harness.cjs
```

其中`<v3>`为`D:/MC_start/OUCL-acceptance-v3-20261112`。本任务没有执行该命令。主聊天是唯一GUI/游戏操作者，应先确认独立实例/账户/Java，再经真实UI启动原版和Fabric，记录菜单、FerriteCore实际加载、自然退出与正常重开。`product-public.jsonl`、`harness-product-verified.json`要等主聊天实际启动后才产生，当前不声称存在或通过。

## 工件摘要与实际限制

`final-audit.json`保存完整工件SHA256，其中：

- copy-manifest.json：bd729133fb50d0ec7c7751b2015b5f5e972921efee391c9d4004c6475f331fc8
- source-metadata.json：a77f455b53999c831a0c5026a8e1bb53ab27976f07f2e0fd7ea80479095d11e1
- prepared.json：df7993ef5ab272fffcabafa55e51ebcb95f7673ac61681d2d593139c6c01f00e
- resume.mjs：a160c19812b70ef20a250e7b4588718728950a3c6a1aeab1fb0fc72e88f1fc8e
- product-harness.cjs：629c1f51096d2d6c19b4a810c6ddaf12bfdd01d3d54538c8a99779c436aa9e56

这是历史独立资料物化、真实Java探测及候选服务级准备证明，不是冷下载、全新安装、GUI、游戏菜单、实际Mod加载或最终EXE证明。v3仍排除Quilt资源索引别名；同ID不同摘要冲突仍安全停写，不在本次资料中修复或验收。源码未变，不把此准备工作记为业务提交。
