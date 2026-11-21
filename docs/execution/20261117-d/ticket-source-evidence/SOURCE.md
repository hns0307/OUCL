# Main-owned confirmation ticket源码增量

2026-11-17，基线46197ef9。先读TASK_PLAN/DECISIONS、AGENTS及C恢复点，沿用户持续批准方案A推进。本片只改`src/services/distribution/execution.ts`及本目录，不改测试、public入口/契约、持久schema、任务库或真实来源配置；测试由独立代理负责，无Git提交。

## 固定接口

```ts
DistributionExecutionCoordinator.ticket(proposalId: string):
  Promise<Omit<AdmissionIntent, 'confirmRequestId'>>
```

AdmissionIntent只作type import，未新增平行ticket类型。返回`{proposalId,plan,releaseSha256,gameIdentity,previewFingerprint}`，全部来自真实ready Prepared及当次重验，最终structuredClone隔离调用者修改。renderer不能提交或重建plan/hash/目录身份。内部DistributionProposal额外返回`instanceRevision=plan.instanceRevision`供后继公有ready DTO映射，不新增public或持久字段。

Prepared保存build时验证过的accepted.releaseSha256以及snapshot已计算的rootIdentity；snapshot现将该identity一并返回，不另猜目录对象。ticket依次：

1. check/sweep后查原proposal及tombstone，等待原prepared，ensurePreparing核对取消、TTL、disposed，拒绝conflicts。
2. 重新target/snapshot，当前完整fingerprint及目录identity必须与原prepare匹配。
3. authorize(plan,原proposal.controller.signal)复验当前pins、发行time/archive、环境及domain。
4. authorize后再次target/snapshot匹配原prepare，拒绝await期间外改或目录换绑，不以新基线重收编。
5. 末次readAcceptedRelease必须仍是原发行hash/高水位；重新核plan完整绑定、规范payload hash、当前未撤销key签名及发行time，末次ensurePreparing后返回clone。

ticket不调用transactions.commit、admissions、task accept或文件写入。该材料不是durable授权：未来admit仍同事务验证authority，真正执行仍独立验证当前信任/domain、原fingerprint/identity、ownership/lease/receipt。

## 生命周期与互斥

同proposal的tickets map只保留在途Promise，重复ticket共用同一验证工作但各自得到clone，finally删除，不缓存完成大对象；所有工作纳入既有jobs追踪。

ticket在途时legacy confirm明确拒绝`DistributionExecutionLifecycleError('EXECUTION_ACTIVE_LIMIT')`；confirming/executing时ticket同样拒绝。没有偷偷触发confirm或把ticket映射为执行，不改原confirm执行主体及终态replay。

ticket不新增externalSignal，使用原proposal controller承接cancel/close/TTL；每次关键await后ensurePreparing，snapshot内部也受原signal约束。cancel仍沿原接口请求撤销；close撤销原request后通过jobs等待实际端口settlement，再清tickets。不会把abort当worker已经退出，原committing/TooLate行为仍归事务处理。

## 当前源码证据

整仓TypeScript及execution.ts局部ESLint均exit0，[FD状态](initial-status.json)、[type日志](typecheck-initial.log)、[lint日志](lint-initial.log)、[固定node复现脚本](check.mjs)、[冻结SHA](source-sha256.json)。只使用父目录已装node/tsc/eslint，不用pnpm或安装；默认沙箱执行，无网络/GUI/native重验。

源码冻结SHA256：`0c67ae0a5853e9728d51396216871b79d75bbda9be8bd0744a32c35a2032efd5`。独立测试代理正在验证真实签名/SQLite/FS的ticket、取消/drain及互斥格，其测试报告由其拥有，本页不预记尚未收到的测试结果；整合fullchecks由主协调负责。生产仍no-port/不广告execute，真实source/key/许可政策仍空。
