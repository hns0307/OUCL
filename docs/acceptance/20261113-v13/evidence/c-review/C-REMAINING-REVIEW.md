# C 已批准只读增量：有限剩余验收审查

2026-11-13，北京时间。审查目标为固定v3七产物对应源码，非ADE的v11源整改。五小时已用29%、剩71%，不以周额度作门槛。只读取源码/既有测试并新增本文件；未运行verify-result、测试、GUI、IPC或进程控制，不修改产品、延迟harness、profile/资料。当前延迟场景由主协调独占，下面不预测其到期结果。

## 结论

本次未确认会改写Mod文件、跨实例显示结果、公开泄漏路径/URL或必然导致关闭死锁的新增产品缺陷。已有证据足以支撑多数纯逻辑和私有服务边界；仍缺的是下列**8组有限证据**，而不是“所有可能竞态”。它们不要求每组都新开GUI，不要求真实联网、游戏或重复已通过的纯逻辑测试。

若验收仅声明当前已测代表路径，可保留这些精确限制；若要称本契约的必需验收全部关闭，则按下表补相应层级，不把mock/hook结果升级为真实窗口通过。

## 已有可引用证据（不重跑）

- `tests/mod-maintenance-preview.test.ts:42,50,67,75,80,92,101`：根/实例/修订/目录/环境漂移、完整指纹、取消释放lane、非法输入、平台失败不ready；末项走真实JAR worker和二次扫描，前后字节不改。平台事实在该JAR用例中为替身，不是正式Modrinth client证明。
- `tests/mod-maintenance-jobs.test.ts:21,31,43,49,57`：幂等/不同输入、queued和running取消、16项容量、单调900000ms及旧请求过期、重启不恢复、handler非法sender/schema。
- `tests/mod-maintenance-impact.test.ts:22,31,42,53,63,72,80,89,95,103`：物理JAR全部声明/嵌套、别名/环/可选、本地与平台身份隔离、冲突/未知、截断和运行时伪装。
- `tests/mod-maintenance-presentation.test.ts:23,30,37,48,56`：脱URL/内部路径、未知证据降级、before/after、安全字段、共享预算截断。512用例实际填512条relations且另有其他项目，验证溢出后unknown/总数≤512，不等于恰好512/513两侧都独立测过。
- `docs/work-packages/P-C/preload-bridge-probe.mjs:23`起：实际preload源码+内存Electron transport模拟首接纳3100ms迟到，重试同requestId只扫描一次；损坏previewId被拒绝。不是真实Electron/组件接纳重试。
- `docs/work-packages/P-C/component-probe.mjs:58`起及acceptance-v2-component-probe.mjs：生产组件但替代hooks，预览/取消及TIMEOUT→过期恢复、展示/非法证据边界。
- v4生产壳、真实Mod报告/preview、六JAR与任务不变；v5/v6实例归属和全局任务正常重开另有真实壳证据。C观察本身是内存项，持久mod-check恢复不能当作旧previewId恢复。

## 8组剩余用例及停止条件

| ID / 优先级 | 具体用例与最小收敛条件 | 代码位置 / 已有证据差距 |
| --- | --- | --- |
| C-R1 当前在途 | 首次真实completed回执hold900500ms；先证实同文件TIMEOUT、旧active/查询入口，再真实到期后GUI查询旧ID得PREVIEW_EXPIRED、旧控件清除、新requestId与previewId接纳并completed；正常关闭与字节不变。所有观察来自同次记录和DOM，handled/delivered不当作UI已消费 | `preload-maintenance-preview.ts:10`正常3秒race；`MaintenancePreviewPanel.tsx:23,32,38,47`。当前PID/计时由主协调负责；本报告不读或执行验证器，不预测PASS |
| C-R2 接纳回执丢失 | 只延迟一份**接纳**真实回执超过3秒；用户原组件再按预览必须使用同requestId、同input、返回原previewId，后台仅一次观察；同ID不同input通过真实公共边界返回INVALID_ARGUMENT且原项不变。无需15分钟或游戏；一次正式Electron/preload集成即可，不必重做纯jobs幂等测试 | UI `MaintenancePreviewPanel.tsx:49`附近的requestId ref保留和`:53`非瞬态错误清理；jobs`:28`规范化/`:30`既有ID；当前R1延迟status不覆盖接纳重试。已有preload内存transport通过，未见真实组件接纳丢失闭环 |
| C-R3 取消次序四格 | ①queued取消未进入scanner；②真实scanner/network运行中取消，回执只有实际退出后cancelled；③已completed再取消仍completed、UI补查显示原结果；④取消回执TIMEOUT后只查询原ID、不自动新接纳，最终只呈现一个终态。每格原ID固定、文件不变、后续新预览可用。服务层可对顺序设门，不伪造running SQL；真实壳只需覆盖运行取消/查询恢复代表格 | jobs`:73`cancel等待done、`:53`取消/完成分支；UI`:58`取消再status。已有jobs queued/running取消和受控组件cancel通过，未见真实生产壳完整四格/完成先赢记录 |
| C-R4 有工作时正常退出/重开 | 两个子场景：真实JAR扫描或平台请求仍在途时正常退出，记录abort、真实worker/网络退出、app exit0、仓库释放；重开旧previewId为PREVIEW_EXPIRED且不重跑，新请求可用。另一个同进程仅销毁观察组件（例如切页/实例）不应取消已接受扫描。不能用空闲close或当前completed回执hold的关闭代替running scanner close | main`:340–345`先close maintenance再关依赖；jobs`:81`close abort并join；组件`:45`只清轮询。已有单元jobs.close及正常壳关闭，未见两种真实在途资源的这组退出证据 |
| C-R5 在途跨实例/报告换代 | A发起，分别卡住接纳返回/状态返回/取消返回之一后切B，迟到A响应不能在B显示或成为B取消目标；若A同名JAR换字节/修订刷新，旧fingerprint预览应FILES_CHANGED或REVISION_CONFLICT，名称从新报告映射。最小用例为三种回执各一次，无需列任意全排列；根变化的私有context已有测试，产品不支持动态根切换时不要求伪造GUI功能 | `App.tsx:88` root+instance key；`ModPanel.tsx:100` root+fingerprint+file key；preview UI`:29–45`matches/generation。start/cancel本身无ticket，但这些key使旧组件卸载，尚不能据此确认串实例缺陷；已有正常切换通过，不等于这三种迟到回执的React实际装配证据 |
| C-R6 多声明JAR+平台解析 | 一个真实JSON-only多声明/嵌套JAR经正式archive worker、双扫描、正式Modrinth client的受控合法metadata解析、公共投影到窗口：单个物理JAR全部声明一起移除，平台精确project/version关系不按modId混合，nested只露深度。固定假HTTP输入必须摘要匹配并标synthetic，不能称真实上游来源。再加一次平台拒绝仍unknown，不需真实联网 | core测试`:42,53`已分别证明本地多声明及平台逻辑；真实worker用例`:101`仅单声明且byHashes替身；v4三个物理JAR也是单声明，平台受控拒绝。合并链尚缺 |
| C-R7 公共安全边界与混合预算 | 真实Electron main/preload分别对3通道做非主frame/不受信来源拒绝（服务无调用）、一个extra/path输入拒绝；错requestId/previewId和携带URL/路径的结果被preload拒绝。预算用混合providers/issues/relations/反向ID/failures构造总512和513两侧，恰好512不过度误判，513截断/incomplete且不ready；纯schema/投影测试即可，不需再GUI造512项 | main`:119,253–254`trustedSender/装配，IPC`:8–25`exact，shared`:50–80,98`schema。已有false trusted参数handler、纯validator及内存IPC；不是实际senderFrame矩阵。共享预算现有用例只覆盖一个溢出形状 |
| C-R8 内存上限与到期状态枚举 | 16项**已终态但未过期**时第17接纳SCAN_BUSY且旧结果仍读；failed/cancelled分别在TTL到期后status与同requestId重试过期；4095→4096 tombstone后新接纳安全拒绝、旧ID不复活、重启清空可新接纳。可用注入单调计时的独立registry测试，不再实等4096×15分钟、无需窗口 | jobs`:16–38`prune/cap/tombstone；现有`:31`16项含取消和运行/排队，`:43`只completed过期，未见4096边界及三终态全部映射。它是已批准有界内存行为，不需改变上限或持久格式 |

R1结束后本轮UI过期主路径可独立关闭；其余按其最小层级补证或精确DEFERRED即可，不要求把8组都用慢GUI重跑。当前无理由重跑无变化全套651项，亦无理由因此扩展文件启停/卸载。

## 四类明确风险复查

### 文件变更：未发现写入路径

`maintenance-preview.ts:47–76`调用context、inspection.check、纯previewModMaintenance和再次context；`inspection.ts`两次inventory.scan；`inventory.ts:45`起只枚举、stat、scanner.read、哈希与前后比较。`maintenance-jobs.ts`只写内存Map/Set；status/cancel不调用ModTransaction或rename/unlink。真实profile/日志或Chromium缓存可能因应用运行变化，不能将其统称“绝对零IO”；承诺是此预览不修改Mod/实例数据。已有真实JAR前后字节和v4六文件保持证据支持该承诺。

观察只对某个读取时点成立；外部程序在最终扫描之后改文件，仍可能使刚生成的展示过时，这不是写授权或保证文件永不再变。不能通过本次只读验收要求新增gameDir写锁或事务。

### 跨实例串结果：有防线，R5留具体时序

服务验证root/instance/revision/fingerprint/fileId，UI对completed结果再逐项matches；root/instance父key与fingerprint/file子key隔离，status ticket清理迟到轮询。start/cancel缺ticket不等于已确认泄漏：现有真实装配会卸载旧组件，旧setState不写新实例组件。但这依赖真实React key边界，故R5只补三类迟到回执，不以普通静态渲染宣称竞态全部通过。

### 泄漏：公开投影严格，但来源是可用观察ID

presentation`:28–110`过滤版本/要求文本、URL/内部路径、非法filename和嵌套路径；shared schema exact、固定错误码，不返回原异常/stack。现有纯投影/真实worker证据没有显示私有路径/URL漏出。名称及安全声明版本仍会显示，这是批准范围，不能把所有第三方字符串都称秘密。

registry不按sender私有分区：持有随机previewId的受信窗口可查询/取消同一观察，这是批准契约“窗口销毁不删除、持有ID可查询”的语义。不能照B游标私有规则将其误列缺陷。非受信sender必须由main拒绝，R7针对真实frame而不是改该产品语义。

### 关闭挂起：未发现必然死锁，不承诺任意坏IO硬上限

jobs.close对running发AbortSignal并await job.done，queued直接cancelled；main按顺序等待后才关闭storage。正式ModArchiveReader`:23–35`abort/timeout终止worker并等待exit；Modrinth`:71–94`abort可中断请求/250ms重试，单请求12秒；desktop network`:22–24`abort拒绝Promise。JavaProbe`:89–115`强杀后等待真实close，刻意不将仍活进程误报已停止。

若底层OS/child永远不产生close，shutdown没有独立全局deadline，因此不能保证任意故障有限时退出；当前没有实测证明这种异常发生，不能报告为确定产品死锁。R4只要求代表真实scanner/network在途退出。当前harness的15分钟悬挂invoke是测试注入，harness自身已在closed/before-quit清timer并resolve原result；它不能代替domain scanner取消证据，也不能被误报为产品关闭挂起。

## 范围终点

本文件不判当前运行PID的最终结果，不读/运行verify-result，不触发查询/接纳/取消，不操作主协调窗口。只读新预览仍不授权文件启停、卸载、持久计划或跨进程previewId恢复；这些不在剩余用例中扩张实现。
