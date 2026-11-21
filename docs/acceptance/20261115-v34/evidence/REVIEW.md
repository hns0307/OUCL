# v31–v33 有界只读收尾审查（2026-11-15）

审查范围：稳定 main `7eca4143fcdcc4e291cb4f24af23e36a6e7b6b60`、产品提交 `0c2a889ccea544d3294136a80c74ac8a5e6f348f`；工作树只读检查时干净。五小时额度先查已用25%。本报告是分项证据判断，最终取舍由统一管理决定；不宣布整体通过。未运行测试、构建、网络、GUI或SQL服务。

## 可供接纳的选定范围

- **A 必要基础与隔离**：对象租约 A01 真实服务子进程异常退出及受控边界、A02 初始化清理与重试回归；不是最终 EXE 强杀恢复。新包的独立副本内原版、Fabric/FerriteCore、Quilt 均实际菜单并自然退出0，三启动任务 completed；原资料、实例、双索引审计不变。依据：`D:/MC_start/OUCL-download-main/docs/acceptance/20261114-v31/REPORT.md:9`、`:10`，`docs/acceptance/20261115-v33/REPORT.md:9`、`:11`、`:17`–`:23`。
- **B 任务观察和只读归属**：B01 有界公平观察，B02 真 worker/SQLite 配合测试专用受控时钟在第三条后停止、保留 TIMEOUT、同 worker 可续用；单次同步 SQL 不可硬中断。历史双域各1000、20页及1001拒绝是有限规模证据，不是全部机器性能保证。见 `docs/acceptance/20261114-v31/REPORT.md:11`–`:12`、`:34`；`docs/acceptance/20261114-v26/CURRENT-CHECKLIST.md:8`；授权仅只读查询等见 `docs/work-packages/P-B/APPROVAL_T1.md:3`。
- **C 只读预览**：选定只读契约及既有可达生命周期证据可供接纳；C01/C02 组件和真实 Electron 受控传输窗口有证据。窗口构建为 B02/D01 加入前 r2，不是最终包或真实公网证明；截图未完整显示固定版本，DOM/AX 支持该字段。见 `docs/acceptance/20261114-v26/CURRENT-CHECKLIST.md:9`、`docs/acceptance/20261114-v31/REPORT.md:13`、`:36`–`:40`。
- **D 内部一致性首片**：准确 Java 和锁内复核的正式事务夹具，加 v33 新包三次真实游戏正常路径；D01 不确定提交收敛是受控存储/进程回归，D02 是受控组件阻止普通启动，不等于真实存储故障或跨重开持久互锁。D03 按已批准历史测量、启动时复核实际 Java，不强加报告持久绑定。见 `docs/acceptance/20261114-v31/REPORT.md:14`–`:16`、`:30`–`:34`，`docs/acceptance/20261115-v33/REPORT.md:17`–`:23`。
- **E 固定样本只读预览**：限固定1355字节样本及已约定生命周期；旧真实选择器/重载证据及 v31 最终源码对应正式固定 worker 4 项回归支持选定范围。旧 GUI 不能称新 EXE 全链路实测；不扩到通用安装。见 `docs/acceptance/20261114-v26/CURRENT-CHECKLIST.md:11`、`docs/acceptance/20261114-v31/REPORT.md:32`。

## 缺证、真实阻碍及排除

- **本轮关闭/重开待补**：v32 空资料实际正常关闭重开、无数值退出码；v33 三游戏后正常关闭及重开后 Quilt 待补。v33 冻结时 Windows 前台激活受限，PID3884 仍持锁；这是操作环境阻碍，非已证产品缺陷。当前动态进程状态由统一管理另查，不以冻结报告推断。见 `docs/acceptance/20261114-v32/REPORT.md:7`–`:11`、`docs/acceptance/20261115-v33/REPORT.md:25`–`:29`、`HANDOFF.md:5`。
- **异常格仍缺证而非已证故障**：最终 EXE 强制中断恢复 DEFERRED（无法证明允许终止的进程归属）；C 公网 pending 取消 NOT_EXERCISED，早 close 根因 UNKNOWN；不得以受控模型冒称公网通过。正常安全配置下非主 frame 探针不可达，不降低安全设置。见 `docs/acceptance/20261114-v26/CURRENT-CHECKLIST.md:15`–`:17`、`docs/acceptance/20261115-v33/REPORT.md:31`。这些历史缺口是否作为交付阻塞由统一管理按批准目标决定，不能自动升级为全历史矩阵必测。
- 已发现的八项源码问题以 v31 修复与回归为准；上述窗口焦点、未触发场景、未捕获退出码本身不证明新源码缺陷。完整断电、所有机器/加载器/世界及旧玩家资料组合未穷举；不记通过，也不自动扩充本轮。
- 未授权/排除：C 文件启停卸载，D 公开 Java 面板，E 通用整合包导入安装，新业务 IPC、持久格式和依赖、发布；见 `docs/acceptance/20261114-v31/REPORT.md:18`、`docs/acceptance/20261114-v26/CURRENT-CHECKLIST.md:21`。既有 P-C、P-D、索引双摘要与租约批准以 `D:/MC_start/OUCL/OUCL-Codex/docs/DECISIONS.md` 2026-11-01、11-10至11-12记录为准，统一审查本身不扩权。

## 源码到最终包的证据链及边界

v31 清单 `docs/acceptance/20261114-v31/evidence/final-changes-r3.json` 包含 13 个生产文件；本次逐一读取 main 算 SHA-256，13/13 等于清单 `gitNormalizedSha256`，见同目录 `source-sha256.txt`。12 个也等于构建副本原字节；`src/services/launch/service.ts` 规范化摘要匹配而原字节不同，本次对两副本按 CRLF→LF 归一后文本逐字比较一致。v31 全量原始日志 `evidence/full-tests-r3.log:743`–`:748` 证实 691/687/0/4，构建日志 `evidence/build-r3.log` 给出七产物；不是旧 687 项覆盖新源。

只读核算 main 中 `release/OUCL-0.3.0-acceptance-20261114-v32.exe` SHA-256 为 `ba24713708030ba8b96a65858305fb4593d6e3fb0b2afc0ef83e6a4258904be7`。v32 `evidence/audit-package-v32.ps1` 逐条比较包内 manifest 与归档，并将七个 dist 摘要与 r3 构建文件比较；`evidence/package-audit-v32.json` 记录9项和7产物，`evidence/verify-exe-v32.log` 记录提取后9项验证。v33 `P-A/verification/v33-game-preparation/production-seven-sha256.json` 七项与上述一致，v33 报告第5、11行记录实际运行包审计。

**证明边界**：13个源码身份、统一构建记录和7产物到EXE字节一致形成构建级链路；现有构建日志未保存逐源文件到 bundle 的 metafile/sourcemap，因此不声称已逐文件独立证明每段源码在包中运行，亦非数字签名或可复现构建证明。v33 代表游戏也不覆盖 B/C/E 每个产品交互。

