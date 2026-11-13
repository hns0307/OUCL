# OUCL 增量报告 v11：A整合技术检查与C真实保留期

本阶段完成两项：A已批准的索引别名/隐藏依赖双摘要已在独立副本整合并通过统一技术检查；C真实产品预览保留15分钟后，旧身份过期、新身份再预览及正常退出通过。**A同产物三实例实际游戏共存仍待验证，尚未合入main。**

## 冻结集合与实际检查

副本`D:/MC_start/OUCL-acceptance-v11-20261113`来自v3逐哈希复制的597文件，保留BASE-MANIFEST；仅覆盖两份最新批准文档。五个生产文件与五份测试引入A已批准hunk，B/C/D/E其他内容不漂移，详[A整合报告](A-INTEGRATION.md)及[完整差异](evidence/a-integration/final.diff)。

| 检查 | 实际结果 |
| --- | --- |
| 类型检查 | 原定向整合执行完整tsc --noEmit退出0，之后冻结源无变化 |
| 全仓库lint | 退出0，[日志](evidence/full/lint.log) |
| 完整单测 | 655项，651PASS/0FAIL/4既有SKIP，退出0；核心覆盖98.97%行/96.39%分支/99.27%函数，[日志](evidence/full/tests.log) |
| 构建 | 退出0，七产物中仅main/index.cjs相对v3变化，其余六项逐字节相同，[比较](evidence/product-comparison.json) |
| 定向整合 | 92/92通过；首轮21项因.test-build父目录缺失而ENOENT的日志保留，未放宽产品守卫 |

[冻结清单](FREEZE-MANIFEST.json)区分10源/测试和2文档差异；新脚本、复制测试资料和构建输出不冒充冻结源码。四跳过沿用原系统能力/专用worker环境边界，未将其记通过。未重新运行无变化的bootstrap/固定worker专项来制造计数。

已生成独立候选[EXE](D:/MC_start/OUCL-acceptance-v11-20261113/release/OUCL-0.3.0-acceptance-20261113-v11.exe)，406,528字节，SHA256 `3d9a0ebaf289a9552933c97033ffbd6a069e0a0258e3ea8322cc2a5ceb6efce6`。打包报告/清单保留；仅为后续同产物共存验证准备，未声称本轮EXE已启动、冷热或游戏通过。其release侧仅预置已核对的同Electron运行时，未来不能记作新的冷下载。

## C真实自然保留期：已验证的精确范围

旧v9自有PID13064在用户再次“继续”后正常Alt+F4关闭，UTC05:01:11有window-closed/will-quit/exit0，owner释放；六JAR/五任务与v9开始快照完全相同。历史超时和未开始计时事实保留，详v9追加。

主协调随后用同v3七产物、新v11-retention测试壳、原自有v4-bc合成资料打开PID33772/window3279122。通过CUA真实按钮对alpha-provider.jar预览，UTC05:06:05.247观察到completed及blocked/alpha-dependent缺依赖；未替换领域、组件、时钟或结果。后台点击未生效的动作不计成功；目标可见后前台语义点击取得实际公开结果。

900517.324ms后，原previewId的status和原requestId再次接纳均真实返回PREVIEW_EXPIRED，选择仍为A。随后GUI再次点击同文件，使用不同requestId `5947eb20-bcc7-4e95-89d1-584b6ebab951`及previewId `0d1e5690-282b-4c9e-b3de-a985462c731c`，再次completed，界面仍显示同一依赖阻止因素。

正常Alt+F4后UTC05:23:36记录window-closed/will-quit/exit0，owner不存在，六JAR/五任务逐字段保持。[实际结果](evidence/c-retention/retention-result.json)、[原始过期证明](evidence/c-retention/retention-proof.json)、[完整日志](evidence/c-retention/window.jsonl)及[第二次界面](evidence/c-retention/second-completed.png)相互关联。CUA生命周期会话中途到期，仅恢复会话元数据后继续同一产品窗口，没有重启产品或重置15分钟时钟。

本证据是**真实产品公开bridge自然过期与GUI新预览**，不等于组件收到PREVIEW_EXPIRED后清除活动态/错误提示的路径。后者需要一次真实回执延迟来使preload超时并保持原ID；独立`v11-retention-delay/window.cjs`已准备且静态审查，**尚未启动**，详[C审查](C-REVIEW.md)。不混合两个场景，不把脚本设计当执行通过。

## 三实例独立资料：准备完成，游戏待验

[准备报告](GAME-PREPARATION.md)记录从原A构造副本只读复制、先持久清单及逐项摘要，保留一致SQLite快照/640条原操作链和18JSON提交点；仅在目标通过正式API路径重绑，未手改SQL造任务或ready。首轮验证脚本undefined字段被严格schema拒绝的失败材料保留，修正脚本续接，未改产品。

目标15,408普通文件/4,628目录，无链接、多链接文件或遗留.lock；原21 tasks/21 requests逐行相同、640条操作为不变前缀，仅追加5条正式COMMITTED。原版/Fabric/Quilt的prepareLaunch、verifyPreparedLaunch和inspectLaunchMods通过；Java17.0.15为目标实际测量，旧/新索引摘要保持。[最终审计](evidence/game-preparation/audit.json)为PASS，prepared.json及约10MB逐文件清单仍在隔离game-data目录，工件哈希见准备报告。

未运行本候选实际游戏、世界、完整中断矩阵或新冷下载。原A v21菜单不拼接为v11通过；历史来源登记调整、Mod事务旧inode仅作精确提交摘要证明的限制保留。后续只由主协调操作新自有GUI，不触碰原五聊天窗口/旧根。

## 保存与接续

五小时额度已用89%、剩11%，当前C窗口已正常关闭，停止新场景并保存。v9/v10/v11文档和A十文件以独立候选提交归档；A新候选须待同产物代表共存、正常重开及必要包验证后才考虑main。当前已交付v3及main产品代码不变，不push/发布，不整体暂存/提交活跃共享树。

恢复时先确认实际额度≥20%，不重复制已完成game-data、不重跑无变化全量检查。优先实际v11三实例共存；C延迟回执场景按其独立步骤补验。A真实EXE强制中断恢复、未知旧锁及其余边界仍保留，完整历史目标不标全部通过。
