# P-B：任务与观察链路实施方案

日期：2026-10-29，实施检查点更新至2026-11-10。状态：**B1及B2的U08/U07已接入并完成指定组件的受控窗口验证；B3/B4及完整App/产品包验收未完成；新增契约/持久暂停均 PENDING**。首轮研究范围见§1，当前进度以§10–14为准。

## 1. 本包授权与交付范围

已先读 TASK_PLAN、DECISIONS、AGENTS，再直接读取当前工作树中的 RESEARCH_INDEX、IMPLEMENTATION_RESEARCH 和原始 REPORT/结果；未以 HEAD 替代未跟踪研究。当前项目为 G2；本次分聊首先只允许本包目录的方案与必要独立证据，不等于批准所有新协议。保留公共文档、代码、依赖、分支及其他聊天改动。

本次交付本文件和 INPUTS.json；只读审查，不修改生产代码、不重新制作 U04/U05/U07/U08 同义夹具、不运行公共构建、不启动 EXE/游戏、不操作玩家实例、不提交混合工作树。既有报告中的 PASS 是历史受控证据，本次不宣称重新测试通过。

最终产品目标：任务列表覆盖活动工作，实例页关联正确，观察失联可解释并能查询原结果，安全失败能创建明确的新尝试，恢复未决有独立入口。暂停/继续另成完整服务切片；仅加按钮不构成下载中心完成。

## 2. 四项证据与边界

证据入口：[原报告](../../validation/RESEARCH-OBSERVATION-20261029/REPORT.md)，后续追加章节优先于其早期“未验证”列表。

| 问题 | 已有受控结果 | 产品缺口 | 本包处理 |
| --- | --- | --- | --- |
| U04 | pagination-result.json：100 completed install + 第101条 running mod-check；首屏活动0，次页及 running 过滤均找到；模拟业务写0 | refreshGame只取首100，App计数依赖该数组；InstallPanel还只展示最后6个install | 复用现有单状态过滤与快照分页，活动/待恢复/历史分开；不假定最新100能覆盖老活动 |
| U05 | component-target-result.json：真实ModPanel effect在B选择A活动任务；hooks/bridge替代，无DOM | 公共TaskSnapshot无目标；历史报告有instanceId但活动任务未完成时不能靠报告推断 | 完整修复先冻结按实例任务查询；临时仅显示当前明确接纳任务不是重开恢复完成 |
| U07 | silent-observation-result.json：初始running后main静默移除；旧listener留存，getTask返回TASK_NOT_FOUND，业务cancel0 | UI无法知道订阅仍健康，旧快照可长期显示；读取失败告警不更新 | 有界getTask确认、独立观察状态及重订阅；无事件不判业务失败 |
| U08 | late-subscription-result.json：3000ms TIMEOUT后main受理并发事件；前端交付0/退订0；sender销毁停止 | 原invoke晚成功的subscriptionId被Promise.race丢弃 | preload只针对合法迟到订阅回执退订；不重发业务请求、不取消任务 |

保留现有保护：preload revision不回退、subscriptionId/taskId/seq过滤、跳号getTask、256事件/1MiB缓冲、dispose清理；adapter sender generation、64/256订阅预算、pending计数、同任务轮询共用查询、30秒绑定sender/root/filter的快照游标与退订归属。U07/U08不是这些保护不存在，也不证明正常业务会频繁删任务或永久泄漏。

## 3. 缺口按层拆分

| 层 | 已有能力 | 真正缺口 / 不应采用的捷径 |
| --- | --- | --- |
| UI | listTasks分页/单state、getTask、订阅、取消；资源已有重试 | 完整工作集、全种类任务入口、恢复独立计数；观察错误和业务错误目前混排；资源查不到task不能据此展示安全重试 |
| 生产IPC | tasks.v1严格快照/错误/事件；get结果只在部分completed域带身份；control schema接受pause/resume但adapter实际只执行cancel | 无活动目标、按实例查询、观察失效事件或持久暂停保证；不能直接给v1 exact DTO加字段，也不能凭schema枚举宣称已支持暂停 |
| 恢复数据 | ModJobs持久task/request/instance/revision；Mod确认+plan+transaction/result；安装记录和SQLite任务 | 公共投影尚未读取这些归属；缺失/冲突不能猜目标或自动重跑。不是所有任务都缺持久底座；是否补格式要逐域证明 |

主入口真实装配在 src/main/index.ts，额外任务聚合来自游戏、资源、Mod检查及Mod确认；仅改InstallerAdapter而不接领域投影不能解决U05。docs/contracts/MOD_INSTALL_TASKS.md的“尚未公开”段落已落后于实际源码及最新DECISIONS，不能据此把现有公开能力当未实现；本包不抢改公共文档。

## 4. 实施切片及拟改文件

以下均为后续拟改，当前无源文件修改；按 B1→B2→B3→B4 逐片验证，不一次并改全部。

| 切片 | 精确拟改文件 | 目的与验收依赖 |
| --- | --- | --- |
| B1 列表完整性 | src/ui/launcher-state.ts；新增src/ui/task-query.ts；src/ui/App.tsx；src/ui/InstallPanel.tsx；src/ui/ResourceBrowser.tsx；src/shared/locales/messages.ts；新增tests/task-query.test.ts | 复用现有接口；活动/待恢复/历史独立投影、完整性标记、显式加载更多；缺任务按ID读回，不能视为不存在 |
| B2 观察修正 | src/ipc/preload-instances.ts；新增src/ui/task-observer.ts；src/ui/InstallPanel.tsx；messages.ts；新增tests/preload-task-observation.test.ts、tests/task-observer.test.ts；tests/installer-adapter.test.ts | 迟到回执清理和有界健康确认；无新通道/持久格式/依赖，保留全部序列与sender保护 |
| B3 目标恢复 | 拟新增src/shared/contracts/task-targets.ts、src/ipc/task-targets.ts、src/ipc/preload-task-targets.ts；src/ipc/preload.ts；src/main/index.ts；src/services/mods/tasks.ts、install-tasks.ts；src/ui/ModPanel.tsx；相应新contract/adapter测试 | 先审批§7新契约；首片仅Mod两域按实例读，不先扩成所有域的新TaskSnapshot |
| B4 动作与恢复 | src/ui/ResourceBrowser.tsx、ModInstallConfirmation.tsx；messages.ts；后续领域只读恢复投影文件待具体契约冻结 | 只在领域证明安全后给新尝试；无证明时保持needsRecovery及诊断。持久前驱关系/新恢复投影另批，不能先写schema |

B1/B2不需要更换架构或依赖。共享文件有其他工作包可能使用，实施前核对最新diff并与负责人排定修改窗口；不切共享分支。P-D负责Java/启动最终复核，本包不处理R02或修改启动锁；P-C负责Mod维护事务，本包仅消费原任务/结果。

## 5. B1：现有过滤与分页的具体策略

1. 活动集合固定为queued/running/verifying/committing/pausing/paused/cancelling/failing，paused单列“已暂停”，不叫正在传输。needsRecovery独立查询，completed/failed/cancelled进入历史分页。不只查running。
2. 每次刷新最多2个只读查询并发；单状态limit100，逐页复用原cursor；每轮总预算40次调用或10秒（先到者），单状态最多20页。未穷尽时显示“已载入N，尚有更多”，保留游标供显式继续；这只是预算不是支持总量上限，绝不把部分数宣称全局准确总计。
3. 活动优先，needsRecovery其次，历史第一页最后；各state快照并非全局原子，合并用taskId去重并保留最大revision。同revision内容矛盾视为不可确认；状态迁移造成重复时getTask确认。已知活动ID必须再读回，不能因某次过滤未出现而删除或显示业务失败。
4. CURSOR_EXPIRED丢弃该查询快照，只允许自动从第一页重取一次；仍失败显示部分/过期。root切换或刷新generation变化时丢弃晚结果并清理排队工作，旧root不能回填；处理当前refreshing全局布尔导致新root刷新被跳过的问题。
5. instances:list也逐页读取并遵守预算，不能让任务完整但第101个目标实例仍不可选择。listInstancesV2只是加载器身份来源，不作为实例列表已完整的证明。
6. InstallPanel/全局入口展示所有已载入活动种类，不再用install过滤+slice(-6)隐藏其他领域；历史按页显示。大量任务只为可见详情注册观察，不为所有历史创建订阅。资源库持有明确taskId时直接getTask，TASK_NOT_FOUND也只说明当前根不可查询，不能自动发新下载。
7. 现有state过滤仍先聚合领域全量并非数据库索引优化；需测读取次数/耗时，不承诺过滤降低主进程扫描成本。超预算持续发生再独立提批量汇总/服务索引方案，不偷偷改契约。

以上数值是本包建议的初始UI预算，需在实施测量后调整并记录；没有宣称容量测试通过。

## 6. B2：迟到回执清理与有界观察确认

### 6.1 迟到回执（U08）

在preload的request内部保留原invoke Promise，仅为tasks:subscribe提供内部late-success回调；普通业务invoke语义不改。request计时器先将状态从pending切为timedOut，再返回TIMEOUT；原invoke完成后仍做isInstanceResult精确requestId/channel校验，并验证snapshot.taskId等于本次taskId。只有合法成功且本地已超时放弃时，用既有events:unsubscribe退订该subscriptionId一次。正常受理不能误退订，畸形/错误/其他请求回执不触发任何清理。

dispose仍只操作观察。清理请求捕获reject/TIMEOUT，允许同ID最多一次只读式幂等退订重发，之后停止并留受控诊断；不无限重订阅。sender销毁继续由adapter generation阻止晚受理或removeSender清理。清理失败仍可能在sender存活期间残留，不能宣称网络任意丢失也零残留；若此风险不可接受，才转向§7观察租约备选。

### 6.2 观察状态（U07/U09）

新增UI内部观察协调器，不新增IPC事件。状态为connecting/confirmed/rechecking/unconfirmed/unavailable；保存lastConfirmedAt和业务snapshot各自独立。confirmed只表示最近一次get/订阅受理确认，不声称服务端订阅永久存活。事件沉默只触发读确认，不改变业务state。

- 以(root generation,taskId)复用一个观察器和在途get；同任务多个卡片共用结果。所有get返回还必须核对taskId，跨订阅/轮询合并不降revision；不越过preload现有seq过滤。
- 全页最多8个可见详情观察；全局get并发2、每秒最多2次启动，公平轮转。健康确认每任务最早15秒一次；终态确认后停止周期读取，只保留显式刷新。已暂停任务可30秒确认一次。
- TIMEOUT/UNAVAILABLE/TASK_STORE_UNAVAILABLE退避2/5/15/30秒，最多连续4次失败后自动停止，显示“状态暂时无法确认”和显式重新连接。订阅失败result和意外Promise reject走同一策略，不每秒弹Toast。
- TASK_NOT_FOUND/TASK_NOT_OWNED/ROOT_UNAVAILABLE停止该观察并显示准确原因，保留最后已知快照；不把它改failed，不取消业务。根变化清空旧根观察；不自动重放写请求。
- get成功但原订阅可能已消失：显式重连/页面恢复时dispose旧订阅再接纳新订阅；每代只允许一次在途subscribe，失败受上述预算约束。成功读后清除连接告警，但保留snapshot.error业务错误。
- 页面隐藏暂停健康定时与新订阅接纳；已在途读仅允许回填同代结果。恢复前台合并为一次查询批次并受全局预算，不突发重连全部。卸载最后一个消费者清timer、listener、排队工作；晚结果不回填。
- 超过8个任务、预算排队或停止自动核查时显示“待确认/上次确认时间”，不能展示虚假实时状态。列表刷新和详情健康读取共享只读调度预算，避免叠加流量。

### 6.3 明确测试

| 用例 | 必需断言 |
| --- | --- |
| U08真实3000ms超时后放行invoke | 只退订迟到ID；后台订阅归零；renderer交付0；business cancel/create均0 |
| 超时与成功同一调度边界、正常及时响应 | 每个请求只走一个结果；及时成功不退订，迟到至多清理一次 |
| 畸形/错误requestId、错误taskId、失败回执 | 不发送退订、不向listener交付、不接受外来ID |
| dispose两次、sender销毁在受理前/后、退订失败 | listener移除；原sender隔离保持；有界清理停止；无未处理reject |
| U07初始running后任务不可查询 | 到期get返回TASK_NOT_FOUND后观察unavailable，最后业务仍running，不触发cancel或新尝试 |
| 长期无进度但get正常 | 确认时间更新，业务不失败；事件沉默不误报任务消失 |
| 订阅result失败与Promise reject、轮询失败后恢复 | 同一退避路径；成功清连接告警、不清业务error |
| 旧轮询晚到、新订阅先到；重复/跳号/缓冲溢出 | snapshot不回退；原seq/revision/256事件/1MiB保护不变 |
| 100卡片、隐藏/恢复、卸载及根切换 | 观察数≤8、get并发≤2、启动速率≤2/s；无重复timer；无旧根回填 |

## 7. 待冻结的契约选择（不能先实施）

### T1：跨实例目标，推荐按实例Mod查询

方案A：全TaskSnapshot升级tasks.v2，给六域统一target联合类型。优点统一；缺点迁移所有事件/get/list及每个领域，首片过大。

方案B（推荐）：新能力task-targets.v1，只增加只读task-targets:listForInstance，首片支持mod-check/mod-install，保持tasks.v1快照不变。请求精确为contractVersion:1、requestId:UUID、payload:{instanceId:UUID,kinds:非空去重数组(mod-check/mod-install，最多2),limit:1..100,cursor?:受控串}；不接收路径、URL或任意root。响应精确为原相关信封，data:{items:[{instanceId,instanceRevision,task:TaskSnapshot}],nextCursor?}，每条目标必须等于请求目标；不暴露私有plan路径或来源。

主进程由当前注册根限定权限：mod-check取ModJobs已验证record；mod-install从confirmation→不可变plan→instance绑定核对task/root/planId。新运行、失败及重开历史用同一持久来源，不能仅从完成报告或当前内存推断。缺记录/身份矛盾返回NEEDS_RECOVERY，不把空数组当成功或另猜实例。旧格式不回写、不迁移，不增加SQL列；若真实历史缺少证明则保留全局只读未知归属。

错误使用明确固定映射：INVALID_ARGUMENT、UNSUPPORTED_CONTRACT、INVALID_SENDER、OUT_OF_SCOPE、ROOT_UNAVAILABLE、TASK_STORE_UNAVAILABLE、NEEDS_RECOVERY、CURSOR_EXPIRED、TIMEOUT、UNAVAILABLE；完整category/message/retryable映射与exact validator在批准后随契约先行。sender校验沿现有主进程白名单；游标绑定sender/root/instance/kinds，30秒，最多256；请求3秒，超时只放弃读取，晚结果丢弃。无订阅/写入取消，任务详情继续现有subscribe/dispose；get/list事件不新增目标字段。

验收：A/B双实例切换和重开；同根外目标/外根游标/更换kinds拒绝；活动/failed/needsRecovery均准确；缺失/冲突数据停读；精确拒绝多余字段。该设计仍PENDING，不能把分聊指令写成已批准。

### T2：观察生命周期

推荐先实施§6现有get确认，不新增事件。备选新版本观察事件含subscriptionId/taskId/seq及受控失效原因，要求与task:changed区分、sender归属、过期租约、重接纳、窗口销毁及事件丢失读回规则全冻结。暂不新增该事件或持久租约；U08的本地清理与T1可独立，不必绑成大协议改版。

### T3：持久暂停

推荐首片只做资源库download任务，安装/Mod提交和游戏任务继续拒绝pause/resume。备选同时支持安装与Mod准备，因共享消费者及提交边界更复杂暂不推荐。core已有pause/resume状态不是服务能力；当前adapter仍只执行cancel。

冻结前必须明确：pause接纳先持久pausing，等待传输/worker及回调排空后才paused；共享制品其他消费者不能被暂停者终止；保留可信摘要/源验证器/临时前缀/consumer归属，不能只存bytesDone。重开仍paused且不自动联网，resume复验后保持同taskId增加内部attempt，不和失败新尝试混淆。paused前断电按证据进入恢复，不伪造paused；committing拒绝；取消等待清理但不删他人缓存。是否新增资源记录版本/SQLite字段、兼容迁移和任务级动作能力投影必须另交严格schema再批准。未冻结前UI不启用暂停按钮。

## 8. 错误动作与新尝试的边界

| 事实 | 界面与允许动作 | 禁止行为 |
| --- | --- | --- |
| 观察TIMEOUT/UNAVAILABLE | 显示最后状态及确认时间；get原task、有限重连 | 标任务failed、生成新业务请求ID |
| 写请求回执丢失 | 同原requestId查询/重试接纳以找回原任务，保持payload | 随机换ID并发再执行 |
| 领域确认安全failed/cancelled | 保留原结果；资源明确“重新下载（新尝试）”；Mod重新生成并复核新计划后再次确认 | 将同ID幂等读回原失败称重新执行；复用旧计划覆盖新库存 |
| needsRecovery/提交结果未知 | 独立待处理项，查询原结果/事务受控诊断；没有诊断能力就明确暂不支持自动恢复 | 普通重试按钮覆盖旧问题、删锁、删日志、猜成功 |
| completed | 显示完成的领域与准确目标；下载到资源库不称已装入实例 | 把完成/Mod satisfied当游戏运行通过 |

ResourceBrowser对!task分支先区分未加载/读失败/真的缺失；needsRecovery从通用重试条件移除。ModInstallConfirmation保留原task并提供显式“重新检查并生成计划”路径；生成新计划前重新读取实例revision/库存，不自动确认。持久previousTaskId/attempt关系尚未存在，不先暗加字段；第一片可清楚标明新旧任务ID但不能称跨重开关系已持久化。

恢复诊断不能仅把文件路径交给玩家：后续受控只读投影至少区分未提交、已提交待收尾、已回滚、证据矛盾/缺失；从原事务日志取得，不由UI猜测。这属于待冻结数据契约，本次只定义缺口，不能以文案替代自动恢复实现。

## 9. 验证、交付与停止条件

本次仅文档：检查本包链接、输入SHA256、源路径存在及git差异；不运行pnpm check，因为无产品变更且它会写公共.test-build/dist。INPUTS.json记录当前源码和证据身份，不记录玩家路径。

批准实施后：先新增局部确定性测试（U04所有活动状态/第101条/游标过期/状态迁移/根切换；§6竞态；T1双实例持久回读）；再用正式Electron内存受控领域入口验证列表、切实例、迟到清理及页面恢复。输出只写本包独立validation/build目录，不覆盖公共构建；若需要正式完整check，由共享目录负责人排定窗口或在批准的隔离checkout运行，记录准确构建身份。既有命令为pnpm typecheck、pnpm lint、pnpm test、pnpm build；未运行不能报通过。

退出证据必须同时含：构建/提交或源码哈希、独立非玩家测试根、操作输入、前后任务状态/revision、订阅/定时器/业务写计数、原始日志与窗口表现。原11项adapter测试只是底线，不替代preload和UI竞态。无外网也可完成B1/B2受控验收；真实下载新尝试/暂停重开需后续领域真实服务证据。

本包交付门槛：B1/B2证据闭环 + T1准确目标/重开验收 + 各状态动作不误导；B4受控诊断和T3持久暂停仍分别保留未完成标记。缺批准时停止相应产品变更，继续文档；没有完整暂停、恢复及准确目标之前不宣称完整下载中心交付。

下一最小增量：共享文件修改窗口确定后实施B1（无新契约），随后B2。需要新增批准的具体选择已收敛为T1方案B、T2暂不新增、T3资源download单域；T3仍需其独立完整存储/动作规范后才能进入实施。

## 10. 2026-11-05 实施检查点

用户回复“开始”后核对最新工作树；列表涉及的App/ResourceBrowser等已有他包改动，先独立实施B2中的U08局部修复。生产仅改preload-instances.ts，无契约/存储/依赖变化。专门10测试、既有任务20测试、类型/lint及隔离构建通过；完整回归出现worker NEEDS_RECOVERY并中止，未通过。详见[实施报告](validation/U08-20261105/REPORT.md)。一次误在根目录构建重写公共dist已明确记录。B1、U07、T1及暂停均保持未完成；原INPUTS.json为10月29日研究快照，不冒充本轮输入。

## 11. 2026-11-06 实施检查点

用户回复“继续”后推进B2的U07：新增有界只读观察协调器、InstallTask独立连接状态与重新查询入口；无新IPC/持久格式/依赖。最终观察器16项与既有任务测试合计36PASS，真实preload/adapter内存IPC联测1PASS，类型/lint与隔离构建通过。完整回归多项worker NEEDS_RECOVERY并中止；短路径诊断仍复现，未定位根因。详见[U07报告](validation/U07-20261106/REPORT.md)与最终输入摘要。本次输出仅独立测试目录，未重写公共dist。B1、U05/T1、B4及持久暂停仍未完成，未做真实窗口验收。

## 12. 2026-11-06 B1实施检查点

继续指令后接入B1：TaskQuerySession/TaskReadBudget、分页实例和列表完整性、TaskCenter所有任务种类入口、按根代次隔离、资源缺任务时先查询原ID及needsRecovery退出普通重试。21项新增测试，连同U07/既有任务测试57PASS；真实adapter+store联测1PASS，业务写0。最终原脚本完整回归574项572PASS/0FAIL/2既有SKIP，typecheck/lint和隔离build通过。首次受限全量114FAIL保留；解除运行限制后同独立副本原脚本通过，不改存储代码来规避失败。详见[B1报告](validation/B1-20261106/REPORT.md)与输入摘要。

§5原计划的具体读取次序依据实测调整：先试两页现有完整快照，小集合避免9轮重复领域扫描；长历史再查询全部活动/恢复状态。统一列表/详情预算≤2在途、500ms接纳1次，每批最多40次/单reader20页，10秒为停止追加的检查预算，不强断已排队/在途读取。初次历史因此最多读取200条；仍非全量时明确提供继续分页。原adapter游标/过滤/sender/seq边界保持。浏览历史期间避免15秒自动刷新重置游标，并给出手动重新查询提示；详情观察仍工作。

真实窗口列表展示/滚动及跨页交互尚未验收；不能把上述夹具升级成Electron窗口或真实游戏证据。U05/T1、恢复诊断、新尝试持久关系和持久暂停仍未完成。本片渲染内存字段不是新IPC或存储schema。下一最小增量先B1/B2窗口验收，再完成T1精确契约审批。

## 13. 2026-11-08 受控窗口验收与游标修复

本轮使用cua-driver实际Electron组件宿主，生产TaskCenter/InstallTask/store/preload/IPC/adapter，固定仓库夹具；验证首百条活动/恢复、实例101、U07不可查询/原任务重连、U08迟到回执清理和历史301/显示更多不丢分页上下文。不是完整App壳、真实下载/SQLite事务或游戏验收。详见[窗口报告](validation/WINDOW-20261108/REPORT.md)。

窗口发现历史CURSOR_EXPIRED未在同批重读：已在原预算内立即重试一次，并加渲染内存提示与回归。最终完整575项573PASS/0FAIL/2既有SKIP，类型/lint/隔离build通过，局部58PASS；无新IPC、依赖或持久格式。初次过期失败、只Posted但未生效的点击和脚本初轮未达计数均保留，最终以UIA/截图/IPC事实判定。独立窗口已正常关闭，源数据/旧EXE未操作。

B1/B2指定组件的受控窗口证据已取得；全App壳、document.hidden真实切换、最终包/实际存储与游戏链不随之标通过。下一片冻结T1目标查询具体契约再按AGENTS审批，U05/B4/持久暂停仍未完成。

## 14. 2026-11-10 T1具体契约候选

补齐[按实例目标查询规范](contracts/T1/TASK_TARGETS_V1.md)：推荐独立只读task-targets.v1，复用既有SQL/JSON身份证明；包含严格公共形状/错误、私有mod-targets:read、固定ready能力标记、接纳读取屏障、分页/超时/体积/清理与UI兼容规则。无持久格式变化；新公共及私有契约仍PENDING_APPROVAL，不能按“继续”默认为新协议已批。

只在本包提供候选validator/纯归属映射和显式夹具，产品不导入、不注册。25项候选检查及独立strict类型检查通过，含双实例、缺证据停读、两次新进程JSON输入回读；不等于SQLite/worker/窗口重开或U05修复。详[候选验证报告](validation/T1-20261110/REPORT.md)。发现并明确既有mod-confirm:list已有摘要/计划校验、Mod检查SQL接纳到索引保存的间隙，以及现列表顺序不保证时间。下一步需用户明确批准规范§1方案B，再按T1-a至d逐片实施。

## 15. 2026-11-11 T1 方案 B 实施检查点

§14 保留当时的候选与待批准状态；其后用户在明确询问方案 B 范围后回复“继续”，本包记录见 [APPROVAL_T1.md](APPROVAL_T1.md)。只读目标契约、worker 持久证明、接纳屏障、分页 adapter、preload 和实例面板已接入，仍为 IN_PROGRESS；各项实际验证与缺口见[实施报告](validation/T1-20261111/REPORT.md)。未改变持久 schema 或增加依赖，未覆盖其他工作包未提交改动。

