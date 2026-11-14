# D-01 最小收敛候选计划

范围：只处理已登记 launch 任务的 committing；复用 interrupted 状态机与任务 revision CAS，不变更持久字段、IPC、事件、依赖、游戏锁或其他状态。原回执丢失时会话错误保存失败不能阻断对任务的保守处理；无法确定权威状态或写入失败不报告恢复成功。

所有权前提：正式 main/index.ts 在 Electron 单实例分支中只打开一个 StorageClient 并建立一个 LaunchService。Windows 存储打开有 OwnerGuard；本方案依赖同一元数据所有者内只有该一个有效 LaunchService，不能将 `spawned:false` 作为无进程证明。跨不同 StorageClient、同一进程自行构造第二个 LaunchService 不受此类局部修复保护，属未支持的装配方式，不声称已检测或安全；集成前协调者必须确认继续维持该唯一所有者不变量，否则停止接纳并先设计显式租约/所有权。退出过程中 owned 游戏继续存活时不释放当前服务。只在无本服务 job 且无本服务 owned 的任务才尝试收敛；有真实外部 JVM 的可能性仍以 needsRecovery 保守表达，不发起进程操作。

执行：catch 中即使会话错误保存失败仍尝试当前任务中断；保存或收敛失败时，job.done 以 AggregateError 保留原动作及相关失败；若权威读取/写入依旧失败则不伪造结果，job 结束后后续初始化或查询重读。初始化只尝试最近最多 32 条会话，设置共享 2 秒检查点软预算并在每次读取/写入前后检查；任一异常或预算到期停止该批，单次 RPC 仍受原超时控制，错误不导致全局启动失败；单任务查询仅针对对应已登记启动任务，读取权威状态并在无活动 job/owned 的情况下将 committing 用 interrupted 转到 needsRecovery。CAS 冲突/读写失败由查询报错，后续查询可重试；初始化跳过失败项。复查 job/owned 并使用 CAS 避免覆盖并发更新。同 ID 重接纳沿用既有语义，禁止自动重放；取消使用现有 INVALID_TASK_STATE。其他状态尤其 verifying 不强改。

验证：可迁移受控替身覆盖回执落库后多次持续失联、恢复、重复查询与初始化、相同请求、取消、CAS 冲突、活动 job 保护；提供真实 StorageClient/SQLite 验证时单独标注证据层级并使用专属 OUCL_TEST_ROOT。仅在本非 Git 目录复制固定源码并产生夹具及日志，不改旧候选或共享目录。尚未做产品交付或声明整体验收通过。
