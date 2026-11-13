# v18 精确接续

所有本轮自有窗口已关闭：E PID35092 exit0、C接纳PID23868 exit0、C取消尝试PID23804 exit0、安全首轮PID18408 exit0及R2 PID10156 exit0；owner均释放，不需用户关窗。产品源码及最终EXE未改，不重构建或重跑完整655项。v11最终EXE SHA256仍为3d9a0ebaf289a9552933c97033ffbd6a069e0a0258e3ea8322cc2a5ceb6efce6。

已通过：v14 E真实原生回调79项审计及三组有限生命周期关闭；v15 C真实接纳丢失同身份重试9项核验；v16 C正式worker/双扫描/平台解析后端3项、78源不变；v18安全可达子集六非法输入、三不受信sender及原preload坏requestId拒绝。v17运行取消NOT_EXERCISED，不能写成通过。

main在本轮后继文档提交前为569c704d29182c8e10bb1587473a9049ce0b0c8a、干净，v14-v16的51归档SHA实际复核。后继提交只精确同步v17/v18及索引/计划文档。产品仍fab0ac8代码。活跃mod_loaders交织WIP不切换/整体暂存/提交/清理；隔离Git未跟踪P-A/tools保留，不push/发布。

下一最小工作：先实际额度>=20%，读本页和v17 ATTEMPT-RESULT、v18报告。C-R3运行取消fixture在真实请求创建后约1ms close，hold条件因首对象closed而失败；目标拦截命中，但先close原因UNKNOWN。先另建诊断目录透明补安全错误码、真实request/interception关联/分支前提，不修改旧脚本/日志、不删closed guard、不重放旧壳。若无法证明真实可取消pending，不造状态或成功；可先补C-R3完成先赢/取消回执超时等独立有限格。R4网络/worker在途正常退出重开、R5三种跨实例迟到回执、R6实际窗口展示、R7非主frame/坏previewId/URL-path响应仍未全验。安全R2已跑完，不重复启动已存在runtime。

主协调是唯一CUA操作者。需要GUI时先看真实新截图与元素；本轮DPI/scroll坐标曾错位，若无IPC不记业务接纳。元素space曾触发唯一预览，但没有有效取消窗口；不把工具等待失败推断产品取消失败。可用精确set_window_frame调整自有窗口，新快照再操作，不能用shell执行GUI或绕过工具拒绝。

ADE审查聊天01a1cbcd-2f19-72c1-af8e-7bd60562e0dc idle，最新游标98c95a42-b3b2-400c-9825-ca625720cc7f:29；BC01a1cbcd-2062-7630-b618-a708b58a8741 idle，游标a4f9dcd3-648f-4abb-9339-0e842897c814:20。不重复创建/无谓恢复。原五聊天最新仅A状态游标变为9d8531a7-9c71-43da-9214-a1f6a9561140:3，仍同一历史v21结果，无新产品差异；其他四游标未变。

A实际最终EXE强制中断恢复仍受CUA派生进程终止归属限制，不shell kill/删锁/绕过；完整历史方案仍IN_PROGRESS。五小时额度门槛及独立半小时检测继续，周额度不作门槛。
