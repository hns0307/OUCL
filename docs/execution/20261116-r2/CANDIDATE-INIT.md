# 候选初始化失败定位与夹具修复

日期：2026-11-16（Asia/Shanghai）。开始时维护树 HEAD 为 `ceed2dc1612344b0f663713a1133a261c7068768`，仅tmp未跟踪。已先读 TASK_PLAN、DECISIONS、20261116/CHECKPOINT 与 PACKAGING/run1—5记录。本任务最多3次有假设的实际运行，实际使用 **2次**，取得证据后停止，没有第3次运行。

## 结论

上一轮候选初始化失败的本次可复现原因是**外层运行夹具的Worker调试会话没有被恢复**。测试以 `--inspect-brk` 暂停引导后的Electron入口，只对主进程发送恢复指令；storage Worker在执行前停住，主进程10秒启动预算到期后终止其启动。包、存储源码、TLS和沙箱不需要为此修改。

修正 `scripts/extensions-candidate-smoke.mjs`，通过官方 NodeWorker 调试通道恢复测试引入的Worker等待/首行暂停后，同一候选外层EXE完成 **18项检查，outer exit0、Electron OS exit0、Worker exit0**。九个包内文件及73个运行时文件摘要全部通过，metadata owner标记在正常关闭后已释放。

候选仍是冻结49086688的只读首片：`release/OUCL-0.3.0-execution-20261116.exe`，433664字节，SHA-256 `7ee7bfc5166659361dc39b575c6e82324156a5caa22c8a9b7d817b7d93b2265e`。没有把当前N6内部执行源码混入该包。正式EXE摘要仍为 `6d4f7f25d29a06b4d3730fd79ad64a160dbcdb28f747e20eda1ce05f98cc690e`，未替换任何EXE或共享dist。

## 两次假设与原始证据

| 本次运行 | 假设/方法 | 实际结果 |
| --- | --- | --- |
| r2/run-1 | 仅驻内存包装真实Worker constructor、online/error/message/exit/postMessage，判断是在构造、JS执行或协议阶段失败 | 构造成功；**10015ms无online、无message、无error**，随后Worker exit1。对应StorageClient的10000ms启动预算；握手仍为空。外层/应用正常退出，失败现场保留。 |
| r2/run-2 | 观察NodeWorker子会话，并恢复测试调试暂停；构造参数和包内字节不变 | storage Worker子会话报告 **Debugger.paused / reason=`Break on start`**。恢复后constructor→online78ms、→ready113ms，之后实际installation/settings/instances等请求有正常response，关闭请求成功、Worker exit0。全部18项运行检查通过。 |

run-1：[worker-events.json](candidate-evidence/run-1/worker-events.json)、[launcher.log](candidate-evidence/run-1/launcher.log)、[application-result.json](candidate-evidence/run-1/application-result.json)、[result.json](candidate-evidence/run-1/result.json)。run-1的owner现场没有清除。

run-2：[worker-inspector.json](candidate-evidence/run-2/worker-inspector.json)、[worker-events.json](candidate-evidence/run-2/worker-events.json)、[result.json](candidate-evidence/run-2/result.json)、[application-result.json](candidate-evidence/run-2/application-result.json)、[process-exit.log](candidate-evidence/run-2/process-exit.log)。时间差、退出码和正式EXE保护核对见 [diagnostic-summary.json](candidate-evidence/diagnostic-summary.json)。

精确区分：两轮 `process.execArgv`均为空，原本通过改它移除inspect的办法没有命中实际暂停；run-2的 `NodeWorker.attachedToWorker.waitingForDebugger`也为false。**不能把false改写为true**。实际首行暂停由随后的 `Debugger.paused` 事件直接证明，通道恢复后同源码初始化成功，是本次结论依据。没有把普通路径、root/sender或SQLite格式问题当作根因，也没有更改服务启动超时。

官方协议依据：[Node24 NodeWorker域](https://github.com/nodejs/node/blob/v24.x/src/inspector/domain_node_worker.pdl) 定义子会话附着/消息转发及 `Runtime.runIfWaitingForDebugger`；[Node Worker事件](https://github.com/nodejs/node/blob/main/doc/api/worker_threads.md) 说明online表示已开始执行JavaScript。实现同时记录实际协议事件，不只依赖文档或猜测。

## 修改边界

仅修改 `scripts/extensions-candidate-smoke.mjs`：

1. Worker Proxy以原constructor和原参数 `Reflect.construct`，只增加事件观察；不替换执行入口、workerData、资源限额或消息内容。
2. 在主进程恢复前启用 `NodeWorker.enable({waitForDebuggerOnStart:false})`；按子会话转发固定Runtime/Debugger指令，实际收到 `Break on start` 后发送Debugger.resume。
3. 以独占文件保存Worker阶段与调试事件，测试进程stderr只写该夹具的阶段信息。

包内main/preload/worker字节、bootstrap-package、StorageClient和存储格式均未改变。没有清除旧owner锁、恢复旧profile、强杀既有产品或安装依赖。两个新运行根分别为 `D:/MC_start/OUCL/tmp/candidate-init-20261116-r2-run-1` 和 `...-run-2`，各自只使用预置且逐文件校验的Electron普通副本及新profile。

## 通过的有限运行层级

- 实际执行候选外层EXE；由其正式引导流程提取应用，主进程 `app.getAppPath`、renderer URL及实际解析的preload路径全部指向该候选提取目录。
- 安全参数保持；renderer没有Node全局；真实preload/IPC握手广告 `tools.isolated.v1` 和 `distribution.preview.v1`。
- 真实IPC空工具表/closed、未知工具拒绝、任意URL拒绝、空pinned来源表、未配置来源不可扫描/安装、close回执正确。
- 正式界面在线/社团包标签显示配置为空；1180×820与720×520内容视口均无横向溢出；已目视核对 [wide.png](candidate-evidence/run-2/wide.png)、[narrow.png](candidate-evidence/run-2/narrow.png)。截图是隐藏窗口capturePage，非真实站点/游戏测试。
- 正常窗口关闭经过真实服务收尾；外层与Electron均为数值exit0，Worker收到close请求并exit0；新profile的metadata owner.lock不存在。

运行使用仅内存的隐藏窗口hook、明确合成catalog网络边界，默认session另行阻止HTTP/HTTPS/WS/WSS；**无公网、真实站点、登录、制品分发或游戏验收**。这次成功只关闭旧初始化诊断项，不把技术文档全部功能或当前N6执行能力改记为已验收。

本脚本独占ESLint exit0，`git diff --check`通过，见 [lint-status.json](candidate-evidence/lint-status.json) / [lint.log](candidate-evidence/lint.log)。没有为纯测试夹具重跑全库单测，也没有新发布/提交；最终公共接纳与本地提交由协调者负责。旧PACKAGING失败记录和run1—5原始证据未修改。

复现需新目录（已有目录按设计拒绝），从维护树调用：

```powershell
$env:OUCL_CANDIDATE_SMOKE_ROOT = 'D:/MC_start/OUCL/tmp/<new-exclusive-candidate-root>'
$env:OUCL_VALIDATION_DIR = 'D:/MC_start/OUCL/本地资料/OUCL-download-main/docs/execution/20261116-r2/candidate-evidence/<new-run>'
node scripts/extensions-candidate-smoke.mjs
```

使用正常自动审核允许的沙箱外运行，以便本机loopback调试、C#引导和复制的Electron正常工作；不添加no-sandbox、ignore-certificate-errors或关闭TLS检查的参数。
