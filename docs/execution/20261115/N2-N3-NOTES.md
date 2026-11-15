# N2 / N3 独立组件交付

日期：2026-11-15（Asia/Shanghai）。此记录只说明组件候选和局部验证，不表示 N1 已接纳或全部功能已集成。依据本轮用户“读取交接并执行，允许创建子对话分工”的真实授权，保留既有 IPC、存储格式、安全与依赖。

## 文件与接线

- `src/ui/first-run.ts`：纯投影。未读到 settings 时不判断已配置或新用户；只有当前根已选择、当前账号存在且 ready，才允许确认准备。Java 登记只用于提示，未登记可在真实启动时按现有服务准备，不作为 Java 验证成功。
- `src/ui/FirstRunGuide.tsx`：会话内可跳过、重新打开、重试的引导。没有写业务 API，也不保存“看过引导”标记。props 为 settings/rootId/accounts/accountId/enabled/onOpenSettings/onOpenAccounts/onRetry；回调仅导航原入口和刷新已有投影。建议首页直接放置，保持导航时组件实例以保留本会话跳过状态。
- `src/ui/AppearanceSettings.tsx`：维持原有 desktop.v1。加载、保存和原生图标选择期间通过 fieldset 禁用编辑；保存只对待保存预览开放；恢复默认仍是预览，需明确保存；取消恢复当前持久快照并清除旧成功提示。图标选择异常映射受控文案，返回图标合并最新投影，避免覆写等待期间完成的侧栏设置。Escape 仅在外观面板本身获得焦点时撤销，不截获内部输入或原生选择器键盘。
- `tests/first-run.test.ts`：5 个独立规则测试。

主协调拥有 App、文案和 CSS。建议 `.appearance-controls { border: 0; margin: 0; padding: 0; min-width: 0; }`，引导步骤在窄窗口折行；普通 button/select/input 保留原生键盘操作。首次引导缺少读取结果时仅显示加载提示、跳过和重试，不自动打开设置或初始化偏好。

文案键已发给主协调：firstRunTitle、firstRunHint、firstRunLoading、firstRunRootSelected、firstRunRootMissing、firstRunAccountSelected、firstRunAccountMissing、firstRunJavaRegistered、firstRunJavaAutomatic、firstRunOpenSettings、firstRunOpenAccounts、firstRunRetry、firstRunSkip、firstRunContinue、firstRunReopen。

## 实际验证

独占工作目录 `D:/MC_start/OUCL/tmp/execution-onboarding-20261115`，使用已有 esbuild，不安装依赖、替换 dist 或共享 .test-build。

| 检查 | 结果 | 限定 |
| --- | --- | --- |
| first-run 规则测试 | 5 PASS / 0 FAIL | 未读设置、现有选择不变、Java 自动准备可选、失效账号、存储根偏好不冒充当前根 |
| 组件受控 hook 夹具 | 12 断言 PASS | 忙碌禁用、保存/默认/撤销、面板与子控件 Escape 边界、picker 异常、引导跳过/重新打开/重试；不是真浏览器或 IPC |
| 专注 ESLint | exit0 | FirstRunGuide、first-run、AppearanceSettings、first-run.test 四文件 |
| 完整 typecheck / 回归 / build | 由主协调执行 | 本子任务未运行或代报结果 |
| 真实 GUI / 窄窗口 / 键盘 | 尚未运行 | 主协调集成后验证；不得将受控夹具等同浏览器验收 |

复现：

```powershell
node --input-type=module -e "import {build} from 'esbuild'; await build({entryPoints:['tests/first-run.test.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outfile:'D:/MC_start/OUCL/tmp/execution-onboarding-20261115/first-run.test.mjs'});"
node --test D:/MC_start/OUCL/tmp/execution-onboarding-20261115/first-run.test.mjs
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js src/ui/FirstRunGuide.tsx src/ui/first-run.ts src/ui/AppearanceSettings.tsx tests/first-run.test.ts
node D:/MC_start/OUCL/tmp/execution-onboarding-20261115/component-check.mjs
```

受控夹具第一次以 Windows 裸绝对路径 ESM import 启动失败，修正为 file URL 后 12 断言通过；未修改产品断言或跳过失败。临时脚本不属于正式测试脚本，也不以其硬编码验证路径进入产品。

## 保留项

已有 `RootSettings` 的 mount 读列表后会选首个 available 根，未在本组件改动；当前 App 本来就常驻挂载 SettingsPage。引导自身不重复挂载 RootSettings 或自动写入选择。本轮若要求进一步修复该既有根选择行为，应由主协调在拥有文件中独立验证，不把当前引导 UI 误报成迁移或根管理重构。

未做公开有效 Java 面板、认证、任意磁盘扫描、数据迁移、Webstudio 替换、依赖增补或存储格式扩展；不改写历史验收失败。

## 组件检查后续固化

主协调新增 FirstRunGuide.error 受控消息后，将临时夹具固化为 `scripts/ui-preparation-check.mjs`。脚本以当前工作目录为源码根，使用已有 esbuild，在 `OUCL_TEST_ROOT` 下独占 mkdtemp 输出；未设环境变量时使用当前工作目录的 tmp/ui-preparation-check。没有机器路径、新依赖或产品组件变更。

运行 `node scripts/ui-preparation-check.mjs` 实际 18 断言通过（原12断言保留，另验证旧错误显示、错误不冒充加载、成功重试清错、重试抛错受控展示/释放busy/可再重试）。结果见 [preparation-components.log](evidence/preparation-components.log)。这是精简 hook/JSX 处理器夹具，不模拟 React effects、DOM/原生禁用继承、真实浏览器或 IPC。

新夹具首次第15项失败是替换 props.onRetry 后使用了前次 render 的闭包；保留 [首轮日志](evidence/preparation-components-first-attempt.log)，仅修正夹具在 props 变化后重新 render，未弱化18个断言或改产品。专项 ESLint 及全仓 `src tests scripts vite.config.ts` ESLint 均 exit0。
