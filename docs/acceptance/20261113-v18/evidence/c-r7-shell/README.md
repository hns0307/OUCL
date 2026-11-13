# C-R7 真实 Electron 边界验证壳（仅准备，未运行）

使用冻结 v11 的原 `dist/main/index.cjs`、原生产 preload 和全部七产物。启动前逐一比对 product-manifest；新建本目录 `runtime/profile` 和 `runtime/OUCL.games`，拒绝复用已有 runtime。只在这些独立目录产生运行数据。未修改生产文件，未启动 Electron、GUI 或测试产品。

协调者通过 CUA 启动目录：

```text
D:\MC_start\OUCL-acceptance-v11-20261113\node_modules\electron\dist\electron.exe D:\MC_start\OUCL-acceptance-v11-20261113\acceptance-results\c-r7-shell\harness-app
```

此命令仅供协调者执行。本聊天仅运行 `node acceptance-results/c-r7-shell/prepare.mjs`，进行 Node 语法及 SHA 核对。原窗口和独立不受信窗口保持打开，待协调者正常关闭；壳不自动点击产品按钮、选择文件、启动扫描、关闭窗口或终止进程。不启用调试端口，不变更系统权限。

## 有限自动测试动作

1. 通过 Electron session.registerPreloadScript 注册额外的测试 preload，不替换生产 preload，不暴露通用 IPC bridge。原窗口加载原 renderer；DOMContentLoaded 后测试 preload 依次向三个原通道发送 extra 字段和 path/URL 代替 ID 的非法请求，共六次。生产 handler 必须返回 INVALID_ARGUMENT。
2. 通过原窗口主世界的原 `window.oucl.maintenancePreviewStatus` 查询不存在的固定 UUID（只读 registry 查询，不启动合法扫描）。透明 handler wrapper 先执行原 callback，必须拿到真实 PREVIEW_EXPIRED 错误，再仅篡改该响应的 requestId。此处明确是测试故障注入，没有构造领域成功结果；原生产 preload 应返回 UNAVAILABLE。原响应与被破坏响应分别记录。
3. 创建独立不受信文档窗口，同样 sandbox/contextIsolation 开启、nodeIntegration 关闭，使用同一 session 的测试 preload，发送三个语法合法请求。其 document URL 非产品入口，且没有原 main 的窗口 session 登记，应由原 handler 返回 INVALID_SENDER。对 start 的请求虽然语法合法，但只能来自不受信文档；受信文档没有合法 start 请求。

原 main 的 `ipcMain.handle` 注册回调被透明包裹，真实 event、input 原样传入，没有替代 trustedSender 或 registry。除上述单次错误响应 requestId 注入外，返回值原样交还。窗口运行时的实际 webPreferences 全部记录并核对 sandbox=true、contextIsolation=true、nodeIntegration=false、nodeIntegrationInSubFrames 未开启。原 preload 路径必须保持原生产路径。HTTP/HTTPS 经 session webRequest 拒绝，未提供替代网络响应。

## 证据层级与限制

`runtime/events.jsonl` 记录实际 sender WebContents ID、BrowserWindow ID、senderFrame 的 URL/processId/routingId、真实 `senderFrame === sender.mainFrame` 比较结果及主窗口归属；不是手造 IpcMainInvokeEvent。额外测试 preload 报告必须与真实主 frame/document URL 相符才收录。`runtime/snapshot.json` 汇总六项主文档拒绝、三项不受信文档拒绝及原 preload 的一次响应拒绝。执行结果尚不存在，所有格当前为 PENDING。

仅透明观察真实 mod-archive Worker 构造数以及原 maintenancePreview handler 返回成功次数；预期均为零。这两个计数**不等于直接测得 inventory.scan 调用次数**。内部 scan 无公开 hook，在不改冻结 bundle 的前提下直接计数仍 PENDING；原源码 handleMaintenancePreview 的拒绝位于 jobs.start/get/cancel 之前，可作为分层代码证据，不能伪称动态 scan spy。

非主 frame 当前为 PENDING：现有安全配置没有可供子 frame 调用的 IPC 能力，本壳不会启用 nodeIntegrationInSubFrames、关闭 sandbox、借主 frame 转发后冒充原 sender，或构造假 event。若 session preload 在目标 runtime 的行为与预期不同，也应保留真实失败/PENDING，不能改信任判定。坏 previewId 及 URL/path 响应变体未纳入此最小壳，继续 PENDING。

`EXECUTED_CHECKS_COMPLETE` 只表示上述有限可达项已收到预期结果，不表示整个 C-R7、窗口业务展示或产品验收通过。若环境服务未就绪导致原 status 并非 PREVIEW_EXPIRED，故障注入拒绝继续；日志保留事实，不制造可注入前提。
