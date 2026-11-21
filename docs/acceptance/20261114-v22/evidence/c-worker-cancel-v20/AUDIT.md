# C-R3真实Worker生命周期注入审计

2026-11-14北京时间。五小时used73%、剩27%，高于门槛。仅解析已有window.jsonl、worker-private.jsonl、原脚本及前后快照/产物，不运行GUI、Worker、IPC、验证产品或新场景。新增本页及audit.json，旧结果未修改。首个只读PowerShell提取命令有管道语法错误，未执行任何数据/产品动作；修正解析命令后完成核查。

## 有限结论：PASS

这里通过的是**真实JAR Worker带测试keepalive时，原Reader按用户取消终止并等待真实exit、随后可新预览**，不是自然运行时序/网络取消或R4在途关闭。

私有child文件有thread2 keepalive-loaded，UTC2026-11-13T17:46:10.910Z（北京时间11月14日01:46:10.910）。主日志第8行选择thread2、第10行观察原mod-archive-result；父记录不伪称子post调用的直接测量。唯一注入线程与原结果先出现，说明本轮Electron接受了execArgv require，原JAR扫描/哈希确实产生结果，而线程被独立计时器保持存活。

| 原日志行 | monoMs | 意义 |
| --- | --- | --- |
| 60 | 50934.1954 | GUI触发的取消IPC进入，目标旧previewId |
| 61 | 50934.8396 | 原Reader调用原terminate（壳仅委托记录） |
| 62 | 50937.2838 | thread2真实exit，code1 |
| 63 | 50938.0251 | 原取消handler返回cancelled |
| 65 / 66 | 后续 | 原status仍cancelled、DOM显示取消 |
| 68 | 后续 | 新接纳requestId/previewId均不同 |
| 73 / 74 | 后续 | 新观察completed/blocked及对应DOM |
| 75–77 | 后续 | window-closed、will-quit、app exit0 |

从worker-selected的mono26618.9033到取消进入约24315ms，明显早于原30000ms Reader timeout；取消→terminate→exit→cancelled的严格顺序支持用户取消分支，不能改写成30秒timeout。线程exit1是terminate后的预期终止结果，**不称自然退出0或扫描自然成功**。应用最终exit0与该线程终止码分别记录。

旧request=`40ec5ae3-074f-460f-9aac-d6d5e0c5ca8c`，preview=`63179957-2f58-4793-be8e-26c409162898`。新request=`fbcb4927-37a8-4f61-bc25-cd95d42f3c57`，preview=`09e0d5c5-7f24-4102-8736-d29b02ea7a2a`。新观察不再注入keepalive，原服务正常完成；不能仅凭handler返回推断UI，故另核对第66/74行DOM的取消与blocked显示，所有DOM记录nodeAbsent=true。截图由主协调查看，本审计未新操作桌面。

七项verified-product对应实际产品SHA256全匹配，0不符。state-v22-worker-before/after整个快照哈希相同，均6JAR/5任务；owner释放由主协调记录，本审计未另查进程/锁。没有手写任务状态、改变JAR、放行网络、修改原entry/超时或测试壳主动terminate。

## 不扩大的结论

本轮关闭C-R3运行取消的**代表真实worker退出等待链**。保留生命周期故障注入标签；不覆盖网络AbortSignal/close，亦不覆盖完成先赢、取消回执TIMEOUT、R4扫描/网络在途关窗重开。没有新准备这些场景，也未修改旧网络UNKNOWN结论。
