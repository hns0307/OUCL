# OUCL 跨工作包验收 v6：全局任务中心

本阶段通过：同一v3生产壳首次启动及正常重开后，均显示两条安装、两条Mod检查任务，四项均完成且观察状态confirmed。两次启动器正常退出0，owner.lock释放。未改产品源码、契约、依赖或持久格式。

## 实际证据与边界

接续[v5正式夹具准备](../20261112-v5/GLOBAL-PREPARATION.md)，没有重新运行prepare或手写ready/SQL任务。生产main/preload/renderer/worker来自v3七产物；输入为本地合成且不可执行的客户端与JSON-only声明JAR，仅验证正式任务服务及产品壳，不是上游下载、兼容性或游戏运行证明。

主协调使用[cua-driver技能](C:/Users/Administrator/.agents/skills/cua-driver/SKILL.md)操作本轮新窗口PID20880/5780，从顶部“下载”进入任务记录。进入时短暂显示上次记录，随后正式逐任务查询确认；未把初始未确认状态记为失败或伪造确认。观察脚本只调用公开桥接读取任务和DOM，不替换领域服务，不自动点击或提交。

| 场景 | 实际结果 | 证据 |
| --- | --- | --- |
| 新profile首次生产壳 | 4项completed/confirmed，正常exit0 | [窗口](evidence/cold-tasks.png)、[完整记录](evidence/window-cold.jsonl) |
| 相同profile正常重开 | 原4个taskId保持，4项confirmed，正常exit0 | [窗口](evidence/hot-tasks.png)、[完整记录](evidence/window-hot.jsonl) |
| 可复现提取 | `node acceptance-results/v5-global/extract.mjs cold hot`退出0/PASS | [结果](evidence/window-extraction.json)、[提取器](evidence/extract.mjs) |

公开任务返回和DOM逐项匹配4个预期ID，两种kind各2项，无nextCursor；首次DOM见原记录第15行，重开第14行。页面无Node，全握手维持19能力。原始harness及输入身份见[window.cjs](evidence/window.cjs)、[seed](evidence/seed.json)。这次cold/hot指新profile首次及相同profile重开，**不是最终EXE运行时下载冷热验证**。

后台滚动/关闭被驱动拒绝后按提示对本轮自有窗口使用前台输入；截图核对四项可见。关闭使用正常Alt+F4，无游戏运行、强杀或旧根操作。两个窗口均有window-closed/will-quit/exit0。

## 增量结论和下一步

B实例归属、C只读预览、D代表实际启动与E固定样本入口的此前证据继续由v3–v5负责，本轮不重复宣称或重跑651项。原全局TASK_NOT_FOUND只属于缺真实安装任务的旧合成夹具；新正式安装夹具与产品壳通过，没有为测试放松产品检查。

候选仍为`bc01f07487ca7e8d76f17115ea148efcafd748c2`，main/mod_loaders未合并。下一步：选定集合最终EXE构建与冷/热检查、统一可合并/补证/排除清单、同步独立文档提交。A强制中断产品恢复仍DEFERRED；Quilt索引/隐藏依赖别名不进入本候选；E部分选择器回调竞态仍保留限制。

后继补证：[B-SCALE](B-SCALE.md)完成双域各1000真实计划全worker/重开及公共20页、1001拒绝；合法规范DTO的字节阈值不可达性有保守上界证明。它更新BC-CLOSURE当时的相应DEFERRED，其他窗口竞态限制保留。最终EXE后继实际验证及本地整合见[v7](../20261112-v7/REPORT.md)，不回写本阶段当时尚未执行的状态。
