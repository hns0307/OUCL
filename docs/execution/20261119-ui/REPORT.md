# N1–N4 Electron 界面补验

2026-11-19 · Windows x64 · Electron 45 · 产品源码基线 `cad6fbec`。测试只使用独立应用资料和受控网络响应。

| 范围 | 实际结果 | 记录 |
| --- | --- | --- |
| N1 实例概览 | 在实际 Electron 组件窗口切换实例，第二实例显示自己的执行中任务，迟到的旧实例回执未覆盖它。主动刷新失败时，任务连接显示不可用，游戏会话仍显示运行中。任务中心按钮调用了夹具回调。 | [组件结果](evidence/ui-check.json) · [窄窗截图](evidence/ui-narrow.png) |
| N2 首次启动引导 | 产品窗口验证首次引导显示、跳过、重开和进入设置。组件窗口另验证重新检查调用回调。已有目录、离线档案、读取失败与重试见[首次引导专项](first-run/REPORT.md)。 | [产品首轮](evidence/pass-1.json) |
| N3 外观 | 产品窗口验证调色、图标读取、布局调整、保存和重启回读。恢复默认只预览，焦点在外观面板时按 Escape 恢复已保存颜色。图标选择对话框由夹具提供文件路径，文件读取和图标重编码走产品代码。 | [设置截图](evidence/settings.png) · [产品重启](evidence/pass-2.json) |
| N4 渐变文字 | 产品工具箱接收含组合表情的文字，输出按三个字素分组的 JSON，并可选中全部输出。组件窗口另验证改变两端颜色后的 JSON。 | [工具箱截图](evidence/toolbox.png) |

组件窗口共 13 项通过，包括 1100 和 480 CSS 像素下的横向溢出检测。产品窗口两次进程均正常退出，首轮 16 项、重启 2 项通过。720 像素窗口下五个顶层页面均无文档横向溢出。主进程、预加载与界面使用常规产品构建；N1 的实例切换、会话和任务回执来自独立组件窗口的合成数据。此轮未验证实际游戏进程、账号选择恢复、系统文件对话框交互或系统剪贴板。

第一次在受限环境下启动组件窗口时，Electron 在加载界面前退出。恢复本机执行权限后，旧脚本的 10 项通过。新增测试的第一次执行因测试代码中的选择器转义出错，修改后 13 项通过。[加载前退出记录](evidence/component-restricted-start.json) · [选择器错误记录](evidence/component-selector-attempt.json)

## 复现

在仓库根执行以下命令。使用独立输出目录保留历史证据，运行 Electron 所需的本机权限与本轮相同。

```powershell
$env:OUCL_TEST_ROOT = Join-Path $PWD '.test-build/execution-ui-20261119-final'
node scripts/ui-execution-check.mjs

$env:OUCL_BUILD_ROOT = Join-Path $PWD '.test-build/execution-ui-product-20261119/dist'
$env:OUCL_VALIDATION_DIR = Join-Path $PWD '.test-build/execution-ui-product-20261119/evidence'
node scripts/build.mjs
node scripts/interaction-smoke.mjs
```

## 仓库回归

类型检查、完整 ESLint 和独立产品构建均以 0 退出。受控回归使用仓库现有的 `docs/execution/20261118-q/test-limited.mjs`，开启 4 路测试并使用独立临时目录；1008 项中 1004 通过、0 失败、4 项原有跳过。原有跳过条件保持。见[回归摘要](evidence/regression-summary.txt)。
