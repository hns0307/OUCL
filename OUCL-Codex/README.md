# OUCL 计划与需求资料

当前为阶段0工程实践：默认设计方向及空骨架已批准并实施，整体技术验收仍有缺项，正式游戏业务未开始。

最新执行证据：[空骨架与便携目录验收](../docs/validation/P0-08/REPORT.md)、[本地恢复与信任链实验](../spikes/phase0-local/REPORT.md)。[S-09](../spikes/S-09/REPORT.md)文件软链接仍因权限不足待补测，不能标记通过；其他任务按TASK_PLAN有效授权实施。

## 阅读入口

每次开发首先读取[任务安排与阶段验收表](docs/TASK_PLAN.md)，核对[决策与授权记录](docs/DECISIONS.md)，只执行当前明确批准的阶段及增量：任务排期不等于授权。计划书维护设计与依赖，任务表维护执行与验收记录。[开发规范与交付流程](docs/DEVELOPMENT.md)集中说明阅读顺序、门禁、编码、安全和验证要求。

1. [计划审查与修订说明](docs/DESIGN_REVIEW.md)：12项冲突、缺失和冗余的修订理由与验收重点。
2. [阶段0计划书](docs/PROPOSAL_PHASE0.md)：当前范围、支持矩阵、架构、IPC和唯一任务排期。
3. [存储与共享目录方案](docs/STORAGE_LAYOUT.md)：身份、隔离、软链接、事务恢复及回收。
4. [XMCL结构取舍](docs/XMCL_ADAPTATION.md)：参考项目的设计借鉴。
5. [决策与授权记录](docs/DECISIONS.md)：D-01–20及实际授权，推荐方案不等于批准。
6. [根级协作规则](../AGENTS.md)：覆盖整个仓库的后续执行边界。

[原始需求](docs/REQUIREMENTS.md)、[原始提示词](docs/ORIGINAL_PROMPT.txt)和[首次任务](prompts/FIRST_TASK.md)保留供追溯。首次分析已经完成，不需要每次重复首次任务，也不同时执行原始需求中互相矛盾的阶段安排。

实际Git根为`OUCL/`，本资料包位于`OUCL/OUCL-Codex/`。当前生效的AGENTS位于Git根，覆盖整个仓库；资料包内没有第二份AGENTS。未来应用根仍按D-17批准，当前不移动原资料。

历史设计修订本身不代表业务开发授权。2026-10-24用户已明确批准默认方案和阶段0工程范围；根级docs保存实际工程证据，资料包保持设计与执行入口，正式业务仍按具体增量启动。
