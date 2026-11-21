# E-R1真实native接线：只读审计结果

2026-11-13（Asia/Shanghai）。主协调实际操作自有Electron观测壳后已正常关闭；本任务只读既有日志、快照、产物和冻结源，新写`native-verification.json`及本文。未启动GUI/产品/测试/worker，不改原日志、profile或产品。开工五小时usedPercent=9、剩余91%、resetsAt=1794584904；周额度不作门槛。

**只读审计79项PASS/0失败。E-R1约定的真实native失效后settle接线证据现已取得；结合此前六项有限集成测试，可按已约定的有限范围关闭E-R1服务/真实native以及E-R2/E-R3服务+真实Node Worker组合，不再泛称“E所有回调竞态未验”。不外推为所有OS/窗口/worker事件排列保证。**

主协调关联本轮GUI进程为PID35092。日志本身记录windowId=1/senderId=1及事件顺序，不记录OS PID；该进程关联和截图内容由主协调实际观察，本任务不把windowId当PID，也未重新审图。

## 精确事件链

下列sequence取`native-events.jsonl`；该文件36行，sourceLine=sequence+1。全部sequence连续唯一、UTC时间非递减。机器结果逐项保留检查及输入摘要。

| sequence / 行 | UTC时间 | 实际证据与判断 |
| --- | --- | --- |
| 0 / 1 | 10:49:07.397 | 壳七产物预检、独立profile、阻断网络配置 |
| 8–10 / 9–11 | 10:50:33.551–.552 | 旧请求c0d04eed-1aae-4ceb-b3cd-ec70c9313f70被handler处理，原showOpenDialog实际调用ordinal1，安排首次1500ms reload |
| 11 / 12 | 10:50:33.862 | generation1 DOM waiting=true、按钮disabled，尚无preview |
| 12 / 13 | 10:50:35.065 | 明确TEST_ONLY_DOCUMENT_INVALIDATION，nativePending=true；仅一次测试reload干预 |
| 13–14 / 14–15 | 10:50:35.073–.099 | 同一自有窗口真实main-frame did-start-navigation，generation2，再did-finish-load；不是顶栏隐藏切页 |
| 17 / 18 | 10:50:35.503 | 新文档初始DOM preview=false，等待状态已重置；没有把旧结果直接当新结果 |
| 19 / 20 | 10:51:19.001 | 原native promise真正settled，ordinal1/requestId匹配，resolved/canceled=true/pathCount=0；发生在新文档完成加载以后 |
| 20 / 21 | 10:51:19.001 | 旧handler-returned ok=false/code=INVALID_SENDER，packWorkers=0；此时之前无pack-worker-created |
| 21–22 / 22–23 | 10:51:55.676 | 新请求12633022-4fc4-4271-92f9-38e638175142，原picker再次实际调用ordinal2，说明旧pending不再阻止后续接纳 |
| 24 / 25 | 10:53:40.877 | 新native真正settled，canceled=false/pathCount=1；没有第二次自动reload或自动选择 |
| 25 / 26 | 10:53:40.878 | 唯一pack-worker-created，关联ordinal2/新requestId，实际threadId=2 |
| 26 / 27 | 10:53:40.910 | 该真实worker exitCode0，先于handler返回 |
| 27 / 28 | 10:53:40.911 | 新handler-returned ok=true/state=preview，worker数1；这是服务端返回，不称“已交付到UI的ACK” |
| 28 / 29 | 10:53:41.308 | 另一次独立只读DOM观测：generation2 preview=true、waiting=false、按钮启用、nodeAbsent=true；与上一步分开记载 |
| 29–31 / 30–32 | 10:54:40.395–.417 | 自有window-close→sender-destroyed→window-closed |
| 34–35 / 35–36 | 10:54:40.453 | will-quit、进程exit0；全部pack worker数仍1 |

两个before-quit记录是原产品异步shutdown再次app.quit的既有流程，审计没有把它当成两个进程或两次成功。无reload-rejected/not-fired、不记录handler throw/reject或uncaught exception。

## 旧路径/新结果的证据分层

首轮是**真实取消且零路径**，不是实际迟到选中文件的OS分支。真实构造观测显示旧handler返回之前没有固定包worker，旧结果明确INVALID_SENDER；因此本链没有让首chooser的输入进入固定包读取。透明Worker构造/退出观测不是OS文件读取系统调用跟踪，不能称“已追踪所有文件打开”。

迟到选中路径和chooser rejection已在本目录`boundaries.test.mjs`的r1-selected/r1-rejected确定性服务组合中补齐；此轮真实native canceled terminal满足事先约定的一种真实settle接线，不要求制造OS异常或再做全排列。

新handler返回与后续DOM preview=true是两个不同观测。日志没有IPC传输级回执或DOM请求ID标签，不能单凭handler-returned就说renderer已消费；本次另有新文档先false后true、唯一新请求、唯一新worker与主协调实际截图形成关联。`native-first-picker.png`、`native-new-preview.png`、`native-preview-detail.png`已保存字节摘要，内容由主协调审阅，本任务没有重复GUI或把截图存在等同内容通过。

## 四份快照比较

读取`native-snapshot-before/after-late/after-preview/closed.json`，对metadataExists、JSON路径/内容SHA256、databaseExists、三表行内容/计数、gameDirectoryExists及gameFiles逐字段比较，全部一致；并核对采样先后确实分别位于首请求之前、旧handler返回之后、新preview DOM之后和exit之后。

- 四次均metadata/database/game目录存在，不能把“缺失目录”误当空。
- JSON始终仅installation.json，SHA256为`ff8491405c22298479d0dff65edc805c26ff6b93d738cdd68921a688ecec2c28`；关闭后当前文件也重哈希一致。
- tasks=0、requests=0、operations=1，稳定排序且同一只读事务下的行内容SHA256四次相同；没有新增安装/包任务或操作。
- gameFiles始终[]；这是空新游戏根的文件内容证据，不是已有玩家数据全目录承诺。
- 前三次ownerPresent=true，closed为false；本轮独立lstat也确认当前owner.lock不存在。标记释放与exit0结合使用，不单凭标记存在推断OS句柄状态。

这些是采样状态比较，不声称整个Electron profile缓存字节完全不变、连续期间绝无瞬态读写或OS全程无网络。壳对新session/defaultSession的HTTP/HTTPS设置阻断，日志记录piston-meta请求被阻断；它不是完整机器网络取证。

## 七产物、源码和观测壳一致性

审计重新读取`acceptance-results/product-manifest.json`与native-case.json中启动时记录的七项manifest，要求项目数7、路径唯一且两清单一致；实际dist七文件均普通文件、无叶级符号链接、真实路径仍在dist内，全部SHA256匹配。597个FREEZE-MANIFEST文件逐项重哈希，零漂移。

观测壳当前SHA256=`33773b5c29983948d4ca910df910bf7c78d7de6e83aac2d2ae1a8af14984411c`，与准备时保存的指纹相同。snapshot-native.mjs、native-app/package.json、事件日志、四快照与三图片的完整SHA256均在native-verification.json。没有更改任何现有输入来获得PASS。

本轮运行的是原七产物加外部观测壳，不是重打包/重验最终EXE；原生API、原coordinator/reader/IPC未替换。唯一测试动作是首次picker pending时的自有主文档reload，网络阻断和透明构造/DOM日志仅为观察。没有自动选择/取消、伪造settle、强杀、重复制或业务写入。

## 有限关闭结论与仍不承诺的边界

| 范围 | 当前状态 |
| --- | --- |
| E-R1三个服务terminal、pending到真正settle、槽释放/新请求 | 先前六项集成中的三项PASS |
| E-R1真实native在主进程存活时因原文档reload失效、真正取消settle、旧拒绝/新请求成功 | 本轮79项只读审计支持主协调实际运行证据 |
| E-R2真实Node Worker组合、abort先/deadline先、exit前拒绝/exit后结算和再接纳 | 先前两项有限集成PASS，本轮不重跑 |
| E-R3合法消息已收但worker未exit时失效、旧失败与新成功 | 先前一项有限集成PASS，本轮不重跑 |
| 实际窗口销毁接线 | 原v4已见sender-destroyed→exit0；本轮正常关闭补同类记录，不宣称真实窗口销毁发生在worker在途 |

因此可以关闭事先约定的这三组有限边界，不再把历史笼统“所有native/worker竞态”作为无停止条件任务。若未来要承诺实际OS窗口销毁正好撞上每种worker消息时点、操作系统异常永不挂起等，应另列具体新增承诺，不能把它们暗中加为本次无限验收条件。

本轮没有发现需修改产品的可复现缺陷。仍不外推到通用mrpack/安装、任意玩家根不污染、所有平台异常、A旧锁/强制终止恢复或其他工作包；不把先前六项与本轮79个审计断言合计为一次85项产品测试。
