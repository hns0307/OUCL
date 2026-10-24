# P0-08 空工程骨架验证报告

日期2026-10-24。执行人Codex；用户验收待记录。授权为默认方案、阶段0验证、空工程骨架及最小依赖评估安装。该范围内已完成实际工程交付，不代表启动器全部功能或阶段0整体完成。

## 已交付

- 根级单应用目录、严格TypeScript、Vite renderer与esbuild main/preload构建；React空首页及Zustand连接状态，无游戏业务。
- 唯一`app:handshake`严格契约，sender/主frame/完整URL校验，3秒超时及响应校验；preload不暴露通用invoke、路径或Node能力。
- Electron安全窗口、权限拒绝、导航/新窗口/webview禁用、无外网renderer CSP。
- 固定依赖与锁文件、分层lint、6项契约测试、Node实验与Windows CI配置。
- 未签名Windows x64便携目录，保留Electron/Chromium声明，并归档React/react-dom/scheduler/Zustand许可证；无安装器、更新或发布动作。

## 实际检查

| 命令 / 证据 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 退出0，固定锁文件复装成功 |
| `pnpm check` | typecheck、lint、6项契约测试、构建均退出0；[check.log](check.log) |
| `pnpm test:spikes` | 17 PASS / 0 FAIL / 1 SKIP；[实验报告](../../../spikes/phase0-local/REPORT.md) |
| `node spikes/phase0-local/live-trust.mjs` | 官方4级HTTP响应校验通过；实验JSON留证 |
| `pnpm smoke` | 实际Electron45窗口PASS，Node24.22；[smoke.json](smoke.json)、[window.png](window.png) |
| `pnpm audit --json` | 审计返回各严重程度0个已知漏洞；[audit.json](audit.json)，不等于无漏洞保证或Chromium全面审计 |
| `pnpm audit:licenses` | 扫描127个本机实际安装包，未决许可0；[licenses.json](licenses.json) |
| `pnpm package:dir` | 生成`release/OUCL-0.0.0-win32-x64/OUCL.exe`；[package.json](package.json) |
| `pnpm smoke:package` | 按便携exe默认入口启动、连接包内renderer及preload，Node不暴露，main载荷摘要一致；[package-smoke.json](package-smoke.json)、[package-window.png](package-window.png) |

实际安装的node_modules/.pnpm常规文件总长度485002433字节（约463MiB），包含Electron平台二进制；硬链接文件逻辑长度合计，不是物理盘占用或最终压缩包体积。审计包含平台可选图，而许可扫描仅本机已安装实体包，二者数量口径不同。MPL-2.0构建依赖的两个固定包已单独审查，见[依赖评估](../../DEPENDENCIES.md)；正式发布前仍需对实际载荷复核。

## 窗口与打包验收范围

开发空窗口实测contextIsolation=true、sandbox=true、nodeIntegration=false；页面中require/process均不存在；桥接仅handshake，返回capabilities空数组；window.open未创建窗口。截图已人工查看，文字、布局、空状态正常。测试使用软件渲染以避免当前图形后端的capturePage错误；没有据此宣称GPU/所有Windows机器兼容。

便携版按默认入口运行，而非让开发测试入口替代包入口。测试只在启动参数开启临时127.0.0.1调试端口，通过Node内置WebSocket读取真实页面、执行只读验收及截图；结束终止自己创建的测试进程并清理临时配置。正常`pnpm start`与双击便携exe均不启用该端口。测试依据[CDP Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)、[CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/)。

## 纠错与限制

工具核验发现TypeScript7不在typescript-eslint支持范围，固定为6.0.3；pnpm12使用allowBuilds，不沿用旧onlyBuiltDependencies；Electron45需显式install-electron，CI已同步。首轮lint对CJS入口规则不匹配、运行环境继承ELECTRON_RUN_AS_NODE、截图图形后端错误、打包许可解析经pnpm链接找不到scheduler、包入口忽略开发测试参数、首次导航导致调试上下文销毁，均在本轮修复并复验。最终报告只使用通过后的结果，不将早期失败说成首次即通过。

源码UI为渲染bundle，core/services仍空；未实现下载、Java、账户、实例或游戏启动。业务core首个增量需建立85%行/分支目标，目前没有core业务覆盖数据。CI仅配置，尚未提交/推送，未发生远端CI运行。便携目录为本机未签名工程预览，不是安装器或正式发布产物。

S-09文件软链接权限、S-08旧版实机、完整系统矩阵、断电/磁盘耗尽、并发锁/TOCTOU、真实凭证/联机/发布条件仍有缺项；P0-07整体技术验收保留未完成，不以骨架检查代替所有证据。最小后续工作仍在阶段0补齐适用本地验证或处置缺项，业务按另行指定的增量授权。
