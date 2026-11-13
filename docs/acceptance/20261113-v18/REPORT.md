# 增量报告 v18：真实Electron安全边界可达子集

固定v11七产物、新独立资料根，真实执行三通道六项非法输入拒绝、三个不受信文档请求拒绝，以及原生产preload对坏requestId响应的拒绝。有限子集PASS，**不等于整个C-R7通过**。没有修改产品、关闭sandbox或开启子frame Node能力。

首轮c-r7-shell实际取得六个INVALID_ARGUMENT，但壳依赖getLastWebPreferences.preload识别主窗口；该运行时该属性未返回，壳误认为primaryWindow=false，拒收测试报告，后续未执行。没有因此推断生产preload缺失。首轮PID18408正常exit0，原脚本/事件保留。

新c-r7-shell-r2仅修正壳的观测识别：真实原入口URL、event.senderFrame===sender.mainFrame、BrowserWindow归属和安全配置。原trustedSender/handler仍接收原事件并判定，不替换授权或领域结果。两轮目录隔离，旧现场未覆盖。R2由主协调CUA启动，PID10156，主窗4786828、独立不受信窗6621820。

| R2实际检查 | 结果 |
| --- | --- |
| 受信原主文档三通道extra/path或URL代ID | 六次原handler返回INVALID_ARGUMENT，真实frame/URL/窗口身份记录 |
| 未登记的不受信文档三通道语法合法请求 | 三次INVALID_SENDER，实际senderId2，未冒充主窗口 |
| 原status真实PREVIEW_EXPIRED后，仅篡改该回执requestId | 明确测试故障注入，未造领域成功；原生产window.oucl bridge返回UNAVAILABLE |
| 资源和安全 | 原七产物后验哈希一致；sandbox/contextIsolation=true、nodeIntegration=false、未开nodeIntegrationInSubFrames；合法start成功数0、archive worker构造数0 |
| 正常退出 | 两窗由GUI正常Alt+F4关闭，进程句柄等待记录UTC11:22:32.842 exit0，owner.lock释放，最终tasks0/requests0/operations1 |

额外测试preload只提交有限非法IPC，不暴露通用桥、不点击产品按钮、不自动发受信合法扫描。一个额外不受信窗口只为实际sender拒绝证据。没有联网或调试端口。七产物不变，非将额外测试preload冒充生产preload；坏回执防御实际调用的才是原生产bridge。

`node acceptance-results/c-r7-shell-r2/verify.mjs` 实际退出0，verification.json为PASS_REACHABLE_SUBSET，原事件/两份报告、三个通道数量、真实frame属性、原错误与损坏回执拒绝、七哈希、正常退出及空任务表均断言成立。不是把10条原handler观测加前轮6条计成一次16项产品测试。最终表计数没有前置快照，不称全profile字节不变。

非主frame在保持现有安全配置下没有IPC能力，本壳未启用额外能力或借主frame转发假冒；坏previewId与URL/path响应变体、直接inventory.scan计量仍PENDING。零worker/零合法start计数及拒绝先于jobs调用的源码是分层证据，不伪称直接scan spy。C-R3/R4见v17未覆盖前提，C-R5迟到跨实例、C-R6窗口展示及其余有限边界继续开放；A实际强制中断仍DEFERRED。

v14-v16证据已本地快进main至569c704，51份归档哈希已实际复核；本阶段后继仅文档证据。完整方案仍IN_PROGRESS，不push/发布，不整体暂存活跃共享树。
