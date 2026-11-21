# 第五阶段增量报告：B活动归属与D真实游戏

日期：2026-11-12（北京时间）。候选仍为`bc01f07`及v3七个已冻结产物，没有修改产品源码。**D代表启动链实机通过，B活动目标同时证据补齐；全局任务中心新夹具和最终打包/合并仍未完成。**

## 本轮可确认的结果

1. 原版1.20.1通过真实产品“启动游戏”入口进入主菜单，游戏内Quit Game后exit0。
2. Fabric0.20.1/MC1.20.1进入真实主菜单，日志确认FerriteCore6.0.1及Java17，游戏内退出0。
3. 启动器正常关闭、owner.lock释放后重开相同独立profile，再通过产品入口启动Fabric；第二次主菜单、FerriteCore日志及退出0通过。复制Java在准备及候选复验中实测Microsoft17.0.15。
4. B选中时，公开IPC在B目标查询前后两次读到同一个A检查任务为running；B返回任务中不含A任务。此前缺失的活动归属证据现已取得，不是直接改写SQL造活动状态。

## D数据准备与证据

续接v4失败副本，没有清理或覆盖旧测试根。[D续接报告](D-RESUME.md)记录14,892文件/1,608,786,504字节的源、目标、普通文件及摘要核对；清单在复验前落盘。使用正式ObjectStore.rebuildIndex重建7146条来源证明，未复制原SQLite或手工伪造索引；原版/Fabric随后通过prepareLaunch、verifyPreparedLaunch和inspectLaunchMods，prepared.json才生成。详[准备摘要](evidence/d-prepared-summary.json)、[工件哈希](evidence/d-final-audit.json)、[复验日志](evidence/d-resume.log)。10MB原始逐文件清单保留在隔离目录，摘要见上述工件哈希，不重复塞入产品包。

实际UI使用[cua-driver技能](C:/Users/Administrator/.agents/skills/cua-driver/SKILL.md)，只操作本轮新启动器PID11452/38572及其父进程关系明确的Java26220/34984/40056，未操作旧根或其他聊天进程。产品harness只设置独立userData、记录脱敏公共IPC/网络；后继固定窗口版本额外设置窗口几何，不替换领域服务或启动结果。七个生产产物摘要与v3一致。

| 场景 | 会话ID | 本轮证据 |
| --- | --- | --- |
| 原版首次 | 462d1681-17f7-404d-b223-35e0a35f26e0 | [菜单截图](evidence/vanilla-menu.png)，[会话退出0](evidence/d-session-results.json) |
| Fabric首次 | 5c65c336-46b0-4e48-a0e5-b6d1c5f4ccf5 | [菜单](evidence/fabric-menu-first.png)，[实际加载日志](evidence/fabric-first-log-excerpt.txt)，退出0 |
| 正常重开后Fabric | 6852d3da-6cb7-4b02-87ae-35ebfcf53ead | [菜单](evidence/fabric-menu-reopen.png)，[实际加载日志](evidence/fabric-reopen-log-excerpt.txt)，退出0 |

[公开启动事件](evidence/d-public-launch-events.json)关联产品入口请求；[实际会话](evidence/d-session-results.json)三项均exited/exitCode0。所有本轮游戏从菜单退出，两个启动器正常关闭，owner.lock已释放。不是强制终止恢复、冷下载、新安装、世界载入或四加载器全矩阵通过。

多屏DPI下若干Cua语义点击返回成功却没有对应IPC/实际状态变化，这些不计启动尝试或产品失败。经新截图核对后使用像素回退，正常关闭时显式确认自有窗口前置再Alt+F4；没有强杀或改玩家设置。一个早先启动的次实例因单实例保护未接管原进程，不计正常重开。旧日志编码包含非UTF8字节，证据摘录仅选本轮ASCII启动/Mod/退出行，未改写原日志。

## B活动归属

[harness](evidence/b-window-targets.cjs)使用原正式服务/SQLite/profile，平台网络层受控延迟5秒后拒绝，仅用于取得活动观察窗口。协调聊天在A明确点击“一键检查”后立即选择B。

[提取结果](evidence/b-final-proof.json)显示任务`815889c6-00d8-4ccf-be5f-3efea8d55456`前后均running，B前后选中且报告归属B，B目标仅有`08feb115-2678-41e2-a486-19466eeeae89`。完整顺序公开IPC证据见[b-window-targets.jsonl](evidence/b-window-targets.jsonl)。这是一组稳定选择下的顺序夹验，非原子数据库事务或真实上游延迟证据。

先前window-active调用globalTasks得到TASK_NOT_FOUND，已定位为合成ready夹具没有对应安装任务，tasks:list在追加Mod任务前按实例taskId取安装任务失败。没有为此放松产品检查或补写假任务。因此上述证据只覆盖实例目标/活动隔离，**不代表全局任务中心完整生产壳验收**。另已安排全新夹具通过正式InstallerService.create生成真实安装任务，再生成Mod检查任务；准备结果另见GLOBAL-PREPARATION.md，尚未启动其窗口时不得记通过。

## 当前门槛和接续

v3的597个冻结文件本轮结束再次核对[无漂移](evidence/source-drift.json)。本轮仅增加验证脚本/证据，没有复跑无变化的651项完整检查，也不把旧数改写成本轮通过。

主分支尚未合并；Quilt别名仍排除，A真实强制中断恢复仍DEFERRED，E最终EXE冷热及部分回调竞态仍开放。下一最小步骤是验全局任务中心新正式安装夹具及正常重开，随后汇总最终可合并清单、同步文档并构建选定集合最终EXE。本轮五小时已用81%（剩19%），保存后按既定门槛等待刷新；周额度不作暂停门槛。
