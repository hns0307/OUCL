# N5 CDN 与主文档来源分离补验

在 Electron 45.0.0 中打开隐藏窗口，使用仓库的 `src/main/online-tools.ts` 实际创建并清理远程视图。页面和 CDN 资源来自不同的合成 HTTPS 来源。夹具注册了内存 HTTP、HTTPS 协议处理器，关闭 Chromium 后台联网，使用独占应用配置目录。页面链接通过 Chromium 实际触发顶层导航，重定向由合成响应返回 302，事件由监听器记录。夹具不会访问真实站点或建立外部 TLS 连接。

| 检查 | 观察结果 |
| --- | --- |
| 原始页面加载 | 服务进入 `ready`，主文档 URL 匹配 |
| 白名单 CDN 子资源 | Chromium 请求 CDN 脚本，脚本实际执行并写入检查标记 |
| 同源 302 | 发起和目标请求均到达协议处理器，真实主框架重定向进入授权文档 |
| CDN 重定向目标 | Chromium 发出主框架重定向事件，CDN 目标未到达协议处理器，主文档仍停留在授权页面 |
| CDN 顶层链接 | Chromium 发出主框架导航事件，CDN 目标未到达协议处理器，主文档仍停留在授权页面 |
| 清理 | 远程内容销毁，工具服务进入 `closed` |

本次 **6 项通过，进程正常退出**。原始请求、事件和断言见 [result.json](run-QENDO6/result.json)，进程输出见 [electron.log](run-QENDO6/electron.log)，命令、输入摘要与退出码见 [status.json](run-QENDO6/status.json)。

从仓库根运行 `node docs/execution/20261119-coordination/n5-cdn-evidence/run-check.mjs`。每次运行新建证据目录和独占临时配置，复用当前仓库的 Electron 适配器。此前 18 项隔离记录及 V 候选记录各自保留。真实 DNS、TLS、真实站点资源和功能仍需在用户确定站点后验收。
