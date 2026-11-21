# N6 内部执行请求生命周期修复

2026-11-16，基线main `ceed2dc1`。先读TASK_PLAN、DECISIONS、20261116/CHECKPOINT；用户持续执行授权及来源/公钥留空约束继续有效。仅修改 `src/services/distribution/execution.ts`、`tests/distribution-execution.test.ts` 与本报告；没有公共IPC/UI、依赖、store/release协议变化或Git提交。

## 本次行为

旧coordinator把每个request的大提案、已失败Promise、已完成journal永久放在同一个16项Map，终态/失败/过期也占active额度。本次将可执行活跃请求、实际未settle作业、轻量终态身份分开：

- 默认最多16个active身份、1024个本document/session内已见身份，提案TTL默认5分钟。`options.lifecycle` 可供内部测试注入更小上限与TTL；active不能超过16、seen不能超过4096且不能小于active，TTL为1—300000ms。
- active保留正在build/确认的Promise、controller、提案/计划及快照指纹；成功、失败、取消或过期后释放这些大对象引用。终态tombstone只保留请求digest与受控失败码，或已完成tx的planDigest/phase。未知内部错误压缩为固定失败码，不保留原堆栈、路径或任意错误文本。
- tombstone直到coordinator/document结束都不被驱逐。已见ID同输入不产生第二次build/下载/执行，异输入始终INVALID_TRANSACTION；达到seen总预算明确拒绝新ID，不能通过LRU驱逐旧ID换取空间后重新执行。
- 失败重试返回原受控失败，取消重试返回CANCELLED，过期返回明确EXPIRED。完成后prepare返回FINISHED；重复confirm从权威journal只读恢复同planDigest/phase结果，不再保存大journal于内存。并发重复confirm共享一次权威读取，分别返回克隆结果。
- active满的未接纳新ID没有效果，可以在已有active终结后重新申请；seen满则必须结束旧document/coordinator并按新文档身份协议重建，不能重置旧会话内的身份记录。跨document的真实事务仍由持久journal/UUID幂等约束。

TTL从首次接纳开始，不因重复调用延长；实际deadline还取签名发行expiresAt较早者。清理在API入口和异步阶段检查时进行，没有后台定时器。未进入事务的过期身份会abort并留下tombstone；即使底层可信端口不响应abort，未settle作业仍占active预算，不能利用TTL不断制造新悬挂IO。正在确认的前置阶段仍检查deadline；已进入事务的操作不因提案TTL而擅自中止提交许可。

close同步停止新接纳、合并为幂等Promise；未入事务者中止controller，事务执行者通过正式cancel检查提交边界，之后drain全部已启动作业（含完成结果重读和recover）才清理会话引用。提交后cancel仍CANCEL_TOO_LATE。close不伪装能强制中断一个永不settle且不支持取消的可信端口；此时保留active预算并等待真实收尾，不能先关闭权威库冒充完成。

## 内部API增量

新增 `DistributionExecutionLifecycleError`，code为：

| code | 含义 |
| --- | --- |
| EXECUTION_ACTIVE_LIMIT | 真实活跃身份/未收尾作业已满，未接纳本次新ID |
| EXECUTION_IDENTITY_LIMIT | 当前document已见身份总预算耗尽，旧ID仍保留 |
| EXECUTION_REQUEST_EXPIRED | 该已见身份已过期，不能重新生成效果 |
| EXECUTION_REQUEST_FINISHED | 该prepare身份已经结束；成功结果可按原ID只读confirm查询 |
| EXECUTION_REQUEST_FAILED | 无受控类型的内部失败被脱敏固定化，原ID不重新执行 |

未新增公共错误schema；未来公共接线必须显式映射以上语义，而不是全部显示为执行失败。原expiry测试从泛FILES_CHANGED改为新的明确EXPIRED契约，其他安全断言没有放宽或跳过。

另外按主协调新增的事务工厂端口，options可传 `createFiles(gameDir,txId,expectedRoot?)`，仅在存在时用条件spread转发给内部transaction。持久恢复的expectedRoot来自主协调新增v2 journal；此工厂由main受控装配，renderer不提供实现或目录身份。默认cooperative适配仅用于内部测试，未来公共执行仍须完成原生guard准入。

## 目录namespace绑定

prepare/confirm快照新增对gameDir本身的 `lstat({bigint:true})` dev/ino身份。前后均检查普通目录、非符号链接和受控祖先，前后身份一致后再将字符串化dev/ino纳入fingerprint。用户把旧空gameDir改名并在同路径建立另一个空目录，即使path/版本/文件列表看似相同也会使confirm拒绝，不向新目录发布文件。

这不代替后续原生同handle目录guard，也不宣称Node路径观察消除了检查与后续IO的竞争；持久journal/recover原namespace绑定及native per-op guard由主协调在其独占事务文件中实现。

## 动态trust评估与本轮选择

主协调明确采用 **A：固定受审trust snapshot** 作为本轮产品接线方向。配置只能在启动时或旧coordinator完成close/drain后启用；没有运行中renderer修改pins入口。配置更新应先停止旧会话新接纳，表示“待生效”，已进入receipt提交许可的操作允许按原快照收尾，drain完成后才激活新配置并创建新coordinator。生效边界清楚，不能将尚未生效的更新说成旧提交已被撤销。

`readSources` 保留为内部受控测试端口，现有测试仍覆盖prepare后/validate等待后的撤销拒绝；不将它称为跨文件系统与SQLite提交的原子热撤销。未来若选择B严格热更新，应将受审配置摘要和单调trustGeneration持久化，与archive/proposal及receipt同一事务比较，并使配置激活走同一owner提交门禁；单纯在await后重新读pins不足。本轮不实施B、不新增store generation/schema，也不覆写历史批准记录。

## 实际验证

独占根 `D:/MC_start/OUCL/tmp/execution-lifecycle-v2-final-20261116-r2`；esbuild bundle当前 `distribution-execution.test.ts` 后执行Node内置测试，在主协调journal v2/目录identity及createFiles端口集成后实际 **21 PASS / 0 FAIL / 0 SKIP，exit0**。在原12项基础上验证：

- 24次失败跨过旧active上限，失败tombstone重复/异输入/seen总容量；空sources时target/fetch/validate一直为0。
- ready提案TTL释放槽位、旧ID重复调用/确认明确过期、取消后不重新build；active容量拒绝不产生效果。
- 过期但仍悬挂的旧target读取继续占active，释放后不晚启动网络。
- 并发重复prepare只一次网络效果；21次正常prepare/cancel不再被旧16项终态累计阻断。
- 未知validator失败固定化后恢复环境也不能重用旧ID，新的ID可以推进。
- close对确认前置/prepare阶段均真实drain gate；提交后取消拒绝；completed在seen上限下并发重复confirm仍只读返回同journal，receipt revision保持1。
- 真实rename原空gameDir并mkdir同路径新目录后，confirm拒绝，新旧目录都没有写入。

局部ESLint最终exit0；生命周期源码完成后的整仓 `tsc --noEmit` 曾exit0，主协调事务v2测试并行改动后的最新检查仅报 `tests/distribution-transaction.test.ts:248` 的fixture `allowRecovery` 方法不存在，已通知该文件所有者收尾，本子任务未越权修改。主协调最终统一类型与完整回归另记。测试仍使用真实临时Ed25519、SQLite与普通文件；合成文字制品不是合法JAR、许可或游戏验证。没有全量回归、真实来源、公网、GUI或正式EXE替换，原WIP保持。
