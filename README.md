# OUCL

面向高校社团的 Minecraft Java 版桌面启动器。0.1.0已完成用户实测的原版离线下载与启动；0.2.0提供首页、下载、公告、设置四页，左侧真实实例列表、右侧离线人物档案，以及Modrinth的Mod、材质包和光影资源库下载。资源仅下载和校验，不自动安装加载器或修改实例；公告暂为UI。内存和新实例隔离默认值可保存并实际生效。

## 开始工作

每次开发首先读取 [任务计划与阶段验收表](OUCL-Codex/docs/TASK_PLAN.md)，核对 [批准及待决记录](OUCL-Codex/docs/DECISIONS.md)，只执行当前获批阶段内的具体增量。接着阅读根级 [AGENTS.md](AGENTS.md) 和 [开发规范与交付流程](OUCL-Codex/docs/DEVELOPMENT.md)。

下一对话的工作快照见 [agent.md](agent.md)，它不替代首读任务计划或批准记录。

## 安装、检查与运行

使用Node 24.21+（24.x）与固定pnpm 12.3.4：

```powershell
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm check
pnpm start
```

本地风险实验：`pnpm test:spikes`；当前源码窗口验收：`pnpm smoke`；正式worker验证：`pnpm test:workers-runtime`；依赖检查：`pnpm audit --audit-level=high`、`pnpm audit:licenses`。受限工具环境可能阻止临时文件rename/junction或网络，实际结果与解决方式见报告，不关闭应用sandbox来让测试通过。

`pnpm test`后可运行`node scripts/verify-download.mjs`验证真实官方客户端下载、取消/重开续传和对象复用；它使用临时目录并清理，不启动游戏。证据见[A1-05传输报告](docs/validation/A1-05-transfer/REPORT.md)。

`pnpm package:dir`生成新的`release/OUCL-0.2.0-win32-x64/OUCL.exe`便携目录，已存在同名目录则拒绝覆盖。运行需保留整个目录；`pnpm smoke:package`验证真实包默认入口。包未签名，不含安装器、Java或Minecraft本体。

使用顺序：设置页选择游戏目录和适配的Java → 首页新建离线档案 → 下载页安装Minecraft → 左侧选择实例，在右侧启动。Mod等资源可在下载页搜索、选择版本和文件，下载后在资源库查看。

执行`pnpm test`后，可运行`node scripts/verify-resources.mjs`验证三类真实资源及重开保持；`node scripts/verify-resource-ui.mjs`从独立Electron界面提交下载并验证切页后继续。两者只使用新的`.test-build`目录。验证报告见[0.2.0记录](docs/validation/UI-0.2.0/REPORT.md)，契约见[设置](docs/SETTINGS.md)和[资源库](docs/RESOURCES.md)。

证据：[骨架验证报告](docs/validation/P0-08/REPORT.md)、[工程ADR](docs/adr/ADR-003-engineering-baseline.md)、[阶段0实验报告](spikes/phase0-local/REPORT.md)、[依赖评估](docs/DEPENDENCIES.md)。

## 项目资料

完整导航见 [资料包说明](OUCL-Codex/README.md)。设计入口为 [阶段0提案](OUCL-Codex/docs/PROPOSAL_PHASE0.md)，存储细节见 [共享目录方案](OUCL-Codex/docs/STORAGE_LAYOUT.md)，审查理由见 [设计审查](OUCL-Codex/docs/DESIGN_REVIEW.md)。推荐方向已批准，历史草案与旧PENDING保留追溯；最新授权以DECISIONS末尾为准，未验证能力仍保持候选。

现有资料保留在`OUCL-Codex/`，根`docs/`维护工程ADR、契约和验证证据；spikes不被src引用。原始文本与压缩包保留，不解压覆盖资料。
