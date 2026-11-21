# E有限生命周期组合补证 v13

2026-11-13（Asia/Shanghai）。按主协调精确授权，只新增本独占目录的夹具/构建/日志；src/tests/dist及其他资料不改，不操作GUI、原窗口、外部进程或旧根。开工五小时usedPercent=53、剩余47%、resetsAt=1794566717；周额度不作门槛。

**本轮六项有限集成测试全部通过：6PASS/0FAIL/0SKIP，首轮退出0。E-R1服务三terminal及E-R2/E-R3的正式类+真实Node Worker组合已覆盖；真实Electron/native迟到回调接线仍留给主协调，未声明整个E所有生命周期通过。**

## 复用与观测边界

`entry.mjs`只重新导出冻结FixedPackCoordinator、FixedPackReader、handleFixedPack和固定preview纯投影。`build.mjs`用现有esbuild编译到本目录production.mjs，metafile所列每个src输入均与FREEZE-MANIFEST SHA256匹配；`source-inputs.json`保留全部传递输入和bundle摘要，没有安装依赖或新生产IPC。

真实Worker夹具`fixtures/lifecycle-worker.cjs`只提供三种可控生命周期：无消息挂起、发送一条合法固定preview后挂起、发送合法preview后自然退出0。它不读取/验证真实mrpack内容，不称固定样本内容验证；该部分已有原v3四项专用worker证据，本轮未重跑。

为了看到正式Reader内部局部worker的真正事件，仅在本次Node测试进程内包装`Worker.prototype.emit/terminate`进行记录，每次仍调用原方法，结束后恢复。没有替换Worker实现、伪造message/exit、暂停exit派发、访问Reader私有active标记或改返回值。message阶段记录在原Reader message listeners执行后；exit来自真实线程退出事件。终止仅由原Reader处理测试自己创建的AbortSignal/timeout触发，未调用外部进程控制。

原公共handleFixedPack参与结果包装，失败不能被假mock成成功。新请求也使用原Coordinator+Reader和真实Worker，要求公共结果ok=true/status=unknown；不只是检查内部布尔值。

## 六项实际断言

| 用例 | 时序与结果 |
| --- | --- |
| r1-selected | chooser pending→removeSender→新请求拒绝→迟到选中路径settle；旧结果INVALID_SENDER、启动worker数0；相同sender新请求成功且真实worker自然exit0 |
| r1-cancelled | 同一阶段迟到undefined，仍INVALID_SENDER、无worker；槽真正释放，新可信请求成功 |
| r1-rejected | chooser promise真正reject，公共UNAVAILABLE、无worker；槽释放，新可信请求成功 |
| r2-abort-first | 正式Reader的真实挂起worker online→sender失效→Reader terminate；Reader和全局coordinator在exit前均拒绝新工作；实际exit1后旧公共请求CANCELLED，再接纳新请求成功/exit0 |
| r2-deadline-first | 注入1000ms Reader deadline先调用terminate，观察钩子随后触发sender失效；首因TIMEOUT保留，exit前两槽拒绝，实际exit1后才旧请求失败；新请求成功/exit0 |
| r3-result-before-exit | 真实worker已发合法preview且正式Reader listener执行后，保持worker存活；此时sender失效→terminate→实际exit1→公共CANCELLED；结果未成为旧请求成功，新请求成功/exit0 |

E-R2明确断言顺序`reader/global-slot-refused-before-exit < worker-exit < old-request-rejected < next-request-succeeded`。E-R3明确断言`message-after-reader-listeners < valid-message-seen < sender-invalidated < worker-exit < old-request-rejected`。强制停止的worker exit1是Node terminate正常现象，不能把它当自然退出成功；只有后继正常请求worker要求成功preview和自然exit0。

每例结束均检查活线程集合空、相关AbortSignal无遗留abort listener、无unhandledRejection；JSON保留完整顺序轨迹，不使用固定sleep猜worker阶段。没有对整个Node测试框架的所有timer作过强声明，正式Reader源代码exit分支仍负责clearTimeout。

## 命令、结果与文件

从v11根运行的真实命令：

```text
node acceptance-results/e-boundaries-v13/build.mjs
node --test acceptance-results/e-boundaries-v13/boundaries.test.mjs
```

`build.log`退出0；`tests-r1.log`为6项全通过，duration约1.30秒。没有首轮失败或放松断言后重跑。六份r1/r2/r3 JSON各自passed=true、liveWorkersAfterCleanup=[]、unhandled=[]。`validation.json`汇总生成时的代码/日志/轨迹工件SHA256（不含自身和后写本文），并重新核对597冻结文件零漂移。没有运行全仓库test/build，固定产品未变，无需用重复全量代替本次有限断言。

| 文件 | SHA256 |
| --- | --- |
| entry.mjs | 8d04845160744a1a875c75a39f3a11c6353d4ab7dfa0c87e2283b8aa7cc0147a |
| build.mjs | 1e87e6ede653be7519e7454acacaeca88f4e9d0507bc8e51e464696f3998d38e |
| production.mjs | fe1fd4cf824169ebb5f3c5d8992e25e40d88b3a85821731cf45cc04e03fad3e6 |
| boundaries.test.mjs | 9574f27b3d0a60abc011ebce54519296210c68f3d9dc8343f62ccdcaa393a205 |
| fixtures/lifecycle-worker.cjs | 2852b5d41bac708e7046d77eeadeb6bb94663e062e99165ee8c65673909cef0b |

## 状态更新与仍有限的真实接线缺口

结合先前`game-data/E-REMAINING-REVIEW.md`：E-R1的三种服务terminal/释放/新请求成功现已通过；E-R2的正式组合、abort/deadline两种先后及真实exit后清理通过；E-R3的正式组合消息已收但未exit时失效通过。未发现需修改产品的可复现代码缺陷。

仍缺的真实接线观察仅为：**至少一次真实native dialog在主进程继续存活时，原文档失效后实际settled，旧请求不成功，随后新可信文档可正常再次检查**。v4的窗口销毁只有sender-destroyed→will-quit→exit0而没有chooser-settled，本轮服务测试不能补造该OS事实；也不能把调用removeSender的服务夹具称为已触发Electron did-start-navigation/destroyed。

## 给主协调的最小观测壳设计（本轮未运行/未创建GUI）

优先选**原窗体主文档受控reload**，避免再次“唯一窗口销毁→主进程立即退出”而失去callback记录：

1. 使用全新独立profile和原七份产品产物，启动前核对manifest。只在外部验证壳记录真正`dialog.showOpenDialog`的调用与resolve/reject（canceled/pathCount即可，不记录路径），原参数、原OS dialog、原返回值原样传递；公共packs handler wrapper只记录requestId/ok/errorCode。
2. 实际打开原生picker并观测可见；验证壳对其自有产品webContents发起一次reload，记录真实main-frame did-start-navigation。不能用顶栏隐藏/显示页面冒充文档失效，也不通过改产品sender判断制造失效。
3. 在原native picker中真实选择样本或取消，明确记录`native-settled`；旧handler不能preview成功。待新文档ready后从真实UI再次选择固定样本并成功。记录pending期间没有第二picker、settle后新请求真正可用。
4. 正常关闭自有窗口、记录owner释放；按原保护数据策略核对无实例/安装写入。只需一次真实native可观察terminal；另外两种terminal和worker消息交错已由上述确定性集成测试覆盖，不需要再乘GUI全排列。

若平台在reload时自动取消dialog，就记录实际canceled terminal，不伪称“迟到选中文件”；配合同路径的服务selected测试足以区分层级。若该reload被产品/工具明确拒绝，不绕过；可改为独立验证壳添加无preload/无业务的keeper窗口，让真实owner销毁后主进程活至native callback实际settle，旧公开响应仍须非成功，再正常退出。keeper只为观测存活，不能把它伪造为已登记可信产品窗口；后继正常入口复验仍用原产品文档。无需尝试before-quit阻止退出来与产品自身异步shutdown竞态，原main在before-quit会关闭服务。

以上是设计建议，不是本轮执行，也不预设GUI工具许可。完成真实接线观察后，可将历史笼统E竞态缺项按E-R1/R2/R3逐项收敛关闭；仍不承诺所有OS异常、通用格式、已有玩家根全矩阵或其他包恢复行为。
