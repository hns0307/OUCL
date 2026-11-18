# M passive task provider

新增 `DistributionTaskViewProvider(rootId,ports)`，内部 get(taskId)、list()、targets(instanceId)、close()；不接 main/router/TargetKind/public，不执行、结算或控制任务。真实 source 配置是否可用与历史观察无关。

required `AdmissionRepository.readByTask` 使用既有 unique task_id 索引查询，再走 private record。保留 verify + validateStored 的完整有界全库校验，旧读取语义/schema 不变。因此点查询仍有最多16MiB审计成本，复读可能重复审计，不能声称已优化为恒定 IO；未引入新缓存架构。

startup ready 是实际外部 reconciliation barrier，未完成前不读任务，失败 UNAVAILABLE，不伪空。固定安装根前后复读；get 立即 snapshot admission 后才 await 其他 ports，核真实 StorageClient.get + findAccepted 的同 owner/proposal/digest/task 双侧，最后复读。无 admission/task 时额外调用真实完整 projections 检查 tasks/requests 悬空，再复读 absence，不能掩藏 orphan 或新 accepted。

list/targets 两轮全量有界 admission/projection 校验，admission 返回立即 snapshot，检测 root 内 projected 缺任务、projection 孤儿、重复/绑定差异；known accepted/outbox 在途明确 UNAVAILABLE。只有完整 root 库核对后才按 instance 过滤，防止筛选掩藏另一个实例的损坏。

get/list 保留已删除实例历史，不要求当前 instance 仍注册。targets 只收 instanceId，从真实 readInstance/installation 派生 scope并前后复读；summary.revision 必须等 envelope revision，scope 改变/消失拒绝。输出 instanceRevision 取 admission.plan 的历史目标修订，不冒充当前实例修订。snapshot 保留真实 execution state/revision/bytes，不按 projected 推完成、不造错误或许可详情。

实际 query 槽合计最多8；同 task get、整体 list、同 instance targets 各自单飞，targets最多2个不同实例。list/targets 进一步共享进行中的 inventory，不建时钟缓存、不扩大 globalTaskPool。close 同步停新，drain 真实只读工作与后续 scope 复读，不取消共享服务或丢弃未结 Promise。

## 验证及范围

本代理运行固定 Node 整仓 tsc --noEmit 与两个源码 ESLint，最终 exit0，首版/最终原始日志同目录；源码摘要见 checks.json。真实有限专项由独占测试代理运行，独立审查及全检由主协调统一收存；不冒称本人运行专项或整仓 build。

末审修复即时 authority snapshot、absence dangling-request 检查、实例 summary/envelope revision 约束，以及整体查询单飞/预算；原样保留真实 readonly 语义，无新依赖、网络、玩家文件操作或 Git 提交。
