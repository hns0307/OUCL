# N4 渐变文字独立模块

日期：2026-11-15（Asia/Shanghai）。本模块按本次执行交接的 N4 范围准备，正式导航由协调者在 N1→N2→N3 后按顺序接线；本笔记不宣称已完成整体验收或交付新 EXE。

## 实现

- `src/shared/tools/gradient.ts`：无 IO 的纯计算。渲染层仅允许 shared 依赖，故规则实际在 shared，不添加无意义 core 转发层、不放宽 lint、不新增 IPC。
- `src/ui/Toolbox.tsx`：固定本地工具注册表、受控输入、两个颜色选择器、逐字素预览、JSON 文本组件输出及选择输出按钮；`Toolbox()` 不需要 props。
- `tests/gradient-text.test.ts`：端点/中点/单字符、中文、ZWJ 家庭表情/肤色/组合符、JSON 转义、长度与非法输入边界。

输出使用 Java 1.16+ JSON 文本组件（`{text:'', extra:[{text,color}, …]}` 的 JSON 序列化），适用于支持该格式的命令或配置，不声称普通聊天直接解析。用户文本始终是 React 文本节点，JSON 经 `JSON.stringify` 编码，不使用 HTML 注入。无文件、网络、剪贴板权限、持久状态、新依赖或插件脚本执行。

Unicode `Intl.Segmenter` 按字素分色，最多 256 字素且最多 4096 UTF-16 码元以限制长组合序列；单字使用起始颜色，两个端点精确匹配。仅接受六位 `#RRGGBB`，拒绝不支持的控制字符，保留换行和制表符。无静默截断到 256 字符，超限在界面提示并清空输出。

## 接线

协调者负责 `App.tsx`/导航及共享 messages；可选样式类：`toolbox-panel`、`toolbox-colors`、`toolbox-preview`、`toolbox-output`。组件现有基础 `.panel`、`.section-heading`、`.tag`、`.muted`、`.small`、`.secondary` 复用现有设计。

共享文案键已与协调者同步：`uiToolbox`、`toolboxTitle`、`toolboxHint`、`toolboxText`、`toolboxStart`、`toolboxEnd`、`toolboxPreview`、`toolboxOutput`、`toolboxSelect`、`toolboxFormatHint`、`toolboxLimit`、`toolboxEmpty`、`toolboxTooLong`、`toolboxInvalidColor`、`toolboxInvalidText`。

## 已运行验证

在 main 工作树，使用现有固定依赖，不经 pnpm 修复依赖。独占编译根 `D:/MC_start/OUCL/tmp/execution-toolbox-20261115`。

1. esbuild 将 `tests/gradient-text.test.ts` 独立 bundle 为 Node24 ESM，写独占根 `gradient-text.test.js`；`node --test`：4 PASS / 0 FAIL / 0 SKIP，exit0。
2. `node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js src/shared/tools/gradient.ts src/ui/Toolbox.tsx tests/gradient-text.test.ts`：exit0。首轮因 `no-control-regex` 失败，已改用码点数值检测后复跑通过，未放宽规则。
3. `node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit`：exit0（含协调者同步的文案）。

尚未运行 GUI 键盘/视觉验证，未替换共享 dist、未改正式 EXE。工具只选择输出文本，用户使用系统复制快捷键即可，无额外剪贴板权限。

## 后续有界 UI 夹具验证

新增 `scripts/ui-execution-fixture.tsx` 与 `scripts/ui-execution-check.mjs`：esbuild 打包真实 Toolbox/FirstRunGuide/InstanceOverview，独立 hidden BrowserWindow 加载本地 HTML；实例/会话/任务 DTO 与只读 bridge 全为明确合成夹具。测试准备编辑颜色/文字、选择 JSON、引导跳过/重开/重试、实例公开事实/任务回调及 1100/480 像素无横向溢出与截图。保持 sandbox、contextIsolation、nodeIntegration:false、无 preload、拒绝网络/权限/新窗口，不启动生产 main 或使用玩家目录。

实际两次有界启动在 app-ready/结果文件前退出：首次 exit1；补充独占 profile 目录与关闭硬件加速后 exit2147483651（0x80000003）。均无 stderr，不能据此确定具体 Windows/Electron 根因。未再启动或放宽沙箱。结果 `evidence/ui-check.json` 为 **NOT_RUN**，无 DOM 断言通过、无宽窄截图，不构成 GUI 或视觉验收。

脚本与 fixture 局部 ESLint exit0；esbuild fixture 编译完成；为 fixture 建立独占临时 tsconfig（extends 项目配置并显式 include fixture 与 `src/**/*.d.ts`）运行 `tsc --noEmit` exit0。首轮缺项目全局声明产生类型错误，补全 include 后复跑；未放宽类型规则。测试文件固定在独占 `tmp/execution-ui`，无共享 dist/.test-build 覆盖。
