# executeAdmitted最小后继设计与终态只读审查

2026-11-17。仅只读设计，依据D/NEXT-SERVICE、当前execution/transaction/store及G工作树claim接口；不代表实现完成、测试通过、生产已配置或执行能力已广告。本次只新增此文档，不改source/test/schema，不启动试验。A持续批准，真实source/key/locator/许可政策仍空。

## 当前实际数据与端口

- `AdmissionRecord`：formatVersion1、proposalId、taskId、inputDigest、完整plan、releaseSha256、gameIdentity{dev,ino}、previewFingerprint、phase accepted/projected、revision1/2。使用parseAdmissionRecord；proposalId=plan.txId，inputDigest由不可变意图计算。
- `DistributionPlan`：formatVersion1、txId/rootId/instanceId/instanceRevision、sourceId/packageId/packageVersion/sequence/manifestSha256/manifest，使用parseDistributionPlan及transactionDigest。
- `DistributionJournal`：formatVersion2、plan、planDigest、leaseToken、gameIdentity、phase prepared/applying/committed/rolledBack/needsRecovery、beforeReceiptRevision、beforeReceipt、afterReceipt、files[{operationIndex,old,fresh,stage}]、pending；使用parseDistributionJournal。
- `DistributionReceipt`：formatVersion1、instanceId、txId、planDigest、entries、releases；使用parseDistributionReceipt。私有库仅保存当前每instance一份receipt，没有独立receipt历史表；不得读取游戏目录receipt建立权威。
- `TransactionEnvelope<T>`：{revision,data}；`journals.read(txId)`、`receipts.read(instanceId)`；另有readAcceptedRelease({sourceId,packageId})及canRecover(txId,leaseToken)。
- `DistributionTaskProjection`：{proposalId,payloadDigest,task:{taskId,ownerId,kind,execution}}。Execution只有state/attempt/lastSequence/revision/bytesDone/可选bytesTotal，当前不含error或领域result；parseExecution严格解析。
- G工作树接口：`claimDistributionTask(expectedRootId,proposalId,payloadDigest,taskId):Promise<StoredTask>`，TaskTable/RecordStore/worker/client逐层绑定。只有pristine queued/attempt0/revision1/sequence0/bytes0/无total可原子start到running/attempt1/revision2。此处是源码接口描述，G测试结果另见其报告。
- 已有通用metadata `getTask(ownerId,taskId)`、`updateTask(ownerId,taskId,expectedRevision,execution)`提供读取/CAS；不能把generic update或公开入参当fresh claim替身。

## 最小执行入口与fresh claim

后继root-owned执行服务只接受已持久确认的proposal/task身份，自己读取admission及projection，严格匹配root、proposal、taskId、inputDigest、kind和实例修订；不得接受renderer传入plan/fingerprint/路径/fresh标志。Coordinator当前options.store的Pick不含admissions；若新增executeAdmitted，应明确增加durable read-back端口或由受审root服务完成后传内部证明，不把任意typed对象当权威。

无journal首次执行必须先取得**本次调用成功返回的fresh claim**。只把当前私有调用控制流内的成功响应作为一次启动许可，不缓存可重用许可，不从之前running快照、attempt1/revision2、taskId存在或generic read-back补授。claim超时/拒绝即使实际上commit，仍不得开始文件操作；重试必须保守needsRecovery，不造新ID或重置queued。

同task/proposal的执行与legacy confirm/recover必须互斥；root级metadata接纳/对账继续沿F lane，扫描/事务沿已有单flight，不让新admission穿插对账快照。active/seen/job预算仍需覆盖等待与退役工作，不能只移除map就认为IO退出。

## 无journal分支

1. 只有本次fresh claim可以进入；从重启、丢ack或任意read发现的running+无journal一律NEEDS_RECOVERY。无journal不证明从未stage：当前事务在写prepared journal前会copy artifact到私有staging，残留staging必须保留并拒绝，不递归清空后盲重做。
2. 当前target/root/instance/revision/environment、完整snapshot.fingerprint和实际game目录dev/ino必须等于admission中的原准备事实；不能重扫后改写基线或收编外部文件。
3. 重新验证当前accepted release hash必须等于admission.releaseSha256，完整plan/sequence/manifest、pins/签名/time、真实domain/JAR/环境/许可及isIdle均满足。票据或projected不是执行许可，旧回执恢复不重新授执行。
4. 只commit原plan，factory必须把**admission.gameIdentity作为expectedRoot**贯穿native物化。现commit首次调用createFiles(gameDir,txId)没有传expectedRoot；单次事前lstat不能覆盖后续换根窗口，应新增明确传递/受控闭包绑定，不能只在提交后比较journal。
5. factory实际签名已有`createFiles(gameDir,txId,expectedRoot?)`；恢复现已传journal.gameIdentity，首次执行也须绑定原admission身份。产品不得回退到cooperative Node mutation默认适配器。

## 已有journal分支与严格终态验证

prepared/applying/needsRecovery均不自动执行或恢复：返回NEEDS_RECOVERY，交显式recover，恢复必须满足新metadata owner、精确原lease和receipt方向。原事务recover可能释放锁或写journal，不能作为“纯只读查询”。

终态checker只读私有metadata：先严格解析envelope与journal，校j.planDigest===transactionDigest(admission.plan)、j.plan完整同admission.plan、j.plan.txId===proposalId、j.gameIdentity逐字段等于admission.gameIdentity。不能仅凭phase或文件存在认定完成。

| journal终态 | 当前私有receipt必须满足 |
| --- | --- |
| committed | 存在有效receipt；revision精确等于beforeReceiptRevision+1；parse后digest精确等于j.afterReceipt |
| rolledBack | revision（无record按0）精确等于beforeReceiptRevision；digest(current?.data??null)精确等于j.beforeReceipt；before=null只接受真正无record |

parseDistributionJournal已约束committed最终stage为fresh→published、remove→backedUp且pending=null；rolledBack仅pending=null，rollback保留原执行stage，不能误要求其全untouched。任一错方向/未知receipt/绑定不符→NEEDS_RECOVERY，不调用commit/recover/release，不修改现场。

现`transactions.commit(plan)`的旧终态早返回只parse+核planDigest；`recover()`终态仅在锁文本恰为原lease时额外校ledger然后release。两者均不能直接替代上述admission-bound、无副作用checker。

## 稳定复读与历史限制

journals.read与receipts.read是分离async API，不能假设跨调用同一SQLite快照。最小实现沿同root独占lane读取J1/R1/J2/R2，立即snapshot/strict parse，并要求两次journal和receipt的envelope revision及data digest都一致；发生任何变化拒绝，不把混合代际拼成证据。若改成store内部同事务terminalEvidence读取，应另明确端口，不需迁移schema。

合法后续事务也会推进当前单一receipt；“当前revision更大”本身不能证明旧journal的afterReceipt是祖先。最小严格模式遇到较新receipt仍保守拒绝；允许历史祖先需要另做有界journal链证明，不能臆造现有receipt历史API。F确认服务仅恢复真实task快照，不应被误当executeAdmitted终态证明。终态metadata只证明历史提交/回滚，不承诺玩家后来未改磁盘，也不应重新跑domain收编新session或要求历史发行仍未过期。

## 生命周期与状态后继缺项

fresh claim不是任务完成；后继仍需持久记录执行的合法state/attempt/sequence/revision转换、终态结果/受控错误，以及原tasks target/get/list/control/subscribe观察。现Execution没有领域error/result，不可在公共snapshot补造信息或用kind=mod-install替代。

取消：提交许可前沿原signal/事务cancel回滚，receipt commit开始后TooLate；清理/finish/rollback/recover不能接取消。close阻止新执行、请求可撤销阶段停止并真实drain；不能取消未知metadata commit或强行终止清理。queued取消、running无journal、partial journal、已committed的控制语义及异常持久化仍须各自实现验证。

建议后继最小验证：fresh claim成功才触发一次native事务；claim commit丢ack不写文件；无journal running拒绝；错planDigest/gameIdentity/receipt方向拒绝且无mutation；terminal严格读回不执行；domain await中外改和root替换拒绝；close/cancel/commit边界及真实worker状态回执。以上均为计划，本页没有新增测试或通过结论。
