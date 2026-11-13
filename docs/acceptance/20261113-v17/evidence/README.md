# C-R3 最小运行取消场景准备

状态PREPARED，未启动GUI/网络/IPC，未称真实取消通过。五小时开始used44%、剩56%。只新增本目录脚本/说明，复用固定v3七产物/原v4-bc合成profile；不改服务、preload、回执、时钟或旧场景，不扩展R4第二壳。

## 可观察层级与限制

固定产品实际走 `createDesktopFetch(options=>net.request(options))`，并非net.fetch。`src/main/network.ts:22–24`的AbortSignal监听调用原ClientRequest.abort并reject；`modrinth.ts:71–94`负责把外层取消传入真实controller，保留12秒自身超时。harness不patch AbortController/Signal，也不能直接取得这个私有signal，故**只直接计量原请求abort调用、abort/close/error事件**，结合GUI取消入口和固定控制流关联，不虚称测到了signal identity。

Electron本地类型定义ClientRequest支持abort及close，close是该请求事务的最后事件。harness原样调用net.request返回同一个真实对象，仅对abort做委托记录并监听事件；不替换返回、伪造HTTP响应或业务成功。只有第一个Modrinth `/v2/version_files` 的webRequest callback暂留，不放行外网；这发生在正式inspection await首次库存/JAR扫描之后，所以“首轮scanner已结束”是固定控制流推论，不是另加假的worker计数。

GUI取消或产品12秒超时触发原request.abort后，harness以`cancel:true`释放已有拦截callback，避免Chromium仍保留interception；这不是返回HTTP成功。callback还会在真实close、正常关闭或15秒测试安全清理时取消释放。若走15秒安全清理、提前关窗、自动12秒timeout先于GUI，均不能计本次运行取消PASS。没有强行resolve domain结果或强杀请求/进程。

## 主协调操作（唯一GUI控制）

先确认旧profile窗口已正常关闭：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\c-cancel-v15\window.cjs'
```

1. 选A并提前把alpha-provider.jar的按钮放到可见位置。点一次预览，待其显示正在检查、取消按钮可用，**立即点取消**。网络开始后的可用窗口只有产品原生12秒，不能修改这个deadline；避免临时切页/滚动浪费时间。`network-pending.json`作为辅助标记，无需等待人工打开它才点取消。
2. 取消后应得到真实cancelled（不是completed或failed），界面显示“模组检查已取消”。首次网络的原abort调用/event与close必须在日志真实出现；不得只看取消按钮消失就认定网络退出。
3. 旧请求退出后再手动点同文件新预览；新requestId/previewId，后续所有网络立即拒绝，正常completed/blocked或unknown，证明lane可用。harness从不自动新接纳、查询或点击。
4. 正常关闭，记录exit0/owner释放，按主协调已有inspect-state方式比六JAR/五任务不变。若超时、挂住或未见close，保留失败和明确未闭合，不以安全回调清理当作用户取消成功，不自行重放第二轮。

## 有限判据

- 同一原previewId出现真实running状态及对应文件DOM；首version_files请求确实network-pending，无response放行。
- `mods:maintenancePreviewCancel`的ipc-received早于原请求abort，且abort在12秒产品timeout之前；原结果cancelled，原请求有真实close。记录事件先后，不凭handler结果推断UI/网络已退出。
- callback释放原因是after-original-abort或close；若由test-safety/window-close触发，场景只能PENDING/未覆盖。
- DOM显示cancelled、新按钮可用；新UUID/previewId完成并进入DOM，不能只记录业务handler完成。
- 无unexpected-network-response、dom-error；正常退出。七产物启动逐SHA核对并保存verified-product.json。

运行前透明观察是否能在此Electron版本记录完整abort/close仍需真实执行，本次静态准备不声称已经实测。如果原abort后没有close，或release callback报失效/挂起，停止扩展并报告实际时序，不绕过产品结果。

## 留待后继，不在本轮开多壳

- R3完成先赢：先记录真实completed，再GUI取消原ID，应仍completed并显示原结果，不造cancelled。
- R3取消回执TIMEOUT：仅hold真实cancel响应超过3秒，保持原ID由GUI查询terminal；不能用本壳网络pending代替回执丢失。
- R4网络pending正常关窗/重开：需另一个明确场景记录退出abort/close、旧ID进程重启后过期、新请求正常；本壳关闭清理只为安全，不提前算R4通过。

脚本拒绝覆盖已有window.jsonl；物证保留。仅做node --check语法验证，未启动此窗口。原C-R2记录另追加到c-admission-v14/README.md，唯一观察身份计数不称扫描计量。
