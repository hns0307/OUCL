# N6 公共执行首片方案（A已批准，实施中）

2026-11-17。G2已实现并验证内部v2签名发行、私有SQLite权威、native事务及恢复；**不等于新增公共IPC、任务持久格式或产品执行已获批准**。本页仅供具体评审，不修改契约源码、DECISIONS或批准记录。

## 选择

| 方案 | 范围 | 取舍 |
| --- | --- | --- |
| A（推荐） | 独立 `distribution.execute.v1` 能力，v2发行准备/确认、持久执行任务、原任务中心观察和显式恢复 | 与只读preview隔离；先接一条受控执行链，配置缺失时禁用 |
| B | 保持现有只读入口，继续内部工具验证，延期所有公共执行 | 无新增公共/存储审批，但没有产品安装闭环 |

建议批准A的精确契约与持久接纳设计后实施；真实source/key仍留空，不因此虚构可用发行或开放任意URL。制品映射、真实JAR/环境/许可验证未完成时，只允许展示禁用入口，不用测试端口代替准入。

## 候选公共契约（以下字段尚未实施）

复用外层 `Req<P>={contractVersion:1,requestId:UUID,payload:P}`；响应为 `{contractVersion:1,requestId,ok:true,data:T}` 或 `{...,ok:false,error:{category,code,messageKey,retryable,traceId}}`。全部exact schema；UUID规范小写，包/版本/source沿现有DISTRIBUTION_ID，未来版本和额外字段拒绝。

```typescript
type Binding = { rootId: UUID; instanceId: UUID; sourceId: ID; packageId: ID; packageVersion: ID };
type Proposal = Binding & { proposalId: UUID; sequence: number; instanceRevision: number;
  expiresAt: number; changes: { area: Area; path: RelativePath; kind:'add'|'replace'|'remove' }[];
  conflicts: { area: Area; path: RelativePath; code:'EXISTS'|'UNMANAGED'|'CHANGED' }[] };
type Preparation = { prepareRequestId: UUID; state:'pending'|'ready'|'failed'|'cancelled'|'expired';
  proposal: Proposal|null; error: PublicError|null };
type Accepted = { taskId: UUID; proposalId: UUID; snapshot: TaskSnapshot };
type Recovery = { taskId: UUID; recoveryRequestId: UUID; snapshot: TaskSnapshot };
```

Area仅mods/resourcepacks/config，操作上限256、单路径1024字符、单响应1MiB；现有config的replace/remove仍拒绝。DTO不返回路径根、原始manifest/URL/key、lease、文件inode或journal。Preparation约束：ready仅proposal非null，failed仅error非null，其余二者均null。

| 候选通道 | 精确payload → data | IPC预算 |
| --- | --- | --- |
| `distribution:prepareExecution` | `Binding` → `Preparation`（立即接纳pending，后台有限准备） | 3秒；准备总预算120秒 |
| `distribution:executionPreparation` | `{prepareRequestId}` → `Preparation` | 3秒；只查询原身份 |
| `distribution:cancelExecutionPreparation` | `{prepareRequestId}` → `{cancelled:boolean}` | 3秒；只取消准备，不取消已接纳task |
| `distribution:confirmExecution` | `{proposalId,instanceRevision,sequence}` → `Accepted` | 3秒；只接纳持久任务，不等待文件提交 |
| `distribution:recoverExecution` | `{taskId}` → `Recovery` | 3秒；接纳原journal对应恢复，不新造安装计划 |

所有方法沿可信主窗口/精确文档/main-frame/sender验证；能力只在metadata owner、权威任务存储、验证过的native helper、受审source/key和制品/领域校验端口均就绪时广告。配置为空则不广告execute，任何强行调用返回SOURCE_UNAVAILABLE，且不读取target、扫描磁盘或发起网络。

## 生命周期、错误与观察

- prepareRequestId绑定文档与Binding摘要；同ID同输入查询原结果，异输入REQUEST_CONFLICT。准备最多16活跃、1024已见身份；提案从首次接纳起最多5分钟且不超过发行expiresAt。过期保留轻量tombstone，本document不驱逐再执行，容量满返回CAPACITY_EXCEEDED。
- 文档重载/关闭取消未确认准备并清本document观察；准备未持久确认，不跨文档复活。confirm只接受本document真实ready且无冲突提案，复核快照、root identity、环境、签名/有效期/高水位及真实领域条件。
- confirmRequestId与proposalId的确认关系和taskId必须先持久原子接纳；同提案/同确认身份返回原task，异输入冲突。响应TIMEOUT表示未知，按原确认ID重试恢复回执；禁止生成新ID盲重做。
- 接纳后由 `tasks:get/list/control/subscribe` 观察/取消，任务kind新增`distribution-install`。只支持cancel，不广告pause/resume；退订只停止观察。提交许可后返回CANCEL_TOO_LATE，结果不明进入needsRecovery。
- 订阅沿现有 `{subscriptionId,snapshot,seq}` 与 `events:task` 的seq/revision单调保护、afterSeq重连及events:unsubscribe；单条1MiB、原观察池预算不扩大。状态查询/订阅/取消各3秒，断线不变更执行态，切root/实例后迟到数据不覆盖新目标。
- 错误候选：沿现有INVALID_ARGUMENT/INVALID_SENDER/UNSUPPORTED_CONTRACT/TIMEOUT/UNAVAILABLE；新增SOURCE_UNAVAILABLE、UNTRUSTED_DISTRIBUTION、RELEASE_EXPIRED、RELEASE_DOWNGRADE、RELEASE_EQUIVOCATION、PROPOSAL_EXPIRED、REQUEST_CONFLICT、CAPACITY_EXCEEDED；复用FILES_CHANGED、INSTANCE_BUSY、CANCELLED、CANCEL_TOO_LATE、NEEDS_RECOVERY。认证/权限失败不可重试；未知IO脱敏，不向renderer转发底层堆栈。

## 必须单独批准的持久化与装配变化

1. 下载任务SQLite适配扩展 `distribution-install` 的kind、实例目标归属和受控错误/结果；同时更新task-targets kinds/schema、worker协议与任务中心，不把现有mod-install强行复用为通用包任务。
2. 权威distribution库新增版本化confirmation admission记录：`confirmRequestId/proposalId/inputDigest/taskId/txId/binding/releaseSha256/phase`，明确唯一约束及修订；不把内存proposal或游戏目录receipt当权威。
3. 两库不能假定一次事务：建议distribution库先提交唯一接纳记录及outbox，再幂等投影同taskId到任务库；重开先对账接纳/outbox/journal/receipt再恢复观察。未知/冲突记录停写needsRecovery，禁止在途未确认自动执行。
4. recover仅基于真实旧journal、新metadata owner、原gameIdentity/lease与当前receipt方向；复用原txId，并记录恢复请求幂等结果。task completed仅代表权威receipt/journal完成，不表示游戏菜单验收。
5. 固定受审trust snapshot；变更前停止新接纳并close/drain旧coordinator，再启用新配置，无renderer热改pins入口。main只装配受保护helper工厂，内部cooperative/test adapter不得用于产品执行。

首片验证须覆盖：严格IPC/伪sender、配置空failclosed、迟到/超时原ID恢复、重复确认单task、双库接纳回执丢失与对账、取消提交边界、跨owner恢复、真实native路径与UI状态。既有844项回归或内部authority证据不能替代这些新增公共层级验证。

**草案形成时状态：PROPOSAL / NOT_IMPLEMENTED；最新状态：A APPROVED / IMPLEMENTING。** 先评审以上字段、预算、任务kind及两库接纳/outbox协议；用户明确批准并记录具体范围后，才进入公共实现。此文档不改变历史批准或真实配置留空状态。


2026-11-17批准后继：用户阅读说明后明确“批准”，选定方案A，详情已记录TASK_PLAN/DECISIONS。本页上文关于未批准的表述保留为草案历史，不覆盖本次批准；实现进度以execution/20261117-a记录为准。配置空时不开放执行、不用fixture政策冒充真实政策的约束不变。
