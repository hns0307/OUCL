# M passive任务视图：独立只读审查

2026-11-18，从L d02634b8后沿已批准A审查M。只新增本报告，未改source/tests/publicTargetKind/router/worker/schema，未启动full或native/GUI重复试验。

最终实读SHA256：

- task-views.ts：`724d96c2aa656ad18d6c433776d5af4b1fcfa22206766fa0636307ce4012c52e`。
- admission-record.ts：`40a6c6b179e0b5e181f5f4fadeeb011b5e60aee5664da627af0f0e7f1daf5c20`。

## 结论

**限定范围未发现剩余阻断，有限认可内部被动view/target provider。** 没有执行、结算、修复、恢复或文件操作端口，也不因此广告backend。固定root与目标归属由真实metadata读取，而不是renderer提交的revision或scope自证。

| 重点 | 最终源码判定 |
| --- | --- |
| readByTask | 先owner/file verify，再原validateStored完整有界全库审计，最后用已有unique task_id索引映射proposal并核回taskId。没有迁移schema，也没有假称省去16MiB累计审计/解析成本。 |
| startup barrier | get/list/targets都等待必需ready端口；只缓存同一startup Promise，失败固定UNAVAILABLE，不catch为[]/undefined，不在后续query里悄悄重试复活。future main必须实际注入startup对账barrier，类型Promise<void>本身不是对账证明。 |
| fixed root双核 | 构造root为小写UUID私有标量；真实readInstallation envelope/parseInstallation要求匹配root，结束再核revision及data digest。读取期间root切换不能返回旧root结果。 |
| 点读三侧 | readByTask strict admission；storage.get真实task；findAccepted用proposal/kind/inputDigest核request映射与相同task/execution。之后再读admission及task精确一致，才返回snapshot。projected缺task、错request映射或绑定不符NEEDS_RECOVERY。 |
| 不存在也审计 | 无admission不只凭get(undefined)返回：审真实readDistributionTaskProjections（其底层核requests/tasks双侧孤儿），校完整有界row/ID/kind，再复读readByTask。期间出现accepted为UNAVAILABLE，出现projected或不一致为NEEDS；仅稳定不存在才undefined。 |
| complete inventory | listAll完整global有界admission先strict parse/唯一ID、再取本root；任务inventory要求每row有同proposal/task/digest/admission，projected缺失或孤儿均拒。accepted/outbox在途UNAVAILABLE，不隐藏为伪空。两轮完整Bound集合及root稳定后才返回。 |
| target作用域 | targets先读真实InstanceRecord及其envelope，校summary.revision=envelope.revision、root/instanceId；完整root inventory审计后才按instanceId过滤；末次instance/root再核稳定。不能以筛选掩盖其他实例坏行。 |
| 历史revision | target行的instanceRevision来自原admission计划，不伪造为当前实例修订。current instance读回只证明当前注册作用域稳定；get/list允许删除实例后的历史任务，targets对不存在/错root实例OUT_OF_SCOPE。 |
| ports快照 | 点读admission在下一await前parse/snapshot；inventory两轮listAll先有界capture再await任务库。任务/安装/实例均在后续await前detached解析，不允许共享返回对象在await期间重写初始观察。 |
| query与关闭 | get同task、list、targets同instance分别coalesce；三类合计最多8个在途query，targets最多2，不增独立无限pool。list/targets共享同inflight inventory；close停新并while jobs排空，嵌套inventory也被追踪，不abort共享读或提前关闭Store。 |
| 真实state/错误 | Snapshot来自parseExecution的原state/revision/bytes及可选total；stage按DTO映射，不临时把running改needsRecovery。没有持久error来源时不编造error/许可详情。未知port/parse异常受控NEEDS，不漏raw message/path。 |

## 审查发现并已修正

1. 初稿get无admission且storage.get缺失时直接undefined，可漏掉requests中存在而tasks缺失的distribution孤儿。已补真实任务投影双表审计及末次admission复查；不把“没有task行”等同“没有请求身份”。
2. 初稿点读admission及两轮listAll结果在下一port await后才snapshot，共享返回对象可重写初始观察。最终均提前有界snapshot/parse，已只读复核。

原7格测试和后续同格补证由测试代理收存；本报告没有用修前摘要替代最终源码的测试结果，也未为两点再启动重复full。实现代理报告最终source typecheck/lint0，最终重编/主协调完整检查以其原始状态及日志为准。

## 保留边界

readByTask仍可能触发全16MiB审计；额外不存在分支也会审任务投影。本片仅安全被动读取，没有量测/承诺吞吐优化。8槽限制的是实际在途query，重复观察共享工作；不宣称已接入或扩展现有全局renderer观察pool。

两库复读是受控owner与调度下的稳定观察，不是跨库事务；发生变化保守拒绝，而非修复或篡改Execution。startup barrier及storage实际所有权由main受审装配负责，本片没有public接线或新能力广告。

后继仍需按已批准A接公共target kind/router、任务观察控制/受控result、durable queued取消与显式恢复、document facade/UI和真实配置准入。source/key/locator/许可政策空保持，不能用合成fixture授权产品分发。本报告现冻结，交主协调精确收存。
