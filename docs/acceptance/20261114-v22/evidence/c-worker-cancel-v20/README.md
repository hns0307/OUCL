# C-R3真实JAR Worker生命周期故障注入：仅准备

开始五小时used43%、剩57%。未启动产品/Worker/GUI；仅静态阅读及node --check。固定v3七产物/已关闭v4-bc profile；旧网络材料不改。本场景是生命周期故障注入，不称自然产品时序或网络取消通过。

原entry `src/services/workers/entry.ts:202–207`完成真实scanModArchive后post原结果再port.close，没有process.exit。独立--require模块只增加一个引用计时器，故理论上port.close后线程仍存活。原ModArchiveReader.ts:25–34接收真实消息，但必须等exit才能resolve；GUI取消会由原AbortSignal→原Reader stop→terminate→真实exit后reject CANCELLED，registry才应cancelled。

透明ObservedWorker继承真实Worker，只有第一个workerData.kind=mod-archive增加execArgv的--require和私有日志env；entry/workerData/resourceLimits和原结果不改，storage/其他Worker选项不变。私有module只写worker-private.jsonl的loaded标记，不向parentPort增添消息。parent监听原message记录kind，不改消息。terminate只委托原方法并记调用，harness从不自行terminate。

**运行时支持尚未实测**：Electron可能拒绝execArgv或worker环境；若worker-error、无keepalive-loaded、没有原mod-archive-result，记未形成场景并停止，不修改entry/换假结果。父观察器记录原message抵达，不能冒充独立子线程“post调用完成”的测量。

主协调启动（仅一个cancel模式）：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\c-worker-cancel-v20\window.cjs'
```

先将A的alpha-provider按钮置于可见位置，点一次预览。确认worker-private的keepalive-loaded、window日志原mod-archive-result及UI running，再立即GUI点取消，必须在原Reader30秒timeout前完成（不要修改timeout）。核对cancel IPC先于terminate、真实worker-exit先于cancelled原回执，DOM显示取消。然后GUI新预览应以新UUID完成；只有首Worker注入，后继正常退出。最后正常关闭exit0、owner释放并核对6JAR5任务。

若先触发30秒timeout、没有cancel IPC或父线程退出前无worker-exit，不计运行取消PASS。所有清理由原Reader取消/timeout或main.shutdown的close触发；不存在测试壳直接terminate兜底，避免掩盖失败。keepalive本身不等待父消息、不持有shutdown锁，原Worker.terminate不依赖JS计时器配合；若运行时仍挂起，保留现场让主协调处理，脚本不强杀。

R4正常关闭/重开不是本轮模式，不同时再写第二壳；本壳正常关闭仅作安全退出，不自动算R4在途退出通过。网络始终拒绝，无自动业务请求或GUI点击。window.jsonl存在拒绝覆盖。
