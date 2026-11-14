# C-R4 在途关窗/重开：准备，未执行

2026-11-14，五小时used4%、剩96%。复用已审v20原始Worker keepalive方法、固定v3七产物与原v4-bc自有合成profile。只新增本目录，不改生产/共享树或旧证据，不启动GUI/业务。node --check仅验证新window.cjs语法，不计场景通过。

## shutdown静态前提

原main/index.ts:337–345在Windows最后窗口关闭后app.quit，before-quit等待launches.close，再await maintenancePreviews.close，最后关闭依赖/storage并正常quit。maintenance-jobs.ts:81起对running controller.abort并await done；原ModArchiveReader的AbortSignal监听调用真正terminate，收到实际exit才reject/释放lane。无游戏活动的本profile符合这条正常退出前提；若有游戏未退出，main可能隐藏窗口等待游戏，不能误判本场景关闭失败。

原worker entry只port.close，不process.exit，引用计时器令首mod-archive在发真实扫描结果后继续存活。这是**生命周期故障注入**，不是自然产品时序；不伪造parentPort消息/业务终态。新壳没有直接terminate或取消业务的cleanup。before-quit observer只记日志，不阻止或替代原shutdown。

## 第一进程：正常关窗而非点取消

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\c-inflight-close-v24\window.cjs'
```

主协调选A alpha-provider发起一次预览，确认worker-private.jsonl keepalive-loaded、window-close.jsonl原mod-archive-result及真实running后，**不要点取消，直接正常Alt+F4**。应在Reader30秒timeout前关闭，提前准备可见按钮及窗口控制，目标≤25秒。壳保存old-preview.json（真实requestId/input/previewId），不自动新请求。

所需顺序：原worker结果→GUI关窗/原before-quit→原Reader terminate→真实worker exit→will-quit/app exit0。exit1若发生在terminate后属于受控终止，不能当自然成功；没有cancel IPC是本场景正常前提。核对owner释放及6JAR5tasks保持。若先timeout或进程未退出，保留现场，不强杀、不把超时终止算shutdown取消通过。

## 第二进程：完全禁用keepalive注入

等待首进程已正常退出后：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\c-inflight-close-v24\window.cjs' '--reopen'
```

重开模式所有Worker保留原选项，**不选择/不注入任何Worker**。仅在did-finish-load后自动调用一次原公开只读maintenancePreviewStatus(old ID)，保存reopen-old-status.json，预期PREVIEW_EXPIRED。这个查询不是UI消费或新接纳；随后主协调GUI同文件新预览须新requestId/previewId并正常completed及DOM，正常关闭exit0。若old-preview.json缺失，不能伪造旧ID。

两进程日志独立：window-close.jsonl/window-reopen.jsonl、verified-product-close/reopen.json逐SHA核对七产物；旧日志存在则拒绝覆盖。原profile持久报告保持，previewId不持久化。计时器只在第一进程首kind=mod-archive注入，不影响storage/其它worker；原entry/workerData/消息/结果不改。全程网络拒绝。

## 结果边界

运行时尚未执行，不能标PASS。需要真实child加载/原结果、在途正常关窗时间线、退出/owner、重开旧ID过期、新身份完成与DOM、文件不变齐证。不会承诺任意OS故障都能有限时间退出；若原shutdown未abort或terminate无真实exit，停止并报告，不由harness补业务成功或终止线程。
