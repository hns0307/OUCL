# 方案A双库对账增量

用户继续，primary实测1%已用，沿已批准A从a8bc927d恢复；不重复索取批准。首步收紧公共Accepted/Recovery只接受distribution-install snapshot；主协调拥有该契约改动/reconciliation.ts/公共记录，baseline拥有admission-record.ts完整有界读取/strict parser及真实query tests，n1拥有TaskTable/RecordStore/worker/client有界投影读取，ui拥有真实双库对账tests/fixture。

对账只处理已确认元数据，启动时关闭新接纳gate；按root过滤并绑定proposal/inputDigest/taskId，accepted缺任务补固定同ID、两边commit ack丢失精确读回，已projected但task丢失拒绝不造queued，orphan/集合变化/错root failclosed。close等待真实settlement，不取消不明提交。无文件执行或未确认prepare恢复。

读取计数<=1024，不静默截断；16MiB admission总字节预算在SQL先门禁且新写同事务拒超额，root克隆前也限制并预留输出phase/revision开销。坏旧数据保留，不删表/不升级schema2。PRAGMA foreign_key_check只需首条违例，避免完整展开。

验证真实DistributionStore与RecordStore/StorageClient worker两个SQLite域、WAL一致快照、固定ID/ack loss/重开/孤儿/错root/close，FD日志独占D根；最终全type/lint/test/build。真实source/key仍空，无public handler/广告/UI入口变动、无push/正式EXE覆盖/新依赖，原WIP/tmp保留。
