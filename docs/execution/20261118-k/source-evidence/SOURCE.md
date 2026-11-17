# K 任务终态落盘源码

新增纯 `core/distribution/task-settlement.ts` 与私有 `services/distribution/settlement.ts`，不修改 J、公共接线或持久 schema。

`DistributionTaskSettlementService(rootId, ports).settle(proposalId,taskId)` 从真实 admission/projection 核 projected/root/proposal/task/inputDigest，首次仅接受 attempt=1、revision>=2 的 running/needsRecovery。亲自调用 H 的稳定 J/R/J/R 收据证明后再重读身份及完整旧任务，用 CAS 仅更改 state/revision：committed→completed，rolledBack→failed。不推断 cancelled；不执行、claim、取消或恢复文件操作。

CAS 异常只按原 task/admission 精确读回，完整 execution 必须恰为本次预期（revision=old+1，attempt/sequence/bytes/total不变），否则 NEEDS_RECOVERY；不重写或重执行。正常 CAS 回执也经后续 durable 任务复读确认。

已有 completed/failed 必须 attempt=1、revision>=3；双读完整稳定 journal 并核原 planDigest/完整plan/proposal/gameIdentity 与对应 committed/rolledBack，再核 admission/projection 未变。此分支不读 current receipt，因此合法后续 release 推进不会降级旧终态；不是仅见 completed 字样就相信成功。

同 proposal 单飞、不同 task 冲突；不同 proposal 可并发，active最多16，并非全链串行。seen最多1024轻 proposal 身份；wrongtask不会绑定错误task污染后续正确 durable 调用。close同步停接纳并等待全部 CAS/read-back，不能用取消抛弃未知写入。

纯 reducer 只修改 state/revision，拒不可能的 attempt/revision、非法状态、计数或 revision溢出；真实证据可信性属于主进程 service，不由 reducer 的调用成功代表授权。原错误统一脱敏，返回值分离克隆且输入清单/记录/回执受字节和数量限制。

## 本代理实际验证

固定 Node 的整仓 `tsc --noEmit` exit0；两源码 ESLint exit0，原始首版与最终日志本目录保留。最终 SHA 见 checks.json。独占测试代理运行真实有限7格，主协调统一全检；本报告不冒称本人运行测试或完整构建。

源码不含新依赖、网络或玩家文件操作，无 Git 提交。生产无配置/无executor及能力广告策略未改变。
