# E固定样本只读入口：剩余生命周期验收的有限范围

2026-11-13（Asia/Shanghai）。仅只读代码/既有测试/历史证据与文件哈希，本轮不启动测试、GUI、worker、游戏或进程控制，不改产品。开工五小时usedPercent=30、剩余70%、resetsAt=1794566717；周额度不作门槛。已核对TASK_PLAN/DECISIONS；授权仍仅固定1355字节样本只读入口，不含通用mrpack、下载、安装或包事务。

代码位置相对`D:/MC_start/OUCL-acceptance-v11-20261113`，历史报告相对`D:/MC_start/OUCL`。候选及证据fab0ac8/ecb40f9已本地接纳是主协调提供的上下文；本任务不以Git接纳代替以下具体证据。

## 判断

**尚未确认可复现产品代码缺陷；剩余项是3组有限集成时序，不能继续泛称“所有native回调/worker销毁竞态”。** 正常样本、取消、不匹配、缺worker不广告、正常冷/热及真实窗口销毁已有明确覆盖，不应重复列为缺失。当前源码有失效检查/abort/等worker exit机制，但分层绿色不能直接替代同一次生命周期事件穿过实际组合的证明。

本轮没有执行复现，因此不宣称“已证明绝无缺陷”，也不建议为补报告擅自加超时、迁移schema、改合同或重构领域服务。下面每组给出可终止的关闭条件，完成即关闭该组，无需追求所有事件排列穷举。

## 为什么需要按三个阶段划界

1. **等待原生选择器**：`src/services/packs/coordinator.ts:18`等待choose；`:19`先检查abort/可信sender，再决定取消或启动worker；`:29`–`:30`保持pending直到promise真正settle。窗口失效只abort，不假装showOpenDialog已结束（`:10`）。
2. **worker工作中**：coordinator `:21`–`:27`只准全局一个preview；实际`fixed-reader.ts:17`建立Worker，`:20`–`:22`取消/超时发terminate，`:29`–`:35`等exit才结算并释放active。
3. **已收结果但worker未exit**：reader `:23`–`:26`只暂存结果，成功必须等`:29`–`:31`的exit0；coordinator在preview返回后仍于`:25`重查abort/可信sender。收到result消息本身不等于成功公开响应。

实际销毁/主框架导航接线分别是`src/main/index.ts:138`和`:139`；trustedSender检查当前窗体/主框架/文档见`:119`–`:122`；原生对话框及结果路径见`:223`–`:229`。preload在`src/ipc/preload-packs.ts:6`–`:13`故意不以renderer等待超时放弃原生选择器。不能把此既定语义报成“缺了通用3秒超时”的缺陷。

## 已有证据准确覆盖了什么

| 来源 | 已覆盖 | 不覆盖 |
| --- | --- | --- |
| tests/fixed-pack-ipc.test.ts:15–:29 | sender/schema先验、固定结果严格校验、错误脱敏映射 | 真正OS原生回调或worker生命周期 |
| 同文件:31–:37 | 同sender同请求合并、不同请求拒绝、普通取消settle | 销毁后的原生callback与清理后重新接纳 |
| 同文件:39–:44 | mock chooser未settle时removeSender；迟到**选中路径**被丢弃，preview未调用；旧请求未settle时新请求拒绝 | 真正native callback回到仍存活主进程；取消/拒绝两种terminal分支；settle后再次接纳 |
| 同文件:46–:51 | mock preview在途时全局并发拒绝、destroy signal确实abort、返回后拒绝旧成功 | 真正FixedPackReader/Node Worker exit与sender hook的一条集成链 |
| tests/fixed-pack-preview.test.ts:22–:35 | 真固定worker接受/拒绝内容/读取错误/不安全路径、启动前已取消 | Electron sender失效接线 |
| 同文件:37–:52 | 真Node Worker夹具：重复消息、已发成功消息但exit1、100ms注入deadline、挂起worker取消、QUEUE_FULL | sender失效驱动真实Reader；已收有效消息**尚未exit**时取消；释放后再接纳 |
| docs/acceptance/20261112-v3/REPORT.md:28、:34 | 专用4项真实worker测试实际4PASS；通用未配置worker的2SKIP另记 | 不是本轮重跑，也不证明未编写的时序用例 |
| 同报告:40–:46 | 正式未打包壳的真实picker/取消/不匹配/正常重开；缺worker不广告；空profile保护JSON/表/游戏文件证据 | 不等同最终EXE所有故障时序，也不外推全玩家目录 |
| docs/acceptance/20261112-v4/REPORT.md:17及evidence/e-destroy.jsonl | native chooser已打开，harness销毁自有BrowserWindow，sender-destroyed→will-quit→exit0；同profile重开 | 日志没有chooser-settled，进程约22ms后quit；无法看见迟到callback实际清理/slot释放，更未进入worker在途阶段 |
| docs/acceptance/20261112-v7/REPORT.md:3、:18、:26、:30 | 同最终EXE真实runtime冷下载、固定预览/取消/不匹配、热重开、产品退出0/owner释放 | 无最终EXE公开握手捕获；缺worker沿用独立v3变体；不含下面中断组合 |

v11与v3的coordinator、fixed-reader、fixed-worker、IPC、preload、共享packs契约、FixedPackPreview及上述两个测试文件，本次逐文件SHA256均相等。因此这些**原时间/原层级**证据可以关联到未变E实现，不改写成v11新执行的次数；A/D或四次游戏菜单与E未测时序无关。

## 仅剩的3组及明确关闭条件

### E-R1：失效后原生chooser真正settle，旧槽被安全释放

有限terminal分支为：**选中路径 / 用户取消(undefined) / chooser promise拒绝**。已有mock仅覆盖“选中路径”且未检查后续成功重入；v4真窗口在回调日志出现前主进程已退出。

关闭条件：

- 在已有coordinator测试层将三个terminal分支的失效时序做成确定性检查：失效发生在choose pending时；settle前原sender不得开启第二picker；settle后旧请求无preview成功、worker启动次数0；用新可信请求确认pending已释放且可完成。取消在abort之后应走失效路径，不能把它计正常成功；promise拒绝可以映射UNAVAILABLE，不要求所有错误都强制INVALID_SENDER（`ipc/packs.ts:15`–`:17`）。
- 补**一次真实native**“主进程仍存活→原文档失效→chooser回调被明确记录settled→旧路径不读/不回预览→新可信请求可用”。可以在独立验证壳受控刷新自有主文档，保持原生API不替换；或保持测试主进程活着后销毁自有窗口。必须记录实际settled，不能再以“窗和进程都退出了”替代。
- 实际native的一种可观察terminal就可证明接线到真实settle；另外两种逻辑terminal由上述确定性服务测试补齐，不要求故意制造OS异常来穷举平台行为。

说明：导航是主框架文档失效，不能用应用顶栏切页冒充。`src/ui/App.tsx:74`起以hidden保留页面，下载块中的FixedPackPreview没有因切页自然变成新文档；同一文档隐藏期间完成只读预览并非跨文档迟到漏洞。

### E-R2：真实worker尚未发结果时sender失效，退出与资源释放接成一条链

已有reader真worker取消和coordinator mock abort分别通过，但还缺实际组合下的worker exit、public拒绝与重新接纳证据。

关闭条件：使用原FixedPackCoordinator+FixedPackReader、真实Node Worker，在已settle chooser且Worker确实启动、结果未出现时触发原sender失效/abort。记录顺序`worker-started → sender-invalidated → terminate/exit → old-request-rejected → next-request-accepted`，旧请求不得返回preview，exit之前不得释放reader/global worker槽，exit后新可信请求能完成。测试可使用已有同类挂起worker夹具控制阶段，不替换产品结果或添加生产IPC。

deadline与abort共用reader `:20`的stop和`:29`的exit清理；如要覆盖它们互相抢先，只需在这一组增加**abort先 / deadline先**两个确定性子例，核对首个原因优先与单次清理。已有100ms注入预算证明的是机制，不必额外制造120秒GUI等待，更不乘上3种native结果再做笛卡尔积。若报告不承诺timeout/destroy重叠顺序，可明确保留这两个子例而不扩大其他组合。

Electron接线补证可与E-R1共同安排一次主框架reload/一次window destroyed，分别确认`:139`与`:138`实际调用到失效处理；不需要每个Node worker消息分支都重新操作一轮GUI。

### E-R3：有效worker消息已经收到，但尚未exit时失效

这与现有“成功消息后exit1”不同：该用例验证非0退出优先，未验证收到有效preview后destroy/abort能阻止结果成为成功。

关闭条件：用受控真实Worker先post一次合法固定preview，再保持worker存活；确认消息已到后失效sender，等实际exit，再断言旧请求只能失败、无preview送达失效/新文档、清理完成且新可信请求可成功。reader `:19`暂存result不能直接成功；`:31`有failure时拒绝，coordinator `:25`再检失效。应记录“message-seen”和“exit”两个独立事实，不靠人工几毫秒抢点。

若结果和exit0在sender失效之前已完整完成，这是已授权的正常只读观察；随后关闭窗口不需要追溯取消已经完成的预览，不算第4组未知竞态。coordinator最后可信检查到return之间没有新的await，不能无限发明任意UI事件插入点；仍由真实IPC文档生命周期保证旧invoke不变成新文档的请求。若未来取得相反实际证据，再按具体复现开缺陷。

## 每组通用但有限的通过证据

- 仅固定样本只读：不创建实例/安装任务，不写Mod/存档；比较相关metadata JSON、tasks/requests与游戏文件清单，允许单独记录catalog/Chromium缓存的正常变化。已有空profile证据可作基线，不能声称所有有内容玩家目录全矩阵不变。
- 旧invoke最多一个terminal、无旧preview成功；新请求确能完成，不仅检查私有布尔标记。所有本测试创建的worker正常exit/被中止后exit，listener/timer随其退出清理，无未处理reject。
- 原生dialog不能取消的等待期不以renderer超时假释放；16 pending/单sender1/全局worker1是既有有界策略。17th拒绝属于可独立的限额回归，不要求17个真实GUI picker；它不是新“销毁竞态组”。
- 验证壳/夹具需固定原E代码摘要，明确真实native、真实worker与受控消息部分；不通过删除最终EXE app内worker或替换领域成功响应制造通过。

完成E-R1/R2/R3的有限断言并在固定候选相关局部回归通过后，就可以把历史“E所有native回调/worker销毁竞态”改成“上述生命周期边界已验证”，不再保留没有停止条件的全排列要求；未执行哪一项就逐项保留ID。无需因此新增产品功能。

## 缺陷判断与明确不做的推论

本轮静态读取没有找到可直接确认的绕过、写入或失效后成功路径：native settle后检查在worker启动前，worker结果后检查在公开成功前，实际reader等exit；错误通过严格固定映射脱敏。缺少组合测试不自动是代码缺陷。未执行新复现，所以“worker/槽泄漏已修复”或“从未可能泄漏”均不可声称。

v4不记录settled、没有证明在主进程存活时清理，是**证据缺口**，不是已证明OS dialog永不回调。若OS promise永不settle，代码故意保留该槽直到结束、受16上限约束；未经新事实不能擅自释放未完成dialog或加永久白名单。

不把以下内容混入剩余清单：通用mrpack/所有恶意ZIP解析、目录故障/网络下载矩阵、新包安装、微软登录、Quilt游戏、A强制终止恢复、所有玩家目录不污染。固定SHA256先验仍在`src/services/packs/fixed-worker.ts:25`，它们不属于已批准固定只读入口的这3组生命周期组合。

## 本次读取指纹与执行状态

| 代码 | SHA256（与v3相等） |
| --- | --- |
| src/services/packs/coordinator.ts | 3ebe5312873eed7e4acd529d626932fee2e6bbdfd6ddb24212de7a38c7537459 |
| src/services/packs/fixed-reader.ts | 8c5cb8700b7641bc4a0388d829b87beb68b8752768273585a9c98f474c60ccad |
| src/services/packs/fixed-worker.ts | a8558e318d7988f1499f9af42e04dd381bec4c0145ca8a57444e55759e05112f |
| src/ipc/packs.ts | d1a7178c0d79b935dba5a2eeb9cfc79ed24ece9a628f28124e30c8359fd2677d |
| src/ipc/preload-packs.ts | 91cc2426f752c778278346eb1edeefe7a2356816c0cd7be386e9933e192921aa |

本轮仅创建本文；没有新增PASS数量，没有运行上述待补测试或GUI，没有修改v11冻结代码/资料。当前可接纳的正常固定只读功能与尚待补的三组有限时序分开记录。
