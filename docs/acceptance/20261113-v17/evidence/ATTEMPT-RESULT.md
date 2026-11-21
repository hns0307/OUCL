# 首轮真实取消尝试审计：NOT_EXERCISED

2026-11-13。开始五小时used68%、剩32%，满足审计门槛。只读取原window.cjs/window.jsonl、生产network实现、本轮前后快照，并新增本页与attempt-result.json；未运行产品、新测试、GUI/IPC或进程操作，未修改脚本、日志、profile，未重放第二轮。

## 发生了什么

原日志25行：前期若干界面操作没有preview IPC，不能据语义点击返回认定业务启动。首次真实接纳在第7–8行，requestId=`c7a06c3a-8c8d-4790-82ac-004f416535f4`、previewId=`726f77cc-5385-44d6-bef1-9edf098a627e`。第10行status为running，第21行completed/blocked、platformFailures=[NETWORK_FAILED]。只有一次成功接纳，没有cancel IPC、原request.abort调用或abort事件。

| 日志行 | monoMs | 事件 |
| --- | --- | --- |
| 12 | 348012.1900 | 目标ClientRequest1创建 |
| 13 | 348013.3437 | request1 close（约1.16ms） |
| 14 | 348013.7831 | network-block，targetEndpoint=true |
| 15 | 348014.1218 | request1 error，只有errorName=Error |
| 16 | 348267.1612 | 目标ClientRequest2创建 |
| 17 | 348268.0765 | request2 close（约0.93ms） |
| 18 | 348268.6063 | network-block，targetEndpoint=true |
| 19 | 348268.9319 | request2 error，只有errorName=Error |

两次目标URL在session拦截器中**确实匹配**，不是“onBeforeRequest完全没被调用”。没有network-pending或network-pending.json成功标记，因而没有留出预定12秒取消窗口。

## 可确认的直接原因

`window.cjs:13`对version_files作精确URL匹配。`:29`只在heldRequest为空时选第一个目标ClientRequest；`:45`的close listener把该observed.closed置true；`:54`的hold guard要求`!heldRequest.closed`。

首次目标onBeforeRequest执行前，日志已记录request1 close。按原脚本顺序，heldRequest仍为request1且closed=true，所以hold guard不满足，进入`:63`的else，记录targetEndpoint=true并立即 `callback({cancel:true})`。这是**测试壳主动拒绝了本次拦截回调**的明确证据。

第二次创建没有替换heldRequest，因为它已非空；其指向的request1仍closed=true。第二次目标回调同样进入立即拒绝分支。除第一请求早close外，脚本还存在“首closed对象保留导致后续不能尝试hold”的关联限制。

## 不能确定的更早原因：UNKNOWN

首request为何在目标onBeforeRequest日志之前先close，原证据不够：

- 后面的`callback(cancel:true)`与error一致，但单凭该顺序不能将**此前**close因果归给后面callback。
- 只记录Error名称，没有网络错误code/message、interception/request的可靠ID对应，不能判断证书、代理、Chromium请求生命周期或其他具体网络原因。
- 无real-request-abort-called/abort-event、无cancel IPC，不能说用户取消或AbortSignal先导致close。
- 创建到close约1ms，绝不是12秒timeout证据。

生产 `src/main/index.ts` 用`createDesktopFetch(options=>net.request(options))`；`src/main/network.ts:18`给request的选项为url/method/redirect、useSessionCookies=false、credentials=omit，没有显式session/partition。拦截器装在defaultSession，且已经收到targetEndpoint=true事件。因此没有证据说URL比较不匹配或整个session未命中。日志没有记录具体request.session，亦不能再作更强的session身份测量声明。

脚本包装的是原ClientRequest，不是fetch模拟；它当前的close关联前提在本机时序下未成立。不能盲目删掉`!closed`就宣布问题修复——那可能仅把一个已close对象之后的拦截回调hold住，仍不能证明真实可取消请求正在运行。

## 安全结果与验收边界

第23–25行window-closed/will-quit/exit0，退出UTC=`2026-11-13T11:15:40.557Z`。主协调另记录owner释放，本审计没有新操作进程或锁。`state-v17-cancel-before.json`与after的整个快照SHA256相同，6JAR/5任务均保持（`54022A3779ED8CC3EBFCFCAED6BEC28C0F4D519AD6ADD6D6BCA2CC4FEA01653D`）。

本次只能记**真实预览完成、受控拒绝平台网络、正常关闭及指定数据保持**；C-R3运行取消、12秒超时、pending关窗、新预览恢复均NOT_EXERCISED。不能把一次completed正常结束改写为cancelled，不能将本轮测试壳未hold归成已确认产品取消缺陷。

## 最小后继建议（本轮不实施）

另一个独立诊断轮先记录拦截分支的全部布尔前提、heldRequest id/closed/aborted、details.id/固定endpoint/method、真实request的error.code及安全固定错误摘要；关联创建/finish/close与interception，用严格一次callback标记。不得记请求体、token或任意URL参数。先解决首early-close的可观测性，再考虑按当前request而非永久首对象关联。

如果回调hold时真实ClientRequest已经close且无法建立可用请求关联，则停止将该fixture用于running-cancel，保留UNKNOWN，另提透明网络等待方案审批。不要通过伪造响应/业务状态、缩短/延长产品timeout、强行resolve取消成功或删除close前提来凑PASS。

未更改当前window.cjs、没有自动重放。原日志SHA256=`84A7F1EAB20F75BFA7562BA0229C740B14130423CC223DA41ED11CFDBF35B659`；原脚本SHA256=`9E636A8EF35FC1BD909FB59838FAD6D7306AD1D9C804D08265C78F18BAD4AB3A`。
