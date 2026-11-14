# 首轮在途关窗前提未形成：NOT_EXERCISED

2026-11-14。仅只读解析原window-close.jsonl，不修改旧脚本/结果、不运行GUI或第二轮。主协调说明首个hotkey参数key被工具schema拒绝，改为keys数组后已超30秒；工具拒绝不是产品接收到关窗动作。

原日志证据：第8行worker-selected mono22349.83，第11行收到原扫描结果；第70行原Reader terminate mono52357.21（相距约30007ms），第71行真实worker exit1。第75行公开status failed/errorCode=FILES_CHANGED；第77行才window-closed mono55273.54，第78行首次before-quit，随后第80/81行will-quit/app exit0。

因此终止发生在正常关窗之前，符合既有30秒Reader timeout分支的时序；不能将该terminate归因于shutdown abort。公开FILES_CHANGED是实际错误码，不能改写为cancelled，也不能仅凭此码推断物理JAR字节真的被修改。exit1属于终止后的线程码，不是自然扫描成功。

结论：首轮只证明原扫描结果已产生、线程保活后超时终止、预览失败和之后正常app退出0。**C-R4在途正常关闭取消未被本轮覆盖**，没有强杀或绕过证据。保留原日志及状态，不重放原目录。

主协调将以新目录c-inflight-close-v24-r2执行预览→短等待→已确认keys格式AltF4；本审计不操作该窗口。待r2关闭与重开两个进程均结束后再核对真实退出先后、旧ID过期及新观察完成；此处不预测通过。
