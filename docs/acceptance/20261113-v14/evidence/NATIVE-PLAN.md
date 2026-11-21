# E-R1真实native观测壳（已准备，未运行）

2026-11-13。开工额度剩28%。本轮只写本独占目录并做Node语法检查，没有启动Electron/GUI或产品，没有触碰原窗口、profile/数据或冻结代码。

入口逻辑为`native-window.cjs`，但协调聊天应让现有Electron加载**native-app目录**：

```text
D:/MC_start/OUCL-acceptance-v11-20261113/node_modules/electron/dist/electron.exe
  D:/MC_start/OUCL-acceptance-v11-20261113/acceptance-results/e-boundaries-v13/native-app
```

该小package的main指向同目录树内的`../native-window.cjs`。这样app.getAppPath是native-app，与新的native-case数据根是兄弟目录，不会误把测试数据当作“应用代码目录内部”而被RootService拒绝；不调用未声明的私有setAppPath API，也不绕过产品目录守卫。直接启动native-window.cjs会在创建case前明确拒绝。

壳启动先校验v11 dist中的七产物SHA256与product-manifest一致，创建全新native-case/profile，并通过独立OUCL_PORTABLE_ROOT由原main正式建立native-case/OUCL.games。case或日志已存在就拒绝复用，不覆盖旧现场。原main/preload/renderer/worker不替换；测试不带调试端口。

外网HTTP/HTTPS在新default/session-created的session上阻断并记录origin。原dialog.showOpenDialog参数、真正OS dialog、Promise及结果原样使用，只记录choose-called/choose-settled（canceled/pathCount/errorName，不写路径）。首次真正mrpack API调用后安排一次1500ms timer；如果仍pending且自有window存在，则webContents.reload，记录reload-intervention，明确这是测试动作。若dialog已先settle或owner已消失，则记录not-fired，不补发/重试。第二次及以后picker无自动reload。

壳不自动选择/cancel/点击/发业务IPC或关窗。协调聊天打开首picker后，应等reload-intervention与did-start-navigation/did-finish-load，再用真实控件取消首picker，观察旧PACK handler-returned为INVALID_SENDER且packWorkers=0。然后从新文档再次点按钮、选固定样本，观察choose-settled ordinal2、pack-worker-created关联第二次request、worker实际exit、handler ok preview及DOM preview。DOM采样通过只读executeJavaScript，不触发业务；界面contents和原业务结果不改。

Worker只做透明构造观测：Proxy通过Reflect.construct调用原Worker、原入口、原options，记录workerData.kind=fixed-pack-preview对应chooser/request和实际exit；不替换线程逻辑/消息、不读旧路径、不terminate任何worker。文件路径仅在壳内用于关联，不记入日志。原PACK handler返回值不改，旧异步invoke不被人为resolve成成功。

记录真实导航、sender destroyed、window close/closed、before-quit/will-quit/exit；销毁或退出时清理reload/poll timer。原生挂起Promise没有额外门闩；若OS不settle，日志明确缺settled，不能记通过或伪造取消。若reload/原生观测被平台/工具拒绝，保存限制并停止，不重复绕过。

只读数据快照脚本（不要在产品启动前误判不存在为成功）：

```text
node acceptance-results/e-boundaries-v13/snapshot-native.mjs before
node acceptance-results/e-boundaries-v13/snapshot-native.mjs after-late
node acceptance-results/e-boundaries-v13/snapshot-native.mjs after-preview
node acceptance-results/e-boundaries-v13/snapshot-native.mjs closed
```

建议before在新产品已ready、首picker未打开时执行。脚本对metadata JSON、稳定排序且同读事务的tasks/requests/operations、游戏文件内容做只读采样，明确记录目录/DB是否存在及owner标记；不建数据库、recover、登记root、造ready或写业务表。只新写native-snapshot-标签.json，已有同名就拒绝覆盖。

所有真实运行时才产生的native-case/native-events.jsonl/native-case.json/快照当前均未生成；本轮只有语法通过，不是native接线通过。协调聊天是唯一GUI操作者。
