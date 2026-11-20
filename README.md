# OUCL 0.3.0

Minecraft Java版桌面启动器。本地最终交付见[交付说明](docs/delivery/20261115/DELIVERY.md)，文件目录见[项目目录索引](docs/PROJECT_LAYOUT.md)，提交历史见[提交整合索引](docs/delivery/20261115/COMMITS.md)。

开发检出的新增功能与配置见[四系统说明](docs/FEATURE_CENTERS.md)。

当前已接纳范围包括原版/Fabric/Quilt、Java与离线档案、实例隔离、可信下载/资源库、任务观察、Mod只读影响预览及固定整合包样本只读预览。固定样本入口不代表通用整合包导入安装。功能和已知限制以批准记录及最新交付说明为准。

## 使用

运行交付目录EXE/OUCL-0.3.0.exe。首次启动需联网准备并校验Electron运行时；Minecraft和Java按需另行准备。保留EXE旁生成的OUCL.runtime/OUCL.games。本地文件未签名、未发布。

## 开发

先读[任务计划](OUCL-Codex/docs/TASK_PLAN.md)、[真实批准](OUCL-Codex/docs/DECISIONS.md)、[协作规则](AGENTS.md)，再读[开发流程](OUCL-Codex/docs/DEVELOPMENT.md)。Node24.21+（24.x）、固定pnpm12.3.4：

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm start
pnpm package:exe
```

## 资料导航

- 工程契约：docs/contracts
- 版本化验收：[索引](docs/acceptance/README.md)
- 本地交付及完整提交记录：docs/delivery/20261115
- 原始需求/决策/计划：OUCL-Codex/docs
- 历史README与全部改动保留在Git历史，不复制平行计划。
