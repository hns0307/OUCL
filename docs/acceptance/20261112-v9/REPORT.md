# OUCL 增量报告 v9：C真实保留期尝试受工具超时阻断

本轮未取得C的15分钟过期证据，未改产品源码/契约/依赖，未重跑完整测试、打包或合并已完成集合。已合入main的v3候选及最终EXE不变。

## 已执行与未执行

五小时窗口实际刷新后读取计划/批准及v8报告，尝试补C真实产品保留15分钟的定向证据。独立harness位于`D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v9-retention/window.cjs`，复用原v4-bc合成夹具/profile和原v3七产物，启动前逐项SHA256校验；生产领域、桥接、渲染和时钟未替换。仅拦截外网、记录公开预览结果及DOM，若观察到首次完成，才在900500ms后通过公开桥接查询原previewId及原请求，随后由协调方GUI重新预览。

本轮窗口实际启动为**PID13064 / window2033500**，独立profile为`acceptance-results/v4-bc/profile`，不属于原五聊天窗口。加载时contextIsolation/sandbox=true、nodeIntegration=false，历史A报告/六个合成声明JAR可读，未运行游戏。

最初语义点击没有取得成功预览证据；滚动到provider按钮可见后，点击的自动审批未在截止前完成。按工具提示仅重试一次，仍超时。原始工具提示为：

> The automatic permission approval review did not finish before its deadline.

它是审批超时，**不是动作被判定不安全或产品预览失败**。没有绕过、切换间接执行或再次重复预览动作。随后正常Alt+F4也遇到同类超时，确认窗口后仅重试一次，仍未关闭。

截至本轮保存，窗口仍存在，metadata/owner.lock仍由本轮产品持有；**不要删除锁、强杀、再次启动同profile或把窗口尚存写成正常退出**。需用户手动关闭这一自有测试窗口，或有明确的新受支持处理指令后再接续。不要结束原五聊天窗口。

## 实际证据

[尝试摘要](evidence/attempt-summary.json)：`previewResults=0`、无first-completed/retention-proof、无normalExit、ownerPresent=true。该日志包装器在handler返回后记录，故只能说未捕获公开结果，不用其反推所有内部调用绝对未发生；本轮没有成功预览/完成计时证据。

六个JAR与五条原任务的[前](evidence/state-v9-before.json)/[后](evidence/state-v9-after.json)快照逐字段相同，未新增检查或安装。截图[provider可见](evidence/provider-visible.png)只证明目标上下文，不代表点击成功。[脚本](evidence/window.cjs)、[实际日志](evidence/window.jsonl)、[七产物校验](evidence/verified-product.json)保留。

最后一次get_usage_limits返回不可读取，不把缺失当0或已刷新。停止新增依赖动作，后续先重新读取实际额度，再检查窗口是否已由用户正常关闭。本轮文档先保存在活跃资料目录，尚未同步隔离Git树或main；不在活跃共享树暂存/提交。

## 结论

C真实15分钟保留期仍DEFERRED。原v3–v8通过项不被本次工具超时推翻，A强制中断阻塞及其他剩余边界保持。当前优先处理本轮自有窗口的正常关闭，未取得关闭证据前不继续使用该profile。

## 2026-11-13 用户继续后的正常收尾

用户再次明确“继续”后，主协调先重新读取额度与窗口，确认仅操作本轮PID13064/window2033500，再用CUA正常Alt+F4关闭成功。原日志新增window-closed、will-quit及exit0（UTC05:01:11，本地13:01:11），立即检查owner.lock不存在；没有强制结束、删锁或间接执行。[关闭摘要](evidence/normal-close-summary.json)与[关闭后快照](evidence/state-v11-after-close.json)证明六JAR/五任务保持原样。此前审批超时和未完成保留期的事实不改写；后继真实计时在新v11测试壳进行。
