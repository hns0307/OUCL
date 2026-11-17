# Root-owned持久确认服务源码

2026-11-17，基线e666a2a5。已读TASK_PLAN/DECISIONS/AGENTS、E/CHECKPOINT及D/NEXT-SERVICE；用户持续批准A有效。本片独占新增`src/services/distribution/confirmation.ts`和本目录，未改旧生产、公共glue、任务库、测试、schema或依赖，无Git提交。

## 固定API

```ts
new DistributionConfirmationService(rootId, ports)
service.confirm(requestId, { proposalId, instanceRevision, sequence })
  : Promise<DistributionExecutionAccepted>
service.close(): Promise<void>
```

导出`DistributionConfirmationPorts`与红acted `DistributionConfirmationError(code:DistributionExecutionCode)`。ports只含：

- admissions：readByRequest、readByProposal、admit、bindReceiptAlias。
- ticket(proposalId)：返回已有AdmissionIntent去掉confirmRequestId的内部材料。
- reconcile()：返回DistributionReconciliationResult。
- readProjections(expectedRootId)：返回DistributionTaskProjection[]。

root构造、请求UUID及confirm payload沿严格公共guard验证，字段exact、UUID小写、revision/sequence正安全整数。服务不接受renderer plan/路径/digest/taskId，不调用generic accept创建新ID。

## 确认/回执路径

1. 先readByRequest原确认ID，严格parseAdmissionRecord并核root/proposal/revision/sequence；已有回执完全跳过ticket，不重新prepare或赋予执行许可。
2. 原ID未知时查proposal；已有匹配record调用bindReceiptAlias(root,requestId,proposalId,inputDigest)，只绑定旧回执，不因高水位/TTL更新而重授执行。
3. 新proposal才调用ticket，立即有界snapshot，strict核plan/proposal/hash/目录proof、root/revision/sequence；admit时只附加原confirmRequestId。返回record需匹配内部canonical intent digest。
4. admit或alias可能commit后丢ack：catch只有限readByRequest原ID，严格核原字段及ticket/旧record digest（旧record还核原taskId），无匹配则拒绝，不造新ID或盲目重写。
5. 调用reconcile再读真实projection；reconcile任何全局orphan/冲突失败都保守返回，不能因当前task看似匹配而吞错。query结果先校count/累计bytes再clone，逐条exact/root/kind/Execution和重复proposal/task审计；当前row必须精确taskId+inputDigest匹配。
6. 末次readByProposal确认仍是同task/digest的projected record。回执snapshot由真实Execution派生：state/revision/bytesDone/可选bytesTotal保持原值；queued/committing/终态映射同名stage，其余preparing，不补造未知error。最后复用严格confirmExecution data guard，kind必须distribution-install。

typed端口结果在进入下一await前snapshot，完整admission与ticket按既有单条字节预算验证；projection总预算沿MAX_ADMISSION_TOTAL_BYTES加固定wrapper余量，最多1024行。未知异常不暴露message/path；Storage REVISION_CONFLICT→REQUEST_CONFLICT，损坏→NEEDS_RECOVERY；明确transaction/release/lifecycle错误采用固定公共映射，其他UNAVAILABLE。

## 有界与关闭

active最多16，seen最多1024轻digest不驱逐；同request同输入共用内部metadata Promise，每caller返回detached回执，异输入REQUEST_CONFLICT。完成不保留response/body。seen满时未知内存ID仍可先**只读**查询durable request，匹配旧回执可恢复且不增加seen；无durable身份则CAPACITY_EXCEEDED，不能ticket/admit。

后续review修正durable与seen优先级：入口只对**active**同ID异输入同步拒绝；lane内先strict readByRequest/matches恢复持久回执，仅当durable不存在才检查seen digest/容量并写seen。因此服务重建后先以错误sequence尝试旧回执，不会用错误内存digest挡住正确原payload重试；无durable的失败seen继续保留，未放宽其冲突或驱逐身份。容量按lane实际处理时计数，不在排队预约时污染seen。

主协调review发现不同request并发admit可能穿插到reconciler完整快照，并使共享domain ticket扫描冲突；随后最小修复为服务级metadata lane，把**整个work（ticket→admit→reconcile→snapshot）串行化**。active仍包括最多16个正在执行或已预约排队的请求，同ID只入队一次；调度tail只吸收settlement供下一队列继续，调用者仍收到本次原始错误。close等待全部已预约链，不因失败或关闭丢弃队列；不新增API/schema。

close只停止新confirm并等待所有已进入的metadata链实际settle；即便当前held ticket尚未admit，也让该已进入请求继续确定结果，不伪造取消。commit后不abandon未知结果，不关闭共享Store/Coordinator/reconciler，不把关闭视为任务取消。close返回同Promise；新confirm为UNAVAILABLE。

本类不execute/control/recover文件、不启动worker、不广告backend，projected只代表metadata投影；后继真正执行仍须从durable admission核原previewFingerprint/gameIdentity、当前trust/domain/许可及受保护native事务。真实source/key/locator/许可仍空。

## 静态与独立测试状态

固定父目录node执行整仓typecheck与confirmation.ts局部lint，均exit0；stdout/stderr直接FD保存于[typecheck](typecheck-initial.log)、[lint](lint-initial.log)，[状态](initial-status.json)、[复现脚本](check.mjs)、[源码SHA](source-sha256.json)。默认沙箱，无pnpm/安装/网络/GUI操作。

lane修复后再次typecheck/lint均exit0，见[lane状态](lane-status.json)、[type](typecheck-lane.log)、[lint](lint-lane.log)、[复现](check-lane.mjs)；修前静态日志及[source摘要](source-before-lane-sha256.json)原样保留。测试代理正补同source/version下两个不同proposal并发confirm代表格，不在收到结果前预记。

durable优先修正后typecheck/lint仍exit0，见[最终状态](durable-status.json)、[type](typecheck-durable.log)、[lint](lint-durable.log)、[复现](check-durable.mjs)；上一lane源码摘要另存[source-before-durable-sha256.json](source-before-durable-sha256.json)。测试代理在原服务重开格补“错误sequence先拒→正确原payload恢复同task”断言，结果由其独立报告收存。

独立测试代理报告本片8项真实测试8PASS/0FAIL/0SKIP：真实ticket→admit→双库投影、原ID/alias于高水位/TTL后恢复、root/rev/seq/身份冲突、admit/project/mark实际commit后丢ack、重开原ID无需ticket、sameID并发及close等待两节点。该测试源码/原始日志和静态报告由测试代理独占收存，本页没有将其说成我再次执行的测试；完整检查由主协调负责。

源码194行，最终冻结SHA256 `eba665bf96398deb79cf15c362e32047c3072cb5115de20f7765d3ac6f610a58`。只读回执和合成许可fixture不等于配置完备产品执行或真实许可证验收。
