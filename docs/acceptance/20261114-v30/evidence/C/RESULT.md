# C-01 / C-02 隔离候选结果

2026-11-14；结论：两项在隔离组件夹具中先复现后修复，供统一协调独立复核，未整合产品。候选 `D:/MC_start/OUCL-review-round-20261114/P-C/verification/c01-c02/`，基线 `D:/MC_start/OUCL-download-main` HEAD `262d757ecad08add5a0db16817b2adab01b98149`，产品 `fab0ac8`。原源码逐文件 SHA256 在 `SOURCE-SHA256.txt`；产品差异与完整补丁在 `PATCH.md`。仅以下产品文件不同：

| 文件 | 原始 SHA256 | 候选 SHA256 |
| --- | --- | --- |
| src/ui/MaintenancePreviewPanel.tsx | 51d7ab709a553aa5ace77ac7033c13aa08f638b0cf2292f388544d5c88b7fd8b | 1361ad25a2c1366147dd6e2d92cc989137710c468bb8c2db9d8bc7f979df2fcb |
| src/shared/locales/messages.ts | 8ba6a21ad4da2754cb20406be0db2f62210b280cbfcdd4ead12de5709cc2884f | fe0f7da08e56c6101f476832bb11fca8e7a6598fe3fb094d6573b949580812e2 |

变更：问题行分别带标签显示声明模组、依赖模组、平台项目和固定版本；无 ID 时保留 code 回退。取消后状态查询成功、结果身份匹配且状态为终态时清除旧观察错误；失败或身份不匹配不清为成功。未改 provider 深度、DTO、IPC、主进程、持久格式、依赖或文件动作。

## 验证与复现

所有命令从候选根运行，Node/esbuild/eslint/TypeScript 只读复用稳定 main 的工具链；未安装依赖。命令及物证：

1. 原始产品源码运行 `node --test tests/component-harness.cjs`：4 项场景各自失败，见 `baseline-failure.log`；分别为两个不同缺失 ID、平台固定版本和已取消后的旧超时 alert。夹具运行实际面板组件，hooks/bridge 为确定性替身，不是 Electron GUI 或真实网络。
2. 修复后运行同一命令：9 项通过，`verification.log`；覆盖带标签字段、成功取消终态清错、取消/状态失败及跨实例身份不符仍有 alert、完成先赢、接纳超时同 requestId 重试。修复后首次多加重试测试时，错误地假定可覆盖 Node 内置 crypto，导致断言期望值错误；`verification-first.log` 保留该夹具失败。现改为直接断言两次收到同一非空 ID，未修改产品以通过测试。为迁移夹具，测试使用 `require('esbuild')`，可用 `NODE_PATH` 指向既有工具链的 node_modules；`OUCL_SOURCE_ROOT` 指向待测源码根，`OUCL_TEST_ROOT` 指向输出目录，未设时均默认为夹具上级目录。三文件 `tests/component-harness.cjs`、`tests/react-stub.cjs`、`tests/jsx-stub.cjs` 需一起复制。以这三个环境变量指定既有工具链、候选源码和独立输出后再次运行 `node --test tests/component-harness.cjs`：9/9，退出码 0，见 `portable-component-final.log`。
3. 既有静态 React 组件夹具从 `docs/work-packages/P-C/ui-render.test.ts` 复制，只调整相对 import 到候选；通过 esbuild 打包后 `node --test tests/baseline-ui-render.test.cjs`，1 项通过，见 `existing-component-test.log`。这仅证明初始静态呈现。
4. `node D:/MC_start/OUCL-download-main/node_modules/typescript/bin/tsc --noEmit -p tsconfig.candidate.json`：面板及其传递类型依赖的局部 strict 类型检查通过，重跑并明确记录退出码 0 于 `local-typecheck-final.log`；该配置通过绝对路径只读解析现有类型。此前 `typecheck.log` 实际保留了全 src 模块解析失败输出，不能作为局部通过证据；`typecheck-first.log` 和 `typecheck-full-attempt.log` 也保留前次失败。候选不具 node_modules、稳定工具链缺少顶层 smol-toml 等条件，不能称全项目类型检查通过。
5. `node D:/MC_start/OUCL-download-main/node_modules/eslint/bin/eslint.js --config D:/MC_start/OUCL-download-main/eslint.config.mjs src/ui/MaintenancePreviewPanel.tsx src/shared/locales/messages.ts`：通过，`lint.log` 为空。
6. 设置 `NODE_PATH=D:\MC_start\OUCL-download-main\node_modules`，运行 `node D:/MC_start/OUCL-download-main/node_modules/esbuild/bin/esbuild src/ui/MaintenancePreviewPanel.tsx --bundle --platform=browser --format=esm --outfile=component-browser.js`：通过，见 `build.log`。这是局部浏览器打包，不是完整产品构建。
7. 既有静态夹具打包命令：设置上述 NODE_PATH 后 `node D:/MC_start/OUCL-download-main/node_modules/esbuild/bin/esbuild tests/baseline-ui-render.test.ts --bundle --platform=node --format=cjs --target=node24 --outfile=tests/baseline-ui-render.test.cjs`。

未运行 GUI、实际取消/网络、全量测试或完整构建；没有用新夹具替换 v26 真实窗口证据。组件 hooks 替身不能证明真实 React 调度的全部时序。建议协调方检查补丁后使用其控制的产品窗口验证标签与取消终态展示；不对未覆盖竞态作通过结论。原仓库、Git、玩家文件和已有证据未修改。

