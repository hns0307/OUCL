# C-R7 剩余有限格，仅准备未运行

由已验 c-r7-shell-r2 独立复制，保留固定v11七产物原main、原生产preload，sandbox/contextIsolation开启，nodeIntegration关闭。新runtime/profile，拒绝重用旧runtime。无生产/契约改动。

协调者通过CUA启动：

```text
D:\MC_start\OUCL-acceptance-v11-20261113\node_modules\electron\dist\electron.exe D:\MC_start\OUCL-acceptance-v11-20261113\acceptance-results\c-r7-remainder-v25\harness-app
```

只启动这一壳。启动后有限测试自动调用原window.oucl桥，不点击业务按钮。先以同一requestId发送两个结构合法、action不同的输入：首次原registry接纳，第二次应INVALID_ARGUMENT。新独立profile没有给定instanceId，首job预计在上下文解析处失败；不是成功扫描或真实实例预览验收，不提供任何假service结果。如原服务不可用导致首次未接纳，此格前提失败，不把第二次拒绝当冲突通过。记录原handler全部真实输入/输出。

随后三次原status查询不存在ID，原handler必须真实返回PREVIEW_EXPIRED，才进行明确测试故障注入。合法非空status形状为 `{previewId: UUID,status:'queued',result:null,errorCode:null}`；完成态则必须有完整合法MaintenanceDisplay，不以空对象冒充。本壳注入queued负夹具：一次改成另一个合法UUID（schema合法但与请求ID不匹配），另两次分别追加url或path字段（精确键校验拒绝）。原requestId保持匹配。三者预期原生产preload均返回UNAVAILABLE。注入的ok=true仅是负向响应夹具，不是原领域成功，不记为实际queued业务。原错误与注入响应都记录在test-only-response-corruption。

`node acceptance-results/c-r7-remainder-v25/verify.cjs` 只读核对七产物及运行日志；运行前只报PREPARED_NOT_RUN。运行后核验真实首次接纳/同ID不同输入冲突、三次原preload拒绝和零archive worker。没有直接inventory.scan hook，不把零worker冒称动态scan计数。窗口正常退出及owner释放由协调者另记。

非主frame仍不可达：不启用nodeIntegrationInSubFrames、不借primary转发伪造sender、不更改原trustedSender。旧壳通道非法参数/不受信文档已验部分不重跑。HTTP/HTTPS阻断保持，测试期间不联网。实际运行结果全部PENDING，语法检查不等于Electron通过。

静态预检修正（尚未运行）：原空report早于任何maintenance请求，若只在maintenance handler识别primary，report会因未识别被拒，后续请求无法发出。现report入口先observePrimary(actual event)，再frameIdentity校验；不改生产trustedSender。preflight automaticLegalPreviewStart=true，准确反映合成缺实例负场景的自动首次接纳请求。调用链断言见static-preflight.json。
