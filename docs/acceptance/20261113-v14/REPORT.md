# 增量报告 v14：E真实原生回调接线

本阶段在固定 v11 七产物、新建空资料根补 E-R1 原生选择器接线。原文档失效时主进程继续存活，原生回调真实完成、旧请求被拒绝且不启动读取 worker；新文档随后可正常选择固定样本并显示预览，最后正常退出0。没有修改产品或扩大固定只读范围。

## 同一次运行的实际事实

入口为 v11 `acceptance-results/e-boundaries-v13/native-app`，CUA 启动现有 Electron，PID35092/window5377522。小 package 将应用目录与新 native-case 资料根并列，使用原 RootService 正式建立空根；不调用私有 app.setAppPath 或放宽目录守卫。启动先逐项核对冻结七产物，外网阻断。观测壳保留原 dialog、IPC、Worker 及返回值，仅在首次 picker pending 时安排一次1500ms reload，这是明确测试干预，不是用户产品功能。

| 时间 UTC | 实际观察 |
| --- | --- |
| 10:50:33.551 | GUI 首次请求 `c0d04eed-1aae-4ceb-b3cd-ec70c9313f70`；真实 showOpenDialog 调用，界面等待 |
| 10:50:35.065–.099 | 测试壳一次 reload；真实 main-frame did-start-navigation、did-finish-load，generation 1→2；原生 picker 仍可见 |
| 10:51:19.001 | 主协调 CUA 在真实首 picker 点击取消，原 Promise 真正 resolved/canceled=true/pathCount0；原公开 handler 返回 INVALID_SENDER，packWorkers=0 |
| 10:51:55.676 | 新文档 GUI 发起不同请求 `12633022-4fc4-4271-92f9-38e638175142`，第二个真实 picker 打开，没有再次自动 reload |
| 10:53:40.877–.911 | GUI 选定既有1355字节固定样本，真正 callback pathCount1；只为第二请求创建一个原 fixed-pack worker，真实 exit0 后 handler 返回 preview |
| 10:53:41.308 | 新文档 DOM preview=true、buttonDisabled=false、alert=false、nodeAbsent=true；截图实际显示 MC1.20.1 / Forge47.4.28 / Java17 / FerriteCore6.0.1 与“当前不可安装” |
| 10:54:40.403–.453 | 主协调正常GUI Alt+F4；sender-destroyed、window-closed、will-quit、exit0；关闭后 owner.lock 不存在 |

handled/returned 不代替 UI 消费；新文档只读 DOM 与主协调查看的截图提供独立界面证据。第二 picker 导致前台 HWND 改变时，驱动动作报 foreground_unavailable；随后只读窗口及 handler 日志确认已经打开，因此没有盲目重复点击。文件名 set_value 被驱动当组合框选项拒绝，未改文件；改用新快照 Edit 的 type_text/ValuePattern 并确认完整值，再点击原生打开。

四次只读快照为 before、after-late、after-preview、closed；其 metadata JSON、tasks/requests/operations 全行摘要及空游戏文件清单保持相同，tasks0、requests0、operations1；仅 owner 生命周期正常释放。它们不宣称 Chromium 缓存零IO，也不外推所有已有玩家目录。完整原始日志、快照、脚本、静态准备说明与截图将随证据归档。

## 本阶段关闭条件与保留项

结合 v13 的服务三种 chooser terminal、新请求释放、正式 Coordinator+Reader 与真实 Worker 的结果前/消息后失效、abort/deadline 两种顺序，E-R1/R2/R3 的有限生命周期关闭条件现取得相应层级证据。真实 native 本次为“取消”分支；迟到选中路径/reject 的逻辑行为由 v13 确定性集成证明，不冒称三种 OS 故障均实测。

E仍只支持指定1355字节样本只读检查，不提供通用导入、下载、安装或文件事务；不以本次 Forge 目标信息展示当作真实 Forge 游戏启动。最终EXE正常冷热/固定入口沿用v7原层级证据，v14是固定v11七产物的受控Electron壳，不升级为新的EXE冷下载。

C后继真实接纳丢失重试场景另行准备；剩余C有限时序、A被驱动边界阻止的最终EXE强制中断恢复仍开放，完整历史方案不标全部完成。main 产品代码保持 fab0ac8，后继仅证据文档；不push/发布，不触碰原五聊天窗口/共享树源码。
