# J executeAdmitted独立只读审查

2026-11-18。I已a2ab41c3完整检查保存后，沿用户持续批准A审查J；只新增本报告，未改source/tests，未启动重复full或native/GUI试验。核对execution.ts diff、admitted-execution.ts及当前H/G/I实际接口。

最终只读核验SHA256：

- execution.ts：`440d07c5bdb8d51fef4b44157725648180ae23ec177653a6c3228a9dbe0a8dff`。
- admitted-execution.ts：`1cfd7c10d162833ca9c2193c8cc9fabd25b177099ac9937d6a735561348a9600`。

实现代理报告两源码static通过；测试和完整检查由其各自原始报告负责。本审查没有将未亲自运行的检查说成再次实测，也不将I/H基线全检数字移作J结果。

## 最终结论

**本片限定范围未见剩余阻断，有限认可内部durable执行链。** 只返回H薄终态证据，未持久更新任务终态/领域结果，不等于task completed或configured产品执行。production仍no-port，真实source/key/许可政策空；后继K和facade/任务观察/控制/配置准入仍缺。

| 审查点 | 最终源码判定 |
| --- | --- |
| durable入站 | 只用admissions.readByProposal读真实record，bounded clone+parseAdmissionRecord；要求projected、proposal/taskId及私有rootId匹配。rootId构造时复制标量，不随ports对象root属性改写。 |
| projection绑定 | 完整最多1024、总4MiB前置预算后clone；每row exact/root/kind/Execution、proposal/task唯一；目标精确inputDigest/taskId，不自行造ID或generic accept。 |
| 同步双向互斥 | helper在首await前占active；J期间prepare/ticket/legacy confirm/recover拒绝。反向legacyBusy看jobs/tickets，真实在途工作阻J；不把F ticket结束后留存的ready缓存当busy，避免本proposal永远无法执行。 |
| H终态优先 | 先严格H四读证据，再核task attempt>=1且非queued；有terminal但pristine queued拒绝，不能以legacy已写journal绕G。末尾再读record/projection稳定；不claim、不调用事务重放。 |
| 无journal首次路径 | 只有完整Execution等于createExecution()才可继续；running/needsRecovery等无journal均保守拒绝。必须有factory，观察原fingerprint/gameIdentity，并在snapshot前后isIdle核验。 |
| 权威复验 | claim前后均重验当前accepted hash等原releaseSha256、完整plan/manifest/sequence、pins/key/time及domain；observe再次核完整durable record与task tuple，拒绝await中重绑定/进展或玩家外改。 |
| fresh claim | 亲自调用原G claim；只有成功响应才继续，exact核running/attempt1/sequence0/revision2/bytes0/无total。没有catch后用running读回补授；随后projection必须精确等本次claim响应tuple/revision。 |
| native绑定 | 最终只调用I commitFreshBound(record.plan,record.gameIdentity,signal)，已有journal不可作为fresh早返。factory存在仍依赖main注入受审protected实现，boolean presence本身不证明native能力。 |
| 结束读回 | commit后H只读核元数据方向，不用取消打断terminal验证/cleanup，不返回完整plan/receipt冒充公开snapshot。明确typed Transaction/Release错误保留，未知错误脱敏。 |
| 生命周期 | active调用纳coordinator jobs，重复相同proposal/task共用工作并detach；different任务拒；seen有界1024不驱逐，terminal phase cache有界。pre-execution用本job controller撤销；执行后交transactions.cancel/TooLate，close等真实settlement，不把abort当退出。 |

## 审查发现并已闭合

1. **提交后unknown被close误映射CANCELLED**：原catch在commit完成后H读回失败时，若closed=true会把NEEDS方向掩盖为取消。最终改为仅未executing且aborted/closed时把未知错误映射CANCELLED；executing后未知保持NEEDS_RECOVERY，明确typed取消仍按原事务返回。已只读核对最终helper。
2. **被阻ticket仍先sweep**：原ticket在admitted.busy guard前sweep，可能到期abort旧Prepared controller，间接撤销当前J同tx domain session。最终顺序check→admitted.busy拒→sweep，与同步互斥目的相符；已只读核对最终execution.ts。两项初读修正不通过放宽权限或重置任务制造成功。

主协调初读提出的preclaim idle前后、私有root标量、ReleaseError typed保留也已体现在上述最终源码；本报告不把这些变化归成额外新能力。

## 明确保留到K/后继的边界

- J不持久写task terminal/result/error。claim后校验失败、取消或ack未知会保留真实running；重启恢复可能needsRecovery。不能reset queued、再claim、换ID或声称task已cancelled/completed来填补K。
- coordinator.cancel只保证当前J active及已观察的terminal phase。没有active时admitted.cancel(false)与legacy cancel之间存在await可重入窗口；legacy Prepared取消**不是durable queued task取消**。future facade必须依K持久控制，不能把该回执暴露为已取消durable任务；本片未擅扩queued取消。
- close在claim等待/复验前阶段可返回请求CANCELLED，但仍等待实际metadata settlement，不意味着已持久取消任务。commit已开始的cleanup/receipt方向不被文档关闭回退。
- 无journal不证明没有私有staging；I仍保守拒已存staging，不沿未知目录删除。partial journal或H不符方向需显式恢复，不自动写文件。较新receipt仍沿H最小模式拒绝，不臆造历史祖先链。
- 当前seen达1024后新proposal保守拒绝，不驱逐旧身份；容量与新服务实例的恢复行为不是durable执行许可。跨coordinator/root服务的共享domain、trust变更close/drain及任务调度仍由main受审装配保证。

上述边界不构成在未配置生产入口上开放执行的依据。最终测试/全检及原失败、修正前日志由主协调与测试代理精确收存；本报告只读源码结论现已冻结。

主协调后继更正（2026-11-18）：上文440d07摘要属于ticket顺序修复时审查快照；随后full发现并修复close同步撤销，最终execution摘要为01291d5042c39880bbbf60e22d930db38ebbe6d883920563fc2a6a7a5aba71a0，helper不变。最终close-r2 35PASS及全979/975PASS/4SKIP见REPORT.md和checks-r2-evidence，不能将旧头部摘要当最终源码。
