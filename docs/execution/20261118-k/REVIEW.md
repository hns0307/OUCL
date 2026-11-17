# K任务终态落盘：独立只读审查

2026-11-18，J已f3c7fc9c完整保存后，沿持续批准A审查K。只新增本报告，未改source/tests，未启动full或native/GUI重复试验。范围为settlement.ts、纯task-settlement.ts及G/H/J和现有TaskTable.update必要调用链。

最终只读核验SHA256：

- src/core/distribution/task-settlement.ts：`2ea7756e0cfb7ad0d101b9556ae734c3fa1f276b82d3ad769e7856543acfd0fe`。
- src/services/distribution/settlement.ts：`f9b55aa971132c87bfd43551c5b70aace1de6f4da5cf1f8c4e09d59a16b7d9d9`。

上述与实现代理最终冻结摘要一致；已只读复核first attempt1/revision>=2、historical attempt1/revision>=3的最后guard。实现代理报告static通过，测试代理首轮7项通过；最终源码修订后的测试/全检以其最终原始日志为准，本审查不冒称自行运行或提前迁移旧摘要下的结果。

## 结论

**限定范围未发现剩余阻断，有限认可metadata-only任务终态结算。** 不新增schema/公共契约/生产广告，也没有claim、事务提交、文件恢复、取消或native执行端口。真实source/key/locator/许可仍空，不能据此开放configured backend。

| 重点 | 源码判定 |
| --- | --- |
| durable入站 | admission先bounded snapshot/strict parse，projected及root/proposal/task精确匹配；projection全量最多1024/4MiB前置预算、exact/root/kind/Execution与唯一ID，目标task/inputDigest精确绑定。 |
| 有start的首次结算 | 只允许running/needsRecovery、attempt===1、revision>=2，亲自调用H而不接收外部phase。queued/attempt0、重试attempt2、缺journal/错receipt方向均不写。 |
| 纯状态投影 | reducer只改state和revision+1；committed→completed，rolledBack→failed，不编造cancelled。保留attempt/sequence/bytes及可选total，拒非法数字、未知字段、非受支持state/phase及不可安全递增revision。 |
| CAS前稳定性 | H成功后复读完整admission/task，与初始snapshot精确一致后才计算期望StoredTask；updateTask沿当前真实expectedRevision CAS，不能覆盖其他进度。 |
| 未知ack | updateTask返回/抛错后仅精确读回原admission及目标projection；最终StoredTask必须等本次expected（含state/revision/attempt/sequence/bytes），不再写第二次、不换ID、不执行或claim。更晚修订也不会被当作本次精确ack。 |
| 已结算历史 | completed/failed需attempt1/revision>=3；稳定双读strict bound journal，phase对应committed/rolledBack，再复读admission/projection。该分支不读当前receipt，避免后继合法交易推进receipt使历史任务降级或回写。 |
| wrong-task不毒身份 | 只有成功读取并匹配真实durable record后才seen.add；错误task/proposal在此之前失败。active同proposal异task临时REQUEST_CONFLICT，工作settle后删除active，不永久绑定错误身份。 |
| 有界与关闭 | active最多16、seen最多1024不驱逐；同proposal/task共用在途工作、各caller detached结果。close停止新settle并等待全部CAS/read-back实际settle，不abort、不关闭共享Store，不把unknown commit当已取消。 |
| 受控错误 | 包含await historical在work try内，解析、port/CAS/历史错误均转固定NEEDS_RECOVERY，已定义本地错误码保留；没有向上转发native message/path。 |

## 明确边界

- 首次结算仍要求H的**当前**receipt精确方向；若在第一次K前已有合法后继交易推进receipt，将保守NEEDS_RECOVERY。已settled历史分支放宽的是重读要求，不是首次绕过H；未来调度应在每次J后及时K，不能臆造receipt祖先证明。
- historical信任私有metadata中已持久terminal task与不可变terminal journal的组合，不声称再次检查当前磁盘或真实许可，也不重执行文件。completed/failed不是任意caller传入的phase结果。
- 本片不补领域result/error持久格式、queued durable取消、task target观察/订阅、恢复控制或public facade。failed明确表示journal rolledBack的结算，不伪造用户取消原因；未知错误不能补造TaskSnapshot.error。
- TaskTable通用update是既有受控main-owned CAS端口，K自己从H推导目标Execution；不能让renderer直接选Execution，或用generic update冒充G fresh claim。
- 当前不为post-write已推进任务修订降级/重写。若CAS已提交但最后复读遇到损坏或其他不匹配，返回NEEDS_RECOVERY并保留现场，后续可按既有terminal记录走历史验证。

## 对J最终close修复的补充只读确认

J f3c7fc9c最终execution源码`01291d5042c39880bbbf60e22d930db38ebbe6d883920563fc2a6a7a5aba71a0`先同步启动admitted.close、发出所有legacy停止/abort，再await排空；无admitted时也不因await undefined推迟旧validator abort。原全检979/974PASS/1FAIL/4SKIP及修复重跑记录由J报告保留，最终J979/975PASS/0FAIL/4SKIP；这些不是K结果。J原REVIEW曾先冻结较早SHA，后继close修正以J源码/最终报告及本段为准。

双controller语义未使TooLate清理失效：Prepared原signal可在close中abort，至多撤销仍处于domain授权阶段的工作并沿原事务回滚；receipt commit许可开始前已结束domain授权，之后finish/rollback/release不接该signal。admitted执行期由transactions.cancel判TooLate，close仍await其真实result及coordinator jobs；不会把abort旧Prepared当作取消已提交receipt。K自身完全不发abort，保持metadata结算排空。

本报告仅只读结论，等待主协调最终整合检查/精确收存，不覆盖失败日志，不声明产品配置或游戏验收完成。
