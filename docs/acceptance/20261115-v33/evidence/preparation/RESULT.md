# v33 三实例准备结果

状态：PREPARED，真实游戏验收仍待统一管理执行。prepare.mjs 单次进程正常 exit 0（exec session 28721），prepared.json 已生成。

独占数据：D:/MC_start/OUCL-acceptance-v33-20261114/game-data；profile 在其 profile 子目录，游戏数据在 games，复制 Java 在 java17/bin/java.exe。资料源只读 D:/MC_start/OUCL-PA-clone-20261112，启动前确认目标不存在、源 metadata/object 所有者标记不存在、活动任务为0。

核验源21任务、21请求、640条COMMITTED操作完整链及18个JSON提交摘要；只读SQLite backup到新目标。复制15387个文件/1881117097字节，链接仅在源边界内物化；逐文件源前后和目标SHA256一致，目标常规单链接文件。清单和逐项结果已保存。排除旧owner/锁、objectindex/transfers数据库、saves/logs等。原始实例/收据/Mod事务保持，历史失败记录保留，不伪造ready。

使用0c2a889c候选的只读full-r3编译服务；真实worker用该候选dist/workers/entry.cjs。production-seven-sha256.json保存7个dist产物与v32包摘要的逐项一致结果。正式RecordStore.write及日志重绑定目标installation；ObjectStore.rebuildIndex实际重建7302条来源证据。ProfileService实际探测复制的Microsoft Java17.0.15，创建目标合成离线档案OUCLAV33。仅目标实例索引通过正式API投影到三实例；原始实例envelope不变，历史失败JSON不删除。

同一已启动prepare流程已实际执行prepareLaunch、verifyPreparedLaunch、inspectLaunchMods：
- 原版24871144-2454-505b-92aa-2741ccb05834，revision62；18 natives，local satisfied。
- Fabric5297a61f-56b1-5159-a84f-440c49b9ff5b，revision64；18 natives，local satisfied；FerriteCore6.0.1原Mod证据保留。
- Quilt34d051d5-22db-58a2-9bf0-e5990b01b87b，revision63；18 natives，local satisfied；双摘要隐藏依赖和独立资源索引保留。

结尾18项源JSON摘要再核对不变；服务正常close，随后只读列举确认目标metadata及对象库无*.lock。新owner.guard.sqlite是本轮正式API创建的正常租约文件，不删除。

范围限制：无GUI/MC启动、无产品强杀、无源码改动、无下载验收。audit.mjs已准备但未执行；因此尚无独立终局audit PASS（例如完整目标遍历、原始DB行前缀末次比对）。额度由开始24%降至最后观测18%，统一管理明确不新增步骤，因此保留此检查点，不开始audit或GUI。下一步先检查额度和现场，由统一管理执行审计后再决定新EXE GUI/游戏。

不要重跑prepare.mjs覆盖现有目标，不删除后重复制；如需接续，先读prepared.json与本报告。全部脚本、复制清单、日志及新包七项摘要在本目录，SHA256.json固定交付证据（不含自身）。保留首次CHECKPOINT历史，现况以本报告及CHECKPOINT末尾更新为准。
