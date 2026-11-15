# N1–N4 独立审查

日期：2026-11-15（Asia/Shanghai）。范围：main `05309ed7` 后本轮 UI/纯规则增量。审查者只写本报告，不修改产品。本页已包含最终 App/导航/CSS/取消控制接线复核。

## 已发现问题与处理

| 编号 | 级别 | 事实与影响 | 状态 |
| --- | --- | --- | --- |
| R-01 | P2 | 初版 `useGameSessions` 在列表返回失败或抛异常时清空同 root 已知会话，会把观察失败显示为未观察到会话，并可能重启用启动按钮。 | 主协调已改为只接纳成功列表，失败保留最后可信会话；rootId 仍隔离。独立 hook 夹具实际执行成功 running→UNAVAILABLE，结果仍返回 running，exit0。已闭合。 |
| R-02 | P2 | App 新增 `state.error` 展示，但 `refreshProfiles` / `refreshSettings` 成功分支不清错误。首次失败后即使引导重新检查成功，首页仍保留旧错误；并发成功分支简单清空又可能覆盖另一读取的真实失败。 | 主协调已在真实 App.onRetry 开始时仅清旧错误一次，两个并发读取仍保留本轮失败；独立组件夹具3断言实际通过。已闭合。 |

另核对现有 `InstallTask` 在 committing/cancelling 状态显示禁用取消按钮；建议本次按实际可取消状态保守显示，收尾不提供可点击取消。既有 `RootSettings` 的重读入口仍在设置页，引导重试不自动替换根或做迁移。

## 已核对边界

- `InstanceOverviewReader` 只调用既有 task-targets.v1，20条有界读取、明确分页范围；不把全局任务按猜测绑定实例。identity、active 及 reader.close/generation 保护迟到结果。
- `overviewTaskRows` 仅允许已有证明归属的任务以更高修订更新；连接失败不制造失败执行态。
- `InstanceFolders` 由 App 的 root/instance key 挂载隔离，异步反馈有存活检查；仍只传固定目录枚举。
- 引导仅投影已有 root/account/javaId，未读取设置时不宣称全新用户，无写业务 API、迁移、扫描或认证。
- 外观沿 desktop.v1，默认只预览，取消清预览；编辑在加载/保存/picker期间禁用，picker完成合并当前投影。未新增持久格式。
- 渐变规则位于 shared 纯模块，Unicode字素有界，颜色严格六位，JSON.stringify 编码，React仅文本渲染。工具不执行脚本、不访问文件、网络或剪贴板权限。

## 独立运行

通过已安装 esbuild 在独占 `D:/MC_start/OUCL/tmp/execution-review-20261115/tests` bundle 三个专注文件后运行 Node 内置测试：`instance-overview.test.ts`、`first-run.test.ts`、`gradient-text.test.ts`，实际 **17 PASS / 0 FAIL / 0 SKIP**，exit0。未运行共享全量回归或改写 dist。

会话 hook 夹具通过 esbuild 注入最小 React hooks、固定成功/失败 listSessions，验证的是受控组件逻辑，不是 Electron 公网/GUI或实际游戏验收。未恢复强杀、取消补证或其他用户已取消测试。

## 保留验证范围

17项纯规则/控制器测试不等同完整 GUI 布局、键盘、原生picker及游戏验证。历史25 FAIL必须继续由基线报告分别解释，不能由本次审查改为通过；新正式 EXE 未在本审查生成或验收。

## 最终接线复核

- App 按 root/instance 给概览、目录反馈和启动控制挂载 key；引导使用现有账户区的可聚焦入口、设置导航和只读重试，不重复创建根或账户控件。
- App 的固定 tools 页面已接 Toolbox；Page 联合类型补 tools，没有通用脚本加载或高权限嵌入网页。
- `task-controls.ts` 将取消限制为 confirmed 观察且 queued/running/verifying/pausing/paused；committing/cancelling/failing及终态无取消控件。`InstallTask.cancel` 额外捕获异常为受控错误，不把断线当执行终态。服务端仍是最终取消许可。
- 新增 CSS 对概览长身份/任务ID断行，工具输出宽度受容器约束，引导窄窗按钮换行，appearance fieldset清原生边框；这是源码核对，未冒充真实布局测量。

最终新增 `task-controls.test.ts` 独立运行 **2 PASS / 0 FAIL**，与前述17项合计 **19项专注测试通过**。不以合计代替全套回归。

独立 `component-review.mjs`（临时位置 `D:/MC_start/OUCL/tmp/execution-review-20261115/component-review.mjs`）直接 bundle 当前 App/useLauncher/InstanceFolders，注入最小 React hooks/JSX替身，实际通过5断言：

1. 旧 `unavailable` 错误在真实 App 重试全成功后消失。
2. profiles读取失败、settings成功仍保留 `permissionDenied`。
3. settings读取失败、profiles成功仍保留 `rootUnavailable`。
4. A目录请求在卸载后晚回失败，不改变新挂载B的error。
5. 同一迟到回执不改变B的busy。

脚本首轮因 Windows 裸盘符 ESM import 路径失败；修正 file URL 后又因 hook替身缺 default export 构建失败；补齐替身后上述5断言全部通过，均为夹具修正、未改产品断言。未运行真实 Electron GUI/网络/游戏，不把受控夹具说成用户窗口验收。

结论：本轮两项具体审查问题均已闭合；最终 N1–N4 接线范围未发现剩余阻断性缺陷。受控逻辑检查不取代主协调的完整类型/lint/build、基线失败解释或产品视觉/交互验证。
