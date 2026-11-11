# T1：按实例查询任务目标（供明确批准的冻结候选）

日期：2026-11-10。状态：**REVIEW_READY / PENDING_APPROVAL**。这是P-B的U05具体设计，不是已批准的新接口，也不是产品修复交付。

## 1. 请求批准的最小范围

推荐方案B：新增只读能力`task-targets.v1`及`task-targets:listForInstance`，首片仅`mod-check`与`mod-install`。增加一个私有worker只读命令与必要的接纳读取屏障，从既有SQL/JSON证明投影归属；私有ready增加可选固定能力标记；不新存一份目标映射，不改tasks.v1的exact快照/get/事件，不增加依赖或SQL/JSON持久格式。接入ModPanel的准确活动目标与重开读取，保留原任务控制和观察安全边界。

备选方案A：直接升级六域TaskSnapshot到tasks.v2、每个事件携带联合target。统一性较好，但安装/资源/游戏及全部事件迁移面明显更大，本片不推荐。

批准方案B只允许本文件§2–9的范围；不包含持久暂停、恢复写入、实例维护、账号、联机或后台。本文件和可运行候选保留在本包；批准之前不修改生产注册/能力广告/schema。

## 2. 已核实的现状及复用点

| 来源 | 真实事实 | T1取舍 |
| --- | --- | --- |
| src/ui/ModPanel.tsx 初始化effect | 全域任务中取第一个非终态mod-check；只有读历史report时检查instanceId | 实例B可选到A活动任务的既有U05夹具仍成立；不得保留该全域回退 |
| storage/mod-jobs.ts | ModJobs含rootId；每条taskId/requestId/payloadDigest/instanceId/instanceRevision/mode；1000上限、case-insensitive重复身份拒绝 | 复用目标来源，校验与SQL接纳对应，不新增索引 |
| mods/tasks.ts admit/save | canonical `{instanceId,expectedRevision,mode}`作SHA256；SQL accept后save目标记录，再开始job | 读取必须跨过接纳保存间隙，不能只查内存jobs |
| storage/tasks.ts | requests绑定owner/request/kind/digest/task；findAccepted是只读查询；modConfirmations有1000上限 | 复用接纳证明；新SQL仅受控SELECT库存，不加表/列 |
| workers/entry.ts mod-confirm:list | **已逐项读取并校验plan root/request/status=preview/state=ready和modConfirmationDigest** | 不把这些保护再列为缺失；新增投影复用同样证明，不降低校验 |
| storage/mod-plans.ts 与 mods/plan-identity.ts | parseStoredModPlan复验输入/计划摘要和目标；modConfirmationDigest绑定planRequestId、planId、confirmed:true | 通过原计划确定mod-install目标，不把planRequestId当实例UUID |
| mods/tasks.ts taskView、mods/install-tasks.ts get/taskView | 已有lost/needsRecovery的领域投影，且两域revision处理不同 | 提取并复用其投影，不能另造状态或重做seq/revision规则 |
| workers/entry.ts storage() | 整条命令由tail串行执行 | 新读命令可取得一个受控读取切面，不需要新数据库或新线程 |

现有task列表无可靠时间戳；ModJobs更新会移动记录位置，确认SQL按request UUID排序。**不能保证列表是接纳时间顺序**。T1使用确定性排序，不把“倒序第一个”称最新任务/最新报告。

## 3. 公共契约的精确形状

能力：`task-targets.v1`。通道：`task-targets:listForInstance`。以下对象均exact，拒绝路径、URL、SQL、rootId、额外字段；嵌套复用现有TaskSnapshot与InstanceError严格验证。

```ts
type TargetKind = 'mod-check' | 'mod-install';
interface Query {
  instanceId: string; // UUID；比较时转小写
  kinds: TargetKind[]; // 长度1..2，不重复；顺序不改变过滤集合
  limit: number; // safe integer，1..100
  cursor?: string; // opaque UUID；不得解析成offset/路径
}
interface Request { contractVersion: 1; requestId: string; payload: Query }
interface Row {
  instanceId: string; // 响应小写，必须等于请求目标
  instanceRevision: number; // safe integer >=1；接纳时目标修订
  task: TaskSnapshot; // 仅请求的两类之一；taskId小写
}
type Result =
  | { contractVersion: 1; requestId: string; ok: true;
      data: { items: Row[]; nextCursor?: string } }
  | { contractVersion: 1; requestId: string; ok: false; error: TargetError };
```

requestId按原字符串相关，不把另一个请求的回执当本次成功。items不超过请求limit/100，taskId去重；每行必须属于同一请求目标且kind包含于kinds。nextCursor仅允许非空页出现；空页不能带游标。data的UTF-8序列化上限1MiB。instanceRevision是历史接纳事实，不能冒充当前实例revision或赋予写权限；任务progress revision与它分开。

公开接口不增加total、timestamp、planId、requestId前驱关系或action字段。排序固定为`kind`、再小写taskId的ASCII升序，明确不是时间顺序；ModPanel不据此宣布某报告“最新”。

## 4. 固定错误表

复用既有InstanceError的code/category/messageKey/retryable/traceId exact形状；只允许下表，不创建任意details、堆栈或内部路径。

| code | category | messageKey | retryable | 使用情形 |
| --- | --- | --- | --- | --- |
| INVALID_ARGUMENT | validation | invalidArgument | false | extra字段、非法UUID/kinds/limit/cursor |
| UNSUPPORTED_CONTRACT | validation | unsupportedContract | false | 可识别但未来公共版本 |
| INVALID_SENDER | permission | invalidSender | false | 非受信主frame/来源或sender代次失效 |
| OUT_OF_SCOPE | permission | invalidSender | false | 未知/其他根实例，或游标属于其他sender |
| ROOT_UNAVAILABLE | disk | rootUnavailable | true | 首次查询时注册根不可用/在读取间改变 |
| TASK_STORE_UNAVAILABLE | disk | unavailable | true | worker/存储IO或响应体规模无法可靠取得 |
| NEEDS_RECOVERY | disk | unavailable | false | 接纳/目标证明缺失、身份矛盾或未知格式；不是自动恢复命令 |
| CURSOR_EXPIRED | biz | unavailable | true | 过期/逐出、过滤目标不匹配、根代次改变的游标 |
| TIMEOUT | system | timeout | true | 只读等待超过期限，业务状态仍未知 |
| UNAVAILABLE | system | unavailable | true | 能力未装配/读接纳预算耗尽/响应不合法 |

映射值沿用instances.ts实际表。traceId是UUID，错误字符串来自固定文案，不接受worker异常原文。未列出的业务INSTALL_FAILED、SCAN_FAILED等不由目标查询合成；原任务snapshot.error仍由现有领域投影产生。

## 5. 主进程/worker读取顺序与持久证明

### 5.1 一条新的私有只读命令

推荐新增StorageCommand：

```ts
{ kind: 'mod-targets:read', rootId: UUID, rootRevision: PositiveSafeInt,
  instanceId: UUID, kinds: NonEmptyUniqueTargetKindArray }
```

rootId/rootRevision由可信main先读取installation envelope取得，不从renderer接收。response沿现有worker v1关联信封，仅新增一个可选结果字段`modTargets`：

```ts
{ rootId: UUID, rootRevision: PositiveSafeInt,
  items: Array<{ instanceId: UUID, instanceRevision: PositiveSafeInt, task: StoredTask }> }
```

所有嵌套exact，最多2000行且每域最多1000，响应UTF-8最多2MiB；超限不能截断假成功。新WorkerCode仅需两个固定值：`TARGET_ROOT_CHANGED`（main首次映射ROOT_UNAVAILABLE，续页映射CURSOR_EXPIRED）、`TARGET_OUT_OF_SCOPE`（映射OUT_OF_SCOPE）。已有INVALID_RECORD/证据矛盾映射NEEDS_RECOVERY，STORAGE_IO/WORKER_FAILED/FILE_TOO_LARGE/QUEUE_FULL映射TASK_STORE_UNAVAILABLE，TIMEOUT保持TIMEOUT。不把这些私有code直接透传renderer。

worker在现有tail内读取当前installation和目标instance记录，核对rootId、root envelope revision与实例所属根；未知/不存在目标与其他根均同样拒绝，不泄露其他根是否存在。目标实例不必ready，因为历史failed/needsRecovery仍可读；不存在实例的历史检索留给未来生命周期方案。

查询本身不调用accept/update/recover/initialize、也不创建接纳记录/迁移/删除证据。服务初始化沿原产品启动流程完成；T1不通过“读查询”修复存储。

### 5.2 mod-check证明链

在requests/tasks两表作固定两域SELECT库存（owner=root、kind白名单、受控LIMIT），双向检查任务/接纳：tasks存在但缺requests、requests存在但缺tasks、kind/owner/taskId不对应均停读；不能仅扫描requests而漏掉孤立tasks。每行经TaskTable现有类型/执行验证，无任意SQL输入。每域超过1000停读。

对mod-check，ModJobs整体格式/根/重复身份先校验；requested域内SQL接纳与索引双向一一对应：

- taskId、requestId、kind、task.ownerId对应；SQLpayloadDigest等于job.payloadDigest。
- 按实际admit顺序构造`{instanceId: lowerUUID, expectedRevision: instanceRevision, mode}`并SHA256，再核对digest。
- SQL有任务但无目标索引、或索引有任务但SQL接纳缺失，均不当作“实例没有任务”。

不只从completed report推目标；queued/running/failed/cancelled/needsRecovery均用相同不可变身份链。mode、原请求ID、digest不公开。

### 5.3 mod-install证明链

沿requests中mod-install接纳找到planRequestId，复用现有mod-confirm:list的证明与parseStoredModPlan：root、request、preview/ready及modConfirmationDigest均对应。再取plan.instanceId/instanceRevision；不依赖当前内存active或只有结束时才存在的result。

读取结果/事务不是确定目标的前提。若原领域已经判定needsRecovery，保留该snapshot；本查询不因为一份committed文件自行把任务改completed，也不启动recover。缺失计划即使属于另一个实例，也因无法证明它无关而阻断所请求的mod-install域，不返回看似完整的部分页；未请求的域不读其索引/计划。

### 5.4 接纳屏障与公共投影

ModTaskService新增可信内部的串行读取入口，将“目标读取”加入同一admissions链：先等待此前SQL接纳+索引保存完成，在当前读命令入worker并完成前，后续Mod检查接纳不能越过。不能仅await一次旧tail后放任新admit抢入间隙。读失败也须释放该串行槽，不阻断后续原业务；没有抢占其他锁。

mod-install的目标计划在接纳前已持久且不可变，结合worker tail可使用其接纳切面；无需为只读查询修改确认事务或新建全局业务锁。

worker一次返回目标bindings，main让两域复用提取后的原snapshot投影（含live/lost覆盖），避免每行再次跨worker get/读plan造成N次往返。公共snapshot不得低于binding的持久execution revision，也不能换kind/task。当前ModTaskService和ModInstallTaskService的lost修订逻辑照原实现复用，不新增seq事件或改变任务状态机。

根/installation revision在返回前再核对，sender代次在受理、await后及保存游标前核对。这个列表是读取事实，不承诺与后续控制操作原子；控制任务继续使用现有main权限及新鲜状态检查。

## 6. 分页、预算和生命周期

- 第一次读取按确定性排序形成不可变投影快照。每域<=1000，总<=2000，整个公开快照序列化<=1MiB；否则TASK_STORE_UNAVAILABLE，不能默默只取1000。
- Cursor为随机UUID，绑定sender ID及generation、rootId及installation revision、instanceId、规范化kinds集合、固定snapshot及offset。kinds顺序变换相同集合可用；limit可在1..100内调整，不属于过滤身份。
- 游标30秒，后续成功页产生新的30秒游标；保留旧游标只允许同一快照读回，不改底层任务。每sender最多4快照、全局16；快照共享行数组，游标只存引用；全局最多256游标。逐出最旧快照时关联游标一起失效。16MiB是序列化payload上界，不冒充JS堆实测值。
- 首次计算每sender最多1个、全局2个，包含pending；相同规范化初始读取可以合并，只共享读取结果，各自保留requestId。超额UNAVAILABLE，不排无界队列。
- worker每条记录之间检查固定2000ms工作预算；main最多2500ms接纳/构建预算；preload保留3000ms等待期限。文件IO/既有worker队列不承诺硬实时，超时回TIMEOUT，禁止强杀共享worker。main期限后不保存晚快照/游标；纯读晚结果丢弃，不重放写请求。
- sender销毁/导航、根代次变动、适配器close清理游标/快照；pending完成后仍须检查generation，不能为已消失窗口创建资源。只清观察，不取消原任务。
- 该接口无事件/订阅，因此没有新事件seq或退订。详情继续tasks.v1 subscribe/get/dispose和既有U07/U08边界。renderer退页只停止排队后续页并丢弃晚结果，没有服务端业务取消语义。

## 7. UI接入与兼容

私有worker ready沿v1信封仅新增可选`features`字段：缺省或空数组表示不支持目标读；新worker发送`features:["mod-targets.read.v1"]`。exact parser只允许此固定值、长度0..1且无额外字段，StorageClient保存标记。新main兼容旧worker无features的ready，此时不得试发新命令；旧main与新worker仍要求随同一产品构建发布，不能混用。capability仅在此标记存在、新命令客户端及两域真实服务都装配成功时广告，空实现/模拟结果不能广告。旧preload/旧main没有该capability时不调用新通道，也不改tasks.v1严格schema。

ModPanel使用`instanceId + kinds:['mod-check']`查询，完整分页后只显示匹配实例的活动项；B实例不能拿A任务当自己的取消目标。切实例/根/修订有generation围栏，丢弃旧响应；不因某页没有active就判断该实例无活动。多条活动均保留，不靠“第一个”掩盖其他任务。

历史report仍核对instanceId、展示checkedAt和接纳修订，不将UUID排序或items反转当成时间。此片不增加latest-report API，亦不改变Mod声明检查含义。mod-install关联可供实例任务记录使用；原ModInstallConfirmation仍以固定planRequestId查询原结果。

能力缺失/证据错误时，移除现有全局首个mod-check回退。只允许显示本组件本会话明确接纳的当前任务，并解释无法恢复其他实例任务；全局任务入口可读但不能猜目标。这是兼容降级，不算完整重开恢复通过。新能力路径必须用持久证明完成A/B重开验收。

读取成功不授权新安装、暂停、重试、取消或恢复写入；needsRecovery继续与连接失败、业务失败、新尝试区分。

## 8. 批准后拟改文件与顺序

| 片 | 精确拟改范围 | 用途 |
| --- | --- | --- |
| T1-a | src/shared/contracts/task-targets.ts；handshake.ts能力/bridge类型；messages.ts固定文案 | 先落exact公共契约与校验，测试先行 |
| T1-b | services/storage/tasks.ts、records.ts；workers/protocol.ts、entry.ts、storage-client.ts | 固定SELECT双向接纳库存、新只读命令/两私有错误/ready能力标记、大小/预算，无持久schema变化 |
| T1-c | services/mods/tasks.ts、install-tasks.ts；新增ipc/task-targets.ts、preload-task-targets.ts；ipc/preload.ts；main/index.ts | 接纳读取屏障、复用投影、受信sender、游标预算、能力真实装配 |
| T1-d | ui/ModPanel.tsx；必要实例任务区；共享文案；原任务中心保持tasks.v1 | 按实例选活动任务、代次围栏与兼容降级 |
| 测试 | 新task-targets-contract/adapter/storage/UI用例，更新相关既有fixture | 多实例重开、身份/游标/时间/规模/异常证据 |

在共享工作树开始每片前重新核对他包diff；不切共享分支，不把他人改动混入提交。若实现发现必须增加持久字段/依赖/新公开写动作，本批准范围不覆盖，另给具体变更。

## 9. 必需验收与本轮已验证范围

批准后必需：

1. A/B各有两域任务，A活动时切B、重开后B仍仅见B；同UUID假输入/跨根/未来格式/缺计划/孤立接纳均有受控结果。
2. 接纳SQL后、索引save前注入暂停：查询不得误返回空或写needsRecovery；屏障释放、异常/超时及后续接纳继续可用。
3. 101条及双域1000边界、2001/体积超限；worker/main计时、同sender并发预算、窗口消失后的pending不创建游标。
4. cursor跨sender/根revision/instance/kinds、过期/逐出、limit变化、重复页、sender销毁；不得读其他目标或发业务控制。
5. 原seq/revision/取消安全测试保持；实际Electron窗口的活动选择/重连/历史文案及真实worker/存储回读另验证。

本轮只交付本文件、可运行候选exact validator和纯身份映射。25项候选测试通过，含现有parseModJobs/parseStoredModPlan/摘要函数参与的双实例、缺失/篡改停止、failed/cancelled/needsRecovery身份、两次新Node进程JSON输入回读。**不含**真实SQLite join、worker新命令、接纳屏障、游标实现或实际窗口U05修复；不把这些候选测试替代以上必需验收。日志与边界见[候选验证报告](../../validation/T1-20261110/REPORT.md)。

