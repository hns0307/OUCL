# 增量报告 v17：运行取消尝试未形成前提

本阶段真实启动 C 运行取消观测壳，但**取消用例 NOT_EXERCISED**。没有观察到预定的网络pending、cancel IPC或abort；仅实际完成一次正常只读预览。正常退出0，六JAR/五任务快照保持，产品代码未改。

使用v3原七产物、原v4-bc合成profile，脚本 `acceptance-results/c-cancel-v15/window.cjs`，PID23804/window9636458。多次语义点击因UIA坐标与截图不一致未触发IPC，不算接纳或重复业务；调整自有窗口位置尺寸、重新取快照后，以元素space触发唯一实际接纳。

requestId `c7a06c3a-8c8d-4790-82ac-004f416535f4` / previewId `726f77cc-5385-44d6-bef1-9edf098a627e`，status从running到completed/blocked，platformFailures=NETWORK_FAILED。两次原ClientRequest创建后约1ms即close/error，session拦截确实命中version_files，但其hold guard因首对象closed=true而失败，改走立即拒绝callback；第二次仍引用首closed对象。没有12秒超时证据，不能写作“取消超时”。

首请求为何先close为UNKNOWN：原日志仅Error名称，尚无可靠request/interception关联及安全错误码。独立审计在 [ATTEMPT-RESULT.md](evidence/ATTEMPT-RESULT.md) 区分可确认guard条件与未知上游原因，未删guard、伪造pending、重放第二轮或更改产品。不是已确认产品取消缺陷。

正常GUI Alt+F4关闭，UTC11:15:40.557 exit0，owner.lock释放；before/after完整快照SHA相同。C-R3运行取消、R4在途关闭重开仍待有效前提；后继先做独立透明诊断，不能把当前completed写成cancelled。原脚本、完整日志、审计、快照和实际完成截图归档，保留未完成事实。不push/发布，不整体暂存共享树或操作原聊天窗口。
