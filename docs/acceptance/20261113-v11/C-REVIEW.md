# C 真实保留期 harness 静态复核

日期：2026-11-13（北京时间）。本次只读核对C证据、既有TASK_PLAN/DECISIONS/AGENTS，并新增本报告；没有运行GUI、调用窗口bridge、写脚本/产品、修改数据或触及ADE的v11整改目录。五小时已用36%、剩64%，满足门槛，周额度不作门槛。

## 当前结论

**静态方案可用；真实过期结果仍待验。** 核查时 `v11-retention/retention-proof.json` 不存在。不能将计划中的15分钟读取或后续GUI新预览记作已经PASS。

证据根：`D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/`。受审对象仅此处v9/v11-retention及原v4-bc数据快照，不是ADE的 `OUCL-acceptance-v11-20261113` 新代码。

## v9正常关闭与数据保持：PASS（限定层级）

`v9-retention/window.jsonl`末三条记录：

- window-closed：2026-11-13T05:01:11.362Z（北京时间13:01:11.362）。
- will-quit：05:01:11.406Z。
- exit code0：05:01:11.406Z。

`v4-bc/state-v11-after-close.json` 与 `state-v9-before.json`：六个JAR的相对路径、大小、SHA256逐项相同；五条tasks完整行（id、owner、kind及execution序列化内容）逐项相同。两文件本身SHA256也相同：`54022A3779ED8CC3EBFCFCAED6BEC28C0F4D519AD6ADD6D6BCA2CC4FEA01653D`。证明这些物证未被本轮预览/正常关闭改变，不外推为整个Electron profile/操作日志全文件不变。

主协调记录旧owner释放；本次没有在旧窗口关闭、v11开启之间重新做锁不存在的独立采样。当前owner.lock存在是v11窗口仍运行期间的状态，不应误报旧锁未释放。v11正式服务已能生成真实completed预览，也支持新进程取得了可用仓库，但不把这一点冒充强制中断接管验收。

## v11产物、时钟和观察方式：静态PASS

`v11-retention/window.cjs` 启动前逐文件校验 `acceptance-results/product-manifest.json`，写verified-product.json后require原product/main/index.cjs。本次另行读取七个实际产物计算SHA256：**7项匹配、0不符**；verified-product与原manifest逐项一致。

harness设置独立原v4-bc userData、禁硬件加速、清portableRoot、拦截外网、调整窗口几何和读取DOM。这些不替换domain/preload/renderer。它确实封装了 `ipcMain.handle` 的注册函数，因此不描述为“完全未触碰IPC注册”；包装器始终先await原handler、记录原输入/返回、再原样返回result，没有构造成功响应、改payload、缩短TTL或替换Mod服务。

未发现对Date、Date.now、performance.now、setTimeout的改写或人为推进时钟。product registry默认 `now=()=>performance.now()`、RETENTION_MS=900000；terminal记录finishedAt。harness仅读取performance.now并用正常setTimeout等待900500ms，不向registry注入now。

首次接纳和真实轮询记录已关联：

- requestId：`c8259418-9770-4c95-8432-89624ced6bf2`。
- previewId：`dc32e96a-34b0-4120-a340-af21342888c3`。
- A实例：`40000000-0000-4000-8000-000000000002`，provider fileId=`5da4231cf237720955df0df9428eb534720d4b54df77edce98aca0f1c6b6014c`。
- first-completed.json：completedObservedAt=`2026-11-13T05:06:05.247Z`，completedObservedMono=`172888.5977`，与window.jsonl同previewId的running→completed响应一致。

主进程真实finishedAt不晚于harness观察completed，因而从观察点再等900500ms是保守延后。预计最早计时触发约05:21:05.747Z（北京时间**13:21:05.747**），之后还需执行两个异步IPC；不能仅凭墙钟到时判断测试完成。需看真实proof的elapsedMs和响应。

该设计能证明“同进程未伪造时钟、观察完成后真实等待超过15分钟，旧观察和同requestId重试被拒绝”的代表路径；不证明精确900000ms边界、15分钟前每一时刻均可读、全部取消/并发/重开竞态。

## 实际proof生成后的必核项：当前DEFERRED

1. retention-proof.first与first-completed的requestId、previewId、完整规范input一致，elapsedMs≥900500（且window日志monoMs连续支持真实经过时间）。
2. oldStatus `ok=false/error.code=PREVIEW_EXPIRED`；oldAdmission按**同requestId和同input** `ok=false/error.code=PREVIEW_EXPIRED`，没有成功新previewId或悄悄再扫描。
3. 对应window.jsonl的preview-public记录与proof一致，无retention-error/retention-incomplete。若超时/不可用，不能解释为过期PASS。
4. 主协调随后GUI新预览需产生新requestId和新previewId，并真实达到新completed/blocked或unknown；只看到按钮可点或成功点击不等于接纳/完成。
5. 若补只读不变性，则读取新的事后快照与既有六JAR/五任务比较；现在的state-v11-after-close仅覆盖旧v9关闭，不能提前充当v11十五分钟等待及新预览之后的快照。

注意：计时器通过executeJavaScript直接调用公开bridge读取旧状态/重试旧请求，它不会把错误回执自动送入组件自身state。因此这份proof即使通过，也主要关闭**真实main/preload/registry保留期与幂等过期**证据；不自动证明UI组件收到PREVIEW_EXPIRED后的恢复提示/按钮状态全部路径。后续GUI新请求可证明用户能重新发起观察，仍需与组件定向恢复证据分层记录。此处无产品整改建议或新业务授权。

## 指纹与范围

受审harness SHA256：`39339CC769BCF0A6EB43883FD0735B93FA8B67B4CC9EEAB5012869808D3D5BFE`。数据为原合成非可执行JAR/元数据，平台受控拒绝，非真实游戏兼容或上游网络证据。未操作当前PID33772或旧PID13064，仅核对主协调提供路径中的静态文本/日志。

本报告是proof生成前的快照；实际结果以后续主协调证据及明确追加为准，不预测PASS，不因此前窗口长时间存在而假定已执行过期回调。

## 第二场景：真实completed回执延迟，供GUI触发组件过期恢复

按主协调追加授权，仅新增 `D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v11-retention-delay/window.cjs`；没有改第一场景harness、产品、profile、源码或UI，也未启动窗口。`node --check`退出0，无语法诊断；SHA256=`AD0308C2CA4E4E6EDE3EC96365240AF60F1BFAFFAA39CE11C02F849057E3C678`。

### 设计为何能触发真实组件路径

核对的是**v3固定源码/七产物**：preload-maintenance-preview.request以Promise.race正常3秒产生TIMEOUT；MaintenancePreviewPanel在status失败后保留queued/running snapshot及previewId、停止自动轮询，并显示“重新查询预览”。v3已包含observationError：后续status为PREVIEW_EXPIRED时失效代次、清snapshot/requestId、显示过期并允许新预览。原活跃树旧组件不是本测试加载的代码，不能混用其行为推断。

新harness先执行原handler，再只将**首次接纳previewId对应的首个真实completed状态响应**延迟900500ms返回。之前真实running响应不延迟，接纳也不延迟；其他请求均原样返回。没有调用domain executor替身、改变schema/TTL/时钟或构造TIMEOUT/EXPIRED：TIMEOUT来自真实preload，15分钟过期来自真实registry。

预期链：GUI发起→正常取得previewId→实际扫描完成→该次status回执被hold→preload超时→真实组件显示查询入口且仍保留原ID→真实900500ms到期后GUI点重新查询→真实服务返回PREVIEW_EXPIRED→组件解除旧活动态→GUI再次点预览以新requestId/previewId接纳。只读延迟是**测试层回执故障注入**，不是自然网络/IPC故障。

### 主协调精确启动与操作

必须先正常关闭第一场景窗口并保存它的结果，再运行：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\v11-retention-delay\window.cjs'
```

复用原v4-bc合成profile和原v3七产物，启动时核对七项哈希并写本目录verified-product.json。选A同一provider，点击一次“预览禁用影响”。handler真实completed后写first-delayed.json：原requestId/input/previewId、status requestId、completedHandledAt/Mono及filename。稍后核对DOM/截图显示TIMEOUT与“重新查询预览”；**等待期间不要提前点查询、取消、切实例或刷新组件**，否则立即返回的第二份completed可能把组件推进终态，失去本场景前提。这是操作约束，不自动屏蔽产品按钮。

等待本目录deadline-reached.json及old-status-at-deadline.json生成（前者elapsedMs≥900500、后者旧ID真实PREVIEW_EXPIRED），再由主协调GUI点击同文件“重新查询预览”。核对过期提示、旧活动/取消/查询入口清除且新预览按钮恢复；之后GUI新预览，记录不同requestId/previewId及真正completed。harness从不自动点击或新接纳。

### handled/delivered/DOM不能混淆

- `handled`表示原handler已产生真实结果，不表示preload/UI已收到。
- `response-held`记录被延迟的唯一回执；900500ms后`delivered`仅表示原result已释放给invoke完成，**不是渲染已消费确认**。该调用通常早已由preload的TIMEOUT返回，迟到completed不会重新写组件状态。
- 到期自动探针只调用公开 `maintenancePreviewStatus(原ID)`，不重试原requestId、不写组件state；它不能代替GUI查询产生的PREVIEW_EXPIRED组件路径。
- `dom`每秒只读记录所选实例、完整面板、每文件previewText/alerts/button disabled，并记录nodeAbsent。GUI新查询/接纳的handled/delivered和DOM变化须关联同文件及ID，不能仅凭handler记录称UI成功。

窗口closed、before-quit或will-quit都会清DOM计时器、清唯一延时timer，并以**同一真实结果**resolve悬挂handler，不调用取消业务。提前关闭将记录delivered reason为关闭/退出且elapsed不足，不能计15分钟PASS。窗口销毁后不执行到期探针；探针出错仅记录probe-error，不补造结果。

### 尚待实际证据

当前仅**设计/静态准备**成立。没有运行此壳、执行任何15分钟等待或真实组件点击。完成后至少需要：①同一文件TIMEOUT/查询按钮DOM；②first-delayed与到期elapsed真实时间；③GUI查询原ID的PREVIEW_EXPIRED；④组件按钮恢复；⑤新requestId/previewId及completed；⑥正常关闭exit0及需要的不污染快照。保留第一场景与本场景各自日志，前者的自然过期结果不能替代本场景故障注入后的UI路径。
