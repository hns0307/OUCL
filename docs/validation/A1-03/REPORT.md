# A1-03 摘要判断与任务调度纯策略

2026-10-24，沿用阶段1A下载与启动闭环持续授权。新增core/download/integrity、core/task/machine、core/task/scheduling及独立测试，无IO、新依赖、IPC或持久化格式变化。

摘要判断同时要求预期大小、上游SHA1/SHA256与实测SHA1/SHA256。本地SHA256用于对象身份，不升级来源信任；provenanceId只保留服务已验证的来源关联，不因字符串存在就认证来源。相同大小但摘要不同拒绝。真实流式哈希、官方元数据锚定、网络续传仍由后续服务完成。

内部执行模型为queued→running→verifying→committing→completed。pause请求等worker确认paused；cancel请求等中断、等待执行器退出及cleanup确认后才cancelled；失败先failing清理，再failed允许重试。提交阶段保守拒绝取消，提交/清理失败及异常中断进入needsRecovery，不能猜测成功。attempt隔离重试，sequence丢弃重复/乱序；进度在同次attempt单调且不超过固定总量。resume新attempt进度重置，实际续传位置由服务上报。所有effects均为意图，服务必须先持久化状态，再执行；cleanup须先abort/join旧工作再确认，不能与旧写入并行。

共享传输消费者独立暂停/恢复/解除：至少一个active则继续，全部paused才暂停，最后消费者解除才取消。UI退订不解除下载需求。纯调度函数依据完成依赖和全局并发预算选择稳定批次；缺失、失败与环依赖不启动，不在此自动重试或修改任务。

`pnpm check`退出0：typecheck、lint、33项测试、build通过，新增8项测试。core编译模块行100%、分支98.85%、函数100%；本增量三个模块三项均100%。[check.log](check.log)仅去除行尾空白。

内部Execution不是已发布的TaskSnapshot，不把内部状态/attempt字段加入IPC。未接真实worker、SQLite任务恢复、网络或界面，不能据此声称已经能下载或启动MC。下一步A1-04存储及有界执行器/既有契约服务；整体目标仍进行中。
