# A1-05官方目录与可信描述子增量

2026-10-24，沿用已批准阶段1A持续实施/提交。新增core/version/manifest、services/catalog、storage/catalog-cache、shared/contracts/catalog、ipc/catalog、ui/VersionCatalog及tests/catalog.test.ts；接入主进程/preload/worker固定缓存和界面。无新依赖，落实已批versions:catalog，不新增候选外业务通道。约定见[CATALOG](../../contracts/CATALOG.md)。

新增8项测试及多输入子场景：官方来源/唯一身份/编码URL；超量响应/错误SHA1/无效UTF8/网络失败；revision绑定分页与candidate状态；过期缓存离线回退/时间/并发刷新/退避；坏缓存和坏新JSON拒绝；可信描述解析及篡改拒绝；IPC先验证sender/DTO/受控输出；真实JSON/SQLite worker缓存重启恢复。

真实官方验证首次失败，保留[first-attempt.json](first-attempt.json)。进一步检查发现920条中的12条历史快照名含空格，过严的旧ID/URL规则拒绝整份清单；修复为受限逻辑版本身份与编码URL解码校验，没有放宽官方host或目录分隔符规则。

`node scripts/verify-catalog.mjs`在`pnpm test`生成.test-build后运行，正式服务读取真实官方清单、缓存及四份描述，核对manifest SHA1后解析1.21.1、1.12.2、1.6.4、3D Shareware v1.34，通过后台缓存的关闭/重启恢复。见[official-live.json](official-live.json)：四个gameDownloaded/gameLaunched均false，不冒充已下载游戏或兼容性实测。

`pnpm check`退出0，typecheck/lint/78项测试/build通过，[check.log](check.log)仅去行尾空白；core行100%、分支98.92%、函数100%，不声称服务/UI同覆盖率。

`pnpm smoke`启动正式Electron45/Node24.22应用与存储worker，实际官方目录经新IPC进入renderer，显示20条版本；四方法白名单、roots.v1/catalog.v1协商、Node API不可见、contextIsolation/sandbox和弹窗拦截保持通过。[smoke.json](smoke.json)、[目录截图](catalog.png)与[主窗口](window.png)已检查。临时profile退出后清理，不修改正式用户目录。系统原生目录选择未在本轮操作，旧便携包未重新生成。

尚未实现制品传输/续传/共享消费者编排、Java发现/安装、实例物化、离线档案、进程及实际启动UI；A1-05父任务及完整目标继续进行中。下一增量接入可信制品下载和任务契约，沿用已有对象仓库和worker，不以目录浏览结束目标。
