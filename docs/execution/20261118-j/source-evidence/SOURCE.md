# J admitted executor 源码范围

新增 `admitted-execution.ts`，在 Coordinator 增加可选 main-owned `admitted` ports 与 `executeAdmitted(proposalId,taskId): Promise<AdmittedTerminalEvidence>`。旧调用方无此 ports 时保持 legacy 路径，新 API 拒绝 NEEDS_RECOVERY。生产装配与公共广告未改变。

rootId 构造时复制固定标量。首次执行从真实 admission/projection 解析原 plan/root/proposal/task/inputDigest；H 终态仅在 projection 有非 queued 且 attempt>=1 的启动证据时返回，并重读 admission/projection 防变化。无 journal 不代表首次许可，partial H 直接拒绝。

首次执行要求 injected factory 存在，原始 snapshot fingerprint/gameIdentity 精确一致；snapshot 前后实际 isIdle。完整 admission/projection 与 snapshot 在当前 key/time/domain、原 releaseSha256/high-water 复验前后重读；只有本方法亲自获得 claim 的成功 acknowledgement，且完整返回 tuple 为 running/attempt1/revision2/sequence0/bytes0/noTotal 才可继续。claim 后再重复原事实/当前 authority 检查，再走 I `commitFreshBound`。unknown acknowledgement 不读回补许可，失败留下 running/needsRecovery，不重置 queued。

本片不更新 task 终态或结果：正常返回历史 committed evidence 后任务仍 running，后继 K 负责持久观察结果；不能把 evidence 当已完成的 TaskSnapshot。

同步单飞槽限制为一项；同 proposal/task 共用工作，其他调用拒绝，seen 最多1024轻身份。纳入原 Coordinator jobs；prepare/ticket/legacy confirm/recover 与 admitted 从 claim 前双向互斥，不因已完成 ready 缓存阻塞。cancel 在事务前 abort 本 job，事务开始后委托事务 TooLate 门禁；close 等实际 settlement，不中断 commit/cleanup。

独立审查确定的分类问题已修复：fresh-bound 调用后的终态 H 读回/metadata 未知错误始终 NEEDS_RECOVERY，不被并发 close 转成 CANCELLED；仅执行前未知错误加 abort/close 才归取消。可信 ReleaseError 保留，未知异常不输出原始消息。输入与回执 clone 有字节限额，完整事实精确 digest 比较可能保守拒等价字段重排，不产生假成功。

## 验证与冻结

本代理仅运行固定 Node 的整仓 `tsc --noEmit` 及两个源码文件 ESLint，最终均 exit0；原始日志 typecheck-final.log/lint-final.log，首版静态日志独立保留。独占测试代理运行真实 SQLite/worker/native/JAR 有限专项，主协调运行全检；本文不冒称本人已跑专项或完整回归。

源码摘要见 checks.json。未修改旧测试、依赖、IPC/schema、主进程产品装配或任务状态更新，无 Git 提交。真实 sources/keys/locator/平台许可配置仍由主协调保持空，测试合成 policy 不构成产品配置。

全检首轮另发现旧close同步撤销回归：await undefined引入微任务yield。已改为同步发起admitted close并立即遍历abort全部legacy准备，执行中cancel仅收集promise；全部撤销发出后才join与jobs drain。旧测试断言未改，首轮完整失败证据由主协调保留；最终source摘要随checks.json刷新。

