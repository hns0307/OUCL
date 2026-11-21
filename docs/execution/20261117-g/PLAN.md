# 方案A G：执行前持久任务认领

G2，从F本地提交403f15b4继续用户已批准A。本片仅新增storage内部claimDistributionTask(expectedRootId,proposalId,inputDigest,taskId)，不增加公共IPC、schema或依赖，不接文件执行。

同一SQLite事务核requests/tasks精确绑定，真实worker从installation导出owner并核expectedRoot；只有queued/attempt0/revision1/lastSequence0/bytesDone0/未设bytesTotal允许经core start写running。重复、错根、孤儿、冲突、已进展或重启needsRecovery均拒绝。成功响应是本次调用许可；丢ack不从running读回补授，不自造新ID。

范围：TaskTable、RecordStore及worker/client内部方法、独立真实存储测试和证据。存储代理独占这些文件；主协调负责整合、计划记录与全检；其他代理只读审查。

风险：认领后崩溃可能没有journal，必须保守needsRecovery而非盲重放。真正执行服务仍须从durable admission核初始快照/目录/可信发行/领域/许可/idle，protected native factory绑定原gameIdentity。当前source/key/站点空、生产no-port不广告。

验证：真实RecordStore和StorageClient worker，初始认领、重复、绑定与pristine字段拒绝、提交后丢ack、正常重开恢复。随后实际type/lint/full tests/build，独占目录并保留原始日志；不预记结果。
