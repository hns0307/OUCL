# 方案A基础增量结果

用户2026-11-17明确批准方案A；批准记录已入TASK_PLAN/DECISIONS及ADR-004。当前不是再次待批，不需要对同范围重复确认。

已完成：严格5通道typed公共契约/DTO与预算常量；私有distribution schema1→2事务迁移、immutable confirmation intent/内部digest/一次生成taskId、request aliases、accepted→projected outbox；既有RecordStore tasks/requests的专用固定ID原子投影、worker expectedRootId校验并派生owner；distribution-install kind及任务中心中心化显示标签。generic accept不能为该kind随机造任务。

实际验证：公共契约7PASS；admission新增8及旧Store5共13PASS；固定任务投影4PASS。最新完整893项889PASS/0FAIL/4既有SKIP，typecheck/全lint/build均exit0。原始日志和结构化状态见final-evidence，源码实际摘要见source-manifest.json。各专项目录保留首次失败/并发静态诊断，不改断言/skip造绿。

重要边界：admission已存在的精确request回执可在高水位前进后读取，不能据此执行旧发行；新接纳同事务核对archive/highwater。projected只表示任务投影已记录，不是执行完成。首片只提供两个提交域的基础原语，尚未装配双向reconciler，不自动补投影/执行/恢复。固定ID投影有真实RecordStore/SQLite/worker测试，root切换不允许迟到写到新owner。

未完成：handshake/preload/主进程5通道handler、准备生命周期adapter、持久task执行/取消/恢复与target观察、双库ack丢失/重开对账、UI确认入口及最终公共层E2E。能力目前不广告/未开放；真实source/key/locator/许可政策仍空，未重新打包/替换正式EXE、未push或动原WIP。

收尾主协调注意到一个后继契约收紧点：Accepted/Recovery目前复用通用TaskSnapshot guard；既然本片已引入distribution-install，应在接线前明确要求snapshot.kind为该值并加拒绝其他kind代表测试。本轮达到额度阈值后未再改实现，此项明确进入恢复首步，不能把当前契约基础说成公共开放准入全齐。

primary300分钟实测91%已用/9%剩余，按用户规则仅收齐已启动checks并保存，停止新增实现。既有额度监测保留；无需消耗重置或购买额度，weekly不是停止原因。
