# Admitted terminal只读checker

2026-11-17，G已保存6116daf0后沿持续批准A推进H。只新增`src/services/distribution/admitted-terminal.ts`及本目录，不改旧source/test/schema/public接线，不执行包或补授fresh claim，无Git提交。G/NEXT-EXECUTION仍是完整后继路线，本片只兑现其中metadata终态判定。

## API

```ts
readAdmittedTerminal(expectedRootId: string, admission: AdmissionRecord,
  ports: AdmittedTerminalPorts): Promise<AdmittedTerminalEvidence | undefined>
```

ports严格只含`journals:Pick<JournalRepository,'read'>`和`receipts:Pick<ReceiptRepository,'read'>`，没有write/commit/recover/release/execute/任务或网络端口。导出薄Evidence字段`{proposalId,taskId,planDigest,gameIdentity,phase:'committed'|'rolledBack',journalRevision,receiptRevision}`；不返回完整plan/receipt/fileproof。

所有输入错误、端口异常、解析/预算/绑定/稳定性/方向错误统一抛`DistributionAdmittedTerminalError`，code/message均固定`NEEDS_RECOVERY`，不转发底层message/path。stateless，无活动缓存或close资源。

## 严格顺序

1. expectedRootId严格小写UUID；admission先有界snapshot再parseAdmissionRecord，必须projected及plan.rootId匹配。
2. 顺序读取 **J1/R1/J2/R2**，每次await返回后立即做有界detached snapshot及strict parse，然后才进入下一await。即使无journal也四读。
3. Envelope字段exact `{revision,data}`；revision为安全正整数；data JSON UTF8不得超过既有MAX_RECORD_BYTES=4MiB，envelope及admission输入最多4MiB+128字节。undefined才代表记录不存在，null/额外字段/cycle/坏parse均拒绝。每份receipt.instanceId必须匹配原plan。
4. 两次journal及receipt均要求存在性、revision及data digest一致，拒绝混合代际。稳定无journal返回undefined；**不是fresh claim或执行许可**。
5. 已有journal必须strict parse，planDigest及完整plan等于admission.plan，txId等proposalId，gameIdentity.dev/ino逐字段等于admission.gameIdentity，且仅接受committed/rolledBack。prepared/applying/needsRecovery拒绝。
6. committed必须当前有效receipt revision精确为beforeReceiptRevision+1（加法结果仍为安全整数），且digest精确等于afterReceipt。rolledBack必须当前revision（不存在为0）等于beforeReceiptRevision，digest精确等于beforeReceipt；before=null只接受真正undefined。
7. 回执较新、错误或缺失方向均保守拒绝，不释放锁、不调用恢复、不按文件存在猜结果。

parseDistributionJournal本身负责文件操作/receipt确定性及committed最终stage校验；rolledBack stage保留原进度，不臆造全untouched约束。此checker证明历史私有metadata方向，不证明当前磁盘未被玩家后改，也不重新验证过期发行或重建domain session。

## 输入权威与能力边界

调用者仍必须先从真实Store取得durable admission并与任务projection匹配。journal schema没有taskId，本checker只能严格解析admission.taskId并回显，不能凭不存在的journal字段证明另一个合法taskUUID归属；该关联由上层admission/projection gate负责。checker不接受或产生新ID，不自行读取任务库。

当前只有每instance单一receipt，无历史receipt表；合法后继事务使receipt较新时本最小checker仍拒绝。未来若允许历史祖先须独立有界链证明，不能将revision更大直接当成功。J/R/J/R稳定复读仍需同root metadata所有权/调度约束，不能替代多writer环境的全局事务。

## 源码与证据

源码78行，固定父目录已装node执行整仓typecheck和本文件局部lint，均exit0：[状态](initial-status.json)、[type FD日志](typecheck-initial.log)、[lint FD日志](lint-initial.log)、[精确复现脚本](check.mjs)、[源码SHA](source-sha256.json)。独占静态根`D:/MC_start/OUCL/tmp/admitted-terminal-source-20261117-h`，默认沙箱，无pnpm/安装/网络/GUI/native重验。

冻结SHA256 `d8a9022585a8a9fdf0fff66eda5fb548d4951b53dc1fe59817c587bcc7297eb8`。独立测试代理负责复用真实签名/SQLite/OwnerGuard/native fixture的committed/rolledBack及端口注入反例，尚未收到其结果时本页不预记通过；整合fullchecks由主协调负责。生产仍no-port、真实source/key/许可政策空，本片不广告执行。
