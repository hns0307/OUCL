# D 当前候选产品实机资料准备

2026-11-12（Asia/Shanghai）。仅为协调聊天准备独立资料，未操作GUI、未启动Minecraft。候选为v3 / bc01f07；不修改冻结源码或v1/v2/v3既有文件。新增资料仅在`D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v4-game/`，本文为活跃树唯一产物。开工五小时剩余45%，途中复查剩余30%，周额度不作为门槛。

## 来源和边界

唯一读取来源为历史独立测试根`D:/MC_start/OUCL-PA-current-20261106`，依据`docs/work-packages/P-A/runs/20261110-v17-fabric/REPORT.md:3`、`:5`、`:9`已完成原版/Fabric/FerriteCore事实。未读取玩家自用目录；不解锁、终止或改动来源进程/目录。来源Quilt needsRecovery实例排除。

- 原版实例`24871144-2454-505b-92aa-2741ccb05834`，PA-v16-Vanilla，1.20.1，revision62。
- Fabric实例`5297a61f-56b1-5159-a84f-440c49b9ff5b`，PA-v17-Fabric，1.20.1/Fabric0.20.1，revision64，FerriteCore6.0.1。
- 历史rootId `45d6e04c-4b82-4d30-be9b-86b02d74bcc5`只作为命名空间保留；新profile的installation登记新路径，不指向旧数据。
- 来源两份ready记录全部投影收据mode=copy（3641/3649条），因此复制为普通文件不需要重写旧收据。

## 可重复准备方法

脚本`acceptance-results/v4-game/prepare.mjs`使用固定来源，只允许目标在其自己的`isolated/`内；若目标已存在即拒绝重跑，避免覆盖未审材料。重做需把整个脚本及compiled置于另一个批准的新空目录，不删除旧结果。

先使用现有esbuild把候选src编译到本目录compiled/，再从v3根执行：

```text
node acceptance-results/v4-game/prepare.mjs
```

复制来源realpath必须仍位于指定历史根内；链接解引用后复制为新普通文件，目标nlink必须为1，无符号链接。每文件独立比较复制前/后来源SHA256、目标SHA256及来源size/mtime。复制所需assets/libraries、两实例及共享dep jar、所需内容对象与.sources、完整Java17缓存。排除saves、logs、旧.fabric、.oucl-launch、.oucl-mod-staging和所有.lock/SQLite文件；不复用旧可写实例/native链接。生产服务之后可在新根重建派生目录。

通过候选RecordStore构建全新JSON/操作日志/SQLite，不复制历史数据库、owner guard、session、在途任务。原实例record及收据保持原样；为与磁盘原投影/提交摘要一致，以正常CAS重复写入同一历史data到原envelope revision（62/64）。这些是准备脚本产生的新导入操作，不是历史安装任务重放或成功证明。

Fabric原磁盘oucl.instance.json仍revision63，metadata为64；原committed Mod事务`7527a90e-a352-4745-bef4-9b547a782c5d`提供D matchesLaunchProjection所要求的afterInstanceDigest证明。脚本验证其phase和摘要后原样导入这一历史完成事实，不重写其旧文件identity、不复活执行器、不导入旧任务或会话；这些identity不是新副本的文件所有权证明，不可据此执行清理/回滚。D真实启动验证仍会重新读取新副本字节/库存。

新StorageClient/ProfileService登记复制后的Java并真实probe，创建独立离线账户OUCLDVerify4。随后使用候选InstallerService.prepareLaunch、verifyPreparedLaunch、inspectLaunchMods，对两实例执行对象来源/内容/投影/native/Java版本绑定库存复验；无网络适配、无GameProcessService.launch、无游戏spawn。上述准备通过也不等于产品入口或游戏菜单通过。

## 结果文件和状态

进程日志`v4-game/preparation.log`保留实际复制/服务错误。成功才生成`prepared.json`（profile/根/账户/Java/实例/复验摘要）、`copy-manifest.json`（逐文件来源/目标摘要）、`source-metadata.json`（原记录摘要）。源JSON在全部准备末尾再次核对摘要。若无prepared.json，禁止把目录当作已准备成功或直接作为正式验收结果。

本报告下方续写实际完成状态；当前段落只描述准备方法，不预记通过。协调聊天是唯一GUI/游戏操作者，须使用prepared.json给出的独立profile，并仍以当前候选真实产品入口执行启动复核。

## 本轮实际结果：未完成，额度等待

复制完成并建立新仓库后，第一次候选prepareLaunch在FileViewService的ObjectStore.lookup校验处NEEDS_RECOVERY（详见preparation.log）。原因已静态定位：`src/services/objects/store.ts:111`起lookup首先查可重建index，新仓库按要求没有复制旧objects-index.sqlite，脚本遗漏调用现有`:170`起rebuildIndex。不是已经证明对象字节错误；也不能把仅有拷贝视为可信对象仓库验收。

失败时finally已调用installer/profile/storage.close，没有强杀原进程或清旧锁。当前尚无prepared.json、copy-manifest.json、source-metadata.json：脚本原先只在全部复验成功后写这些文件，因此第一次复制期间的内存摘要没有持久化，不能宣称已交付可审计的完整摘要清单。保留失败副本，不删除/覆盖。

已生成但尚未通过完整准备的目标身份：

- profile：`D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v4-game/isolated/profile`
- dataDirectory：`D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v4-game/isolated/games`
- rootId：`45d6e04c-4b82-4d30-be9b-86b02d74bcc5`
- Java登记：`e8d40fff-49ff-4f19-b33a-5d95f9d081c1`，复制目标java17/bin/java.exe，真实probe得到Microsoft Java17.0.15。
- 离线账户：`0c413d06-47c0-4ec0-a312-d8019b5fbd1e`，OUCLDVerify4，UUID f84210f6-5567-3e60-8cb1-6c22505094e3。
- 两实例身份/revision见前文，未重写旧收据。

续接最小步骤：先查五小时额度；只在实际刷新且剩余不少于20%后，补准备脚本对现有ObjectStore.rebuildIndex的调用（使用新StorageClient和HashPool，完成后正常关闭临时owner，再进入installer），不复制旧SQLite、不手工伪造index信任。修订脚本先持久保存复制清单和源记录摘要，即使后续复验失败也保留。对已存在副本只做校验/续接，不绕过TARGET_ALREADY_EXISTS门禁盲目重跑全部脚本；可用独立resume脚本明确检查目标来源/普通文件/nlink/所有源目标摘要，或在新的空准备目录重做。

随后重跑真实prepareLaunch、verifyPreparedLaunch、inspectLaunchMods；只有这些通过且完整摘要物证保存后才生成prepared.json并交由协调聊天操作GUI。当前禁止把此未完成副本当可启动资料或游戏验收通过。

最后额度检查primary usedPercent=83，剩余17%，reset时间戳1794438506；遵守用户少于20%停止规则，保存此交接后等待，不以周额度或经过时长推断恢复。
