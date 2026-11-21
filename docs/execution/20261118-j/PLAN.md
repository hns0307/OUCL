# 方案A J：已接纳内部执行

G2，沿用户明确批准A，从a2ab41c3已完整验证I继续。主协调实测primary2%已用恢复，source/key/站点继续空；不引入公共契约、存储格式、依赖或产品开放。

增量：Coordinator.executeAdmitted(proposalId,taskId)，通过可选main-owned固定root/admission/projection/claim端口，从durable record取原plan。严格root/proposal/task/digest和完整有界投影，先H核终态（pristine queued不认终态）；无journal须核原快照/目录/实例revision、原releaseSha256与当前签名/key/time/领域/许可/idle，再本人取得G本次成功claim，复验后调用I bound事务。未知claim ack、已running无journal、部分journal不盲重放。

生命周期：执行全程有界singleflight/jobs；legacy ticket/confirm/recover与admitted在claim前互斥。cancel提交前可撤销并真实排空；receipt commit后TooLate，close不打断cleanup。终态H薄证据仅历史metadata，当前任务仍需后继K持久状态/结果，不能伪造completed snapshot或广告能力。

分工：实现代理独占execution.ts及必要新内部辅助模块，测试代理独占新真实fixture/test，review只读；主协调计划/整合/全检。真实SQLite/worker/本地native与合成来源/许可事实分别记录；验证fresh一次、terminal读回、丢ack无effects、现场变化、取消关闭/互斥。先专注后全test/type/lint/build，不预记结果。

风险：claim后失败可能无journal而留running，预期保守恢复，不退回queued；私有receipt更新后旧终态可能保守拒，不能暗加历史schema。公共backend/facade、任务状态/结果/观察/控制/恢复及UI仍待后续；不push/替换EXE或覆盖原WIP。
