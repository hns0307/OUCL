# OUCL

面向高校社团的 Minecraft Java 版桌面启动器项目。当前为**阶段1A原版下载与启动闭环开发**，已获用户明确批准持续实施。A1-01纯版本解析已交付；下载及实际启动仍未完成。现有Electron + React界面/便携目录仍为空骨架，不将其当成可用MC启动器。阶段0技术缺项与后续支持声明按实测保留。

## 开始工作

每次开发首先读取 [任务计划与阶段验收表](OUCL-Codex/docs/TASK_PLAN.md)，核对 [批准及待决记录](OUCL-Codex/docs/DECISIONS.md)，只执行当前获批阶段内的具体增量。接着阅读根级 [AGENTS.md](AGENTS.md) 和 [开发规范与交付流程](OUCL-Codex/docs/DEVELOPMENT.md)。

## 安装、检查与运行

使用Node 24.21+（24.x）与固定pnpm 12.3.4：

```powershell
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm check
pnpm start
```

本地风险实验：`pnpm test:spikes`；空窗口验收：`pnpm smoke`；依赖检查：`pnpm audit --audit-level=high`、`pnpm audit:licenses`。受限工具环境可能阻止临时文件rename/junction或网络，实际结果与解决方式见报告，不关闭应用sandbox来让测试通过。

`pnpm package:dir`生成新的`release/OUCL-0.0.0-win32-x64/OUCL.exe`便携目录，已存在同名目录则拒绝覆盖。`pnpm smoke:package`验证真实包默认入口。它是未签名工程预览，无安装器及游戏功能。

证据：[骨架验证报告](docs/validation/P0-08/REPORT.md)、[工程ADR](docs/adr/ADR-003-engineering-baseline.md)、[阶段0实验报告](spikes/phase0-local/REPORT.md)、[依赖评估](docs/DEPENDENCIES.md)。

## 项目资料

完整导航见 [资料包说明](OUCL-Codex/README.md)。设计入口为 [阶段0提案](OUCL-Codex/docs/PROPOSAL_PHASE0.md)，存储细节见 [共享目录方案](OUCL-Codex/docs/STORAGE_LAYOUT.md)，审查理由见 [设计审查](OUCL-Codex/docs/DESIGN_REVIEW.md)。推荐方向已批准，历史草案与旧PENDING保留追溯；最新授权以DECISIONS末尾为准，未验证能力仍保持候选。

现有资料保留在`OUCL-Codex/`，根`docs/`维护工程ADR、契约和验证证据；spikes不被src引用。原始文本与压缩包保留，不解压覆盖资料。
