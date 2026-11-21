# A内部确认材料结果

沿已批准A完成Coordinator.ticket(proposalId)主进程内部接口。只从真实ready Prepared提取plan/rootIdentity/previewFingerprint/releaseSha256，重验原快照及身份、TTL/conflicts、当前key/time/domain和最后accepted archive/highwater绑定，返回深拷贝；singleflight仅在途，legacy confirm互斥，原cancel/close纳jobs真正drain。内部proposal新增instanceRevision。

真实票据专项7PASS/0FAIL/0SKIP；最新全944项940PASS/0FAIL/4既有SKIP，typecheck/全lint/build全部exit0。票据→独立admit保持同task回执但无文件发布，原单元之外的worker/JAR/私有Store是真实，runtime/platform/许可仍为合成typed ports；不冒称真实政策或公网。独立只读有限审查认可，无确定阻断；getter不是durable授权，不自动admit/造task/commit。

新旧两测试文件共享native helper编译路径有潜在跨进程覆盖，收尾把测试fixture ROOT增加process.pid目录，保留原7PASS日志后重跑7格通过。仅测试路径隔离，不靠串行/skip掩盖race，无已发生fullsuite覆盖反例冒称。新全回归也验证旧domain15与票据7并行正常。所有原始日志/source SHA在本目录。

本片无新public method/schema/依赖，不重新打包或覆盖EXE。C候选execution-20261117-c仍为46197ef9前C构建快照，真实26检查仅证明该调用层/no-port，不证明本ticket已产品接入。A实际持久任务backend、target/取消/恢复/UI仍未完成，生产无执行port、不广告能力，来源/key/政策空约束不变。
