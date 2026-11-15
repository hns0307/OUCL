# N5 在线工具隔离设施

日期：2026-11-15（Asia/Shanghai）。本片由执行统筹按用户继续实施/分工指令分派，先读 TASK_PLAN、DECISIONS 与 N5/N6 方案。仅交付隔离设施；用户确认真实站点尚未确定，产品固定注册表为空，不猜测站点、许可、登录或来源。

## 文件与接线

- `src/core/tools/online-policy.ts`：固定记录校验、精确 HTTPS 文档/资源 origin 分离、拒绝凭证/非默认端口/IP/明显内网域名；冻结复制记录，最多16工具/16资源来源，URL上限4096字符。
- `src/services/tools/service.ts`：无 Electron 的可注入服务。`list/state/onChange/open/retry/close`，单视图与单调修订/代次；同工具在途复用；关闭立即使旧回调失效；清理失败隔离整个服务，不再创建可能并存的未知视图；重试迟到不能覆盖新选择。
- `src/main/online-tools.ts`：`createElectronOnlineToolService(owner, registry=空, topInset=260)`。遵守 services 不导入 Electron 的仓库边界，因此真实适配器位于 main。主进程固定内容矩形，顶部至少260px、底部至少32px，不接收 renderer 任意 bounds；不足360px宽/160px可用高时隐藏。
- `tests/online-tool.test.ts`：12项纯策略与真实服务控制器测试。

每次打开分配独立非 `persist:` session，无应用 preload、无 Node，保留 sandbox/contextIsolation/webSecurity。仅允许固定来源 GET/HEAD；文档与资源权限不同；阻止子frame、任意协议/新窗口/webview/下载。专用session权限请求、检查、设备、屏幕捕获全部拒绝；HTTP认证不给凭据，客户端证书请求关闭视图，证书错误拒绝。文档追加限制性CSP，阻止frame/worker/object/form/base；不修改主界面CSP。WebRTC使用 `disable_non_proxied_udp`，不宣称这等价于通用网络防火墙。

文件选择采用主进程固定 CDP `Page.setInterceptFileChooserDialog({enabled:true,cancel:true})`，初始化失败不加载远程页；调试器意外detach触发关闭。该调试器没有renderer调用入口。关闭先隐藏/移除，再明确 `close({waitForBeforeUnload:false})` 并等destroyed；销毁和独立session连接/存储/cache清理有界，失败返回受控错误。

发现并修复实际Electron初始化问题：全新WebContentsView尚无renderer target，直接Page.enable超时。现在仅由主进程显式加载固定空 `about:blank` 初始化，再安装CDP，最后加载受审HTTPS入口。此例外不放行远程页面导航到about协议。

## 实际验证

1. 独占 `OUCL_TEST_ROOT=D:/MC_start/OUCL/tmp/n5-agent-20261115`。esbuild bundle `tests/online-tool.test.ts` 后 Node `--test`：**12 PASS / 0 FAIL / 0 SKIP**。覆盖空注册表、HTTPS边界、不可变配置、同工具复用、关闭等待、跨代次迟到、load/crash/同步构造失败、清理隔离、retry竞争、退订不取消。
2. 四个生产/测试文件独占 ESLint：**exit0**。全局类型检查阶段性仅剩其他并行接线文件的未完成文案/未使用声明；本片文件无类型错误。最终全库结果由协调者统一记录，不预记全过。
3. 实际 Electron45 隐藏 BrowserWindow + 正式适配器：**18检查 PASS，子进程exit0**。HTTPS由专用session `protocol.handle('https')` 返回明确合成HTML，没有公网/TLS连接。确认独立内存session、独立WebContents、sandbox/Node隔离、没有window.oucl/require、通知/剪贴板权限拒绝、未列来源和POST请求拒绝、CDP已安装且点击文件输入未取得本地文件、弹窗拒绝、真实导航监听拒绝file、beforeunload不阻止destroy、清理后closed/无额外WebContents、专用Cookie清除、重开新session。

真实Electron夹具最初在受限运行环境退出 `2147483651`，未进入fixture，不记通过。使用工具正常 `require_escalated` 自动审核后，首次实际运行暴露上述Page.enable超时；修复后夹具因读取已销毁WebContents.session失败（12断言已经通过），将旧session保存在关闭前后复跑通过。最终补权限/请求/Cookie五项后18项全部通过。没有降低sandbox、禁用证书或修改产品断言。

独占证据与可复跑脚本（协调者可精确归档）：

- `D:/MC_start/OUCL/tmp/n5-agent-20261115/electron-check.cjs`
- `D:/MC_start/OUCL/tmp/n5-agent-20261115/electron-result.json`
- `D:/MC_start/OUCL/tmp/n5-agent-20261115/adapter.cjs`（正式适配器esbuild bundle，external electron）
- `D:/MC_start/OUCL/tmp/n5-agent-20261115/online-tool.test.mjs`

## 限制

18项是隐藏Electron与合成协议夹具，不是正式产品GUI/真实站点验收，也不证明公网TLS/许可、所有设备API、任意重定向/下载/崩溃矩阵。文件选择检查确认CDP安装和点击后无本地文件，不冒称人工观察了原生对话框；真实站点接入前仍需对应交互验证。静态主机名检查不是DNS解析/IP防火墙，不保证批准域名永不解析到内网；默认空注册表避免提供任意网址入口。

无新依赖、应用preload/CSP放宽、文件导出或凭据持久化。共享契约、IPC、App接线与本地文案由协调者维护；本代理未git add/commit、未覆盖共享dist/测试根、未触碰玩家目录或旧EXE。历史25 FAIL由独立基线任务定位，不由本片改写。

官方依据：[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)、[WebContents关闭生命周期](https://www.electronjs.org/docs/latest/api/web-contents)、[Session权限](https://github.com/electron/electron/blob/main/docs/api/session.md)、[CDP文件选择拦截](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-setInterceptFileChooserDialog)。实际代码同时通过本机已安装Electron45类型核对。
