# 对比技术方案执行索引

最新结果与原始证据：[2026-11-17 方案A基础](20261117-a/REPORT.md)，前轮内部域结果见[r3](20261117-r3/REPORT.md)。批准状态以资料包 TASK_PLAN / DECISIONS 的真实记录为准，本文不新增批准。

| 项目 | 当前有证据的状态 | 入口 |
| --- | --- | --- |
| N1—N4 | 实例与任务 UI、引导、外观、渐变文字已实现 | [首轮报告](20261115/REPORT.md) |
| N5 | 隔离基础设施与空配置入口已实现；真实站点未确定 | [持续执行记录](20261115/CONTINUATION.md) |
| N6 只读 | 签名与所有权差异预览已接线；真实来源/公钥为空 | [持续执行记录](20261115/CONTINUATION.md) |
| N6 内部事务 | v2 发行、SQLite 权威、journal/receipt、原生文件工厂与限定恢复已实现 | [内部协议](../contracts/DISTRIBUTION_EXECUTION_INTERNAL.md)、[真实 authority 恢复](20261117/AUTHORITY.md) |
| N6 生命周期 | 内部请求有界、根 inode 绑定、取消信号及提交边界已验证 | [取消报告](20261117/CANCELLATION.md) |
| 候选 EXE | 独立候选 11 文件审计与 18 项实际外层检查通过；未替换正式 EXE | [打包报告](20261117/PACKAGING.md) |
| N6 本地域适配 | 内部 Mod gate 已实现并通过真实 worker/SQLite/native/coordinator 有限测试；实际来源、许可政策及其他区域仍未装配 | [r3 结果](20261117-r3/REPORT.md) |
| N6 公共执行 | 方案A已批准；契约、确认/outbox和固定任务投影基础已实现，接线与双库对账未完成，能力未启用 | [方案与批准后继](20261117/PUBLIC-EXECUTION-PROPOSAL.md)、[恢复点](20261117-a/CHECKPOINT.md) |

合成响应、隐藏窗口、同进程 owner 关闭重开与纯规则测试分别保留自己的证据边界；不能合并为真实网站、许可证、公网分发、游戏或强杀验收。完整技术文档任务尚未全部完成。
