# A公共调用层恢复点

937项933PASS/0FAIL/4SKIP，type/全lint/build0；候选execution-20261117-c实际26检查及11应用/73runtime摘要通过，原正式EXE不变。C沿41120eed基础精确保存，提交号见Git。

下一最小内部接口：Coordinator.ticket(proposalId)只从真实ready Prepared提取immutable AdmissionIntent(除confirmRequestId)，重验rootIdentity/previewFingerprint、TTL/冲突/签名/time/domain/accepted release，纳入jobs使cancel/close drain；不执行、不admit、不造task。避免与legacy confirm并发，ticket材料不等于durable授权。

再后：持久task服务接admit/outbox/reconciler，真正执行时从已确认admission核原fingerprint/目录identity/当前trust/domain/native；projected并非executed，无journal不盲重放，不以transport重派原ID作为幂等权威。接task-target观察/cancel/recover/UI确认后才可考虑configured广告。

生产仍no-port，所有合法execution调用SOURCE_UNAVAILABLE；source/key/locator/许可政策仍空，其他area domain仍unsupported。原preview独立。A持续批准无需重复问；额度primary<=10%保存，恢复够高继续，保留独立监测/不动reset credits或weekly停止。
