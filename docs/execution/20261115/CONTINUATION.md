# 持续执行与额度恢复交接

日期：2026-11-15（Asia/Shanghai）。起点9a996463；当前main工作树为本报告所属仓库，原mod_loaders WIP保留。用户明确要求持续执行技术文档并允许子代理；随后确认在线站点尚未确定、分发来源与公钥先空出。历史PENDING不批量改写，当前实现范围由这次指令及明确空配置决定。

## 已实现

- N5：固定空工具注册表、纯HTTPS来源策略、单一WebContentsView/临时session、无应用preload、权限/导航/请求/下载限制、CDP文件选择拦截、销毁与清理失败隔离。tools.isolated.v1严格IPC、幂等/冲突、有界请求记录、超时结果未知、主界面单飞轮询与离页关闭已接线。主进程原生对话框前关闭远程view；文档导航、hide、renderer退出及窗口销毁撤销所有权。
- N6：固定空信任来源、pinned Ed25519公钥验证、撤销、精确包/版本/环境、信封大小/时间预算、真实只读文件观察、独立只读收据解析、五类归属与冲突。distribution.preview.v1严格IPC、请求幂等/冲突、取消等待清理、文档失效、实例/根绑定和有界安全DTO已接线。只返回前200文件及截断标记；不公开绝对路径、公钥或URL。
- UI：工具箱本地/在线/社团包标签；空配置明确展示，站点或来源未配置时没有可用打开/安装入口。N6只有验证预览，没有安装、更新、删除、隐式迁移或自动收编。收据只是本地分类声明，不能据此证明安全执行许可。

文件与专项证据见N5-IMPLEMENTATION.md、N6-IMPLEMENTATION.md、EXTENSIONS-REVIEW.md、EXTENSIONS-UI.md、BASELINE-RESOLUTION.md。三个子代理分别实施隔离/分发、复核IPC与环境、真实组件窗口；均不是侧栏独立聊天。

## 实际验证

| 项目 | 结果与边界 |
| --- | --- |
| 最新完整原断言单测/覆盖率 | **748项，744PASS / 0FAIL / 4既有SKIP**，子进程exit0，56.298秒；覆盖率lines98.92/branches96.38/functions99.31。独占测试根，经自动审核允许沙箱外运行真实链接/回环，不改断言/skip。见final-evidence/test.log与test-status.json。捕获包装器随后尝试向GBK控制台打印Unicode尾段时报UnicodeEncodeError、外层exit1；测试本身exit0与原始UTF8日志已经落盘，不混为测试失败。 |
| 历史25项失败 | 同原断言25PASS；同探测脚本证明默认沙箱link EPERM/回环EACCES、沙箱外成功。历史日志保留，没有改记旧运行通过。 |
| 类型与lint | 类型检查exit0；最终lint先发现smoke脚本Response未声明，改为globalThis.Response后完整lint复跑exit0，见final-evidence/checks.json与lint.log。 |
| 独占生产构建 | exit0，输出D:/MC_start/OUCL/tmp/n5n6-final-20261115/dist；不覆盖正式dist/EXE。 |
| N5纯策略/生命周期 | 12项通过。 |
| N6签名/归属/真实只读文件 | 9项通过；密钥均为测试临时密钥，不进产品。 |
| 严格IPC/preload | 17项通过；两项审查缺陷已修复，迟到取消错误修复后真实组件覆盖。 |
| Electron隔离适配器 | 18项通过，合成HTTPS协议响应；不是公网/TLS/真实站点验收。见n5-isolation-evidence。归档脚本需要在同目录以esbuild编译main/online-tools.ts为adapter.cjs后才能运行；临时目录含原bundle。 |
| 真实React组件窗口 | 19项通过，合成bridge；切实例/取消/旧回执/宽窄布局与截图，见extension-ui-evidence。 |
| 正式main/preload接线窗口 | **14项通过，Electron45 exit0**；真实IPC返回空注册表/空来源、未知工具和任意URL被拒、来源缺失不能扫描、关闭有效、宽窄无横向溢出。仅官方catalog在原生网络边界替换为明确合成响应，不连接外网；不是游戏/EXE验收。见main-smoke-evidence。 |

N5真实容器最初未初始化renderer target导致CDP超时，已经以主进程固定about:blank初始化修复并实际复验。该固定初始化不允许外部导航about:blank。IPC的数组冒充枚举与source端口原始异常外泄已修；DistributionPanel旧cancel回执覆盖新请求已修，真实组件场景通过。

## 暂停点与恢复顺序

保存时codex primary 300分钟窗口已用94%、剩余6%，触及用户保留的<=10%停止线。停止新增实现，保存现有源码、证据与本地提交；不使用重置券、不购买、不建立重复监测。恢复须先实际检查额度刷新，不承诺无人确认自动恢复。

1. 读取TASK_PLAN/DECISIONS、本页与Git状态，先核实本地保存提交和最终type/lint状态。
2. 保持用户明确留空的真实站点、来源、公钥；配置未提供时不访问第三方、不开分发执行。
3. N6完整安装/更新/删除仍未实现；真实执行需要独立包事务/收据提交点、防重放/降级、确认和恢复设计及测试。现有只读预览、测试签名和普通add-only Mod事务不能冒充这些能力。用户持续执行授权允许继续细化实现，但不能假造缺失的真实信任材料。
4. 新UI候选EXE尚未打包/游戏验收；正式OUCL-0.3.0.exe没有替换。包任务若继续，使用独立候选标签和冻结本轮七产物；不覆盖旧版本、不push/发布。

本轮并未声称技术文档所有任务全部完成；N1—N4已提交，N5/N6基础设施与只读首片已实现，真实配置与N6执行/恢复仍有上述缺项。
