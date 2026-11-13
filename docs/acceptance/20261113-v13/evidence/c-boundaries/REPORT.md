# C-R7预算 / C-R8保留上限有限补证

2026-11-13。本次明确授权范围仅C-R7的混合512/513预算、C-R8终态容量/TTL/tombstone。五小时开始已用51%、剩49%，满足门槛；未以周额度作门槛。未扩展R2–R6，未运行GUI、IPC或当前15分钟验证器，未改冻结src/tests/dist、产品/持久格式/时钟/旧证据或提交。

## 结果：9 PASS / 0 FAIL / 0 SKIP

实际执行：在v3副本cwd运行 `node acceptance-results/c-boundaries-v13/run.mjs`，退出0。测试直接调用正式MaintenancePreviewJobs、presentMaintenancePreview及共享isMaintenanceDisplay，输入为独立合成内部事实；registry使用既有constructor now接口，未改Date/performance/timer或生产代码。无Electron/真实worker/GUI/平台网络，此处不升级为那些层级的证据。

| 用例 | 实际结果 |
| --- | --- |
| 六组混合总512 | providers80、issues80、relations80、direct128、transitive143、platformFailures1，恰好512；incomplete=false，schema有效，输入不改。因真正输入的NETWORK_FAILED而unknown，不是截断 |
| 无平台失败的混合512 / 增加第513项 | 512时ready且不截断；新增末尾failure作为513项后，输出512、incomplete=true、unknown，schema有效 |
| 六组混合513且原blocked | 仅保留预算内512项，额外failure截断，incomplete=true；原blocked保留，不误降成ready |
| 16 completed未过期 / 第17项 | 16个结果全可读、旧requestId幂等；第17SCAN_BUSY，不逐出旧项；899999ms仍满，900000ms到期后新请求可用 |
| 16 failed未过期 / 第17项 | 同上，failed真实来自合成service抛SCAN_FAILED，原结果errorCode保持；不是手工改registry状态 |
| 16 cancelled未过期 / 第17项 | 同上，每项queued时经正式cancel到终态，service未被调用；无手工Map修改 |
| failed TTL899999/900000 | 到期前get/cancel/same-request都回原终态；恰到期get、cancel、原requestId重试均PREVIEW_EXPIRED，不增加扫描；新UUID可接纳 |
| cancelled TTL899999/900000 | 同上；到期前后result=null、errorCode=null，且取消本身不启动扫描 |
| 4095 / 4096 tombstone | 通过4095次start→真实完成→注入时钟+900000→get过期产生tombstone，此时第4096项仍可接纳；该项完成并过期后，新请求SCAN_BUSY，首/末旧请求均PREVIEW_EXPIRED、调用数不变；新registry清空上限，新请求完成，旧previewId不恢复 |

计数为9个独立Node test，无父级子测试重复计数。最后一项4096边界只用公开start/get/close和既有clock依赖注入；未访问或修改private jobs/requests/expired集合。

## 证据位置与来源

完整本轮记录：`runs/2026-11-13T06-34-17-179Z/`。

- tests.log：完整9项输出，约283ms，退出0，无失败需要掩盖或重试。
- result.json：退出码、Node v24.21.0、范围及unchangedSources=true。
- source-sha256.json / source-after-sha256.json：所有实际esbuild运行时源输入及本次runner/test的SHA256，运行前后逐项一致。
- build-metafile.json：实际打包依赖输入；modules.cjs只位于本独占目录，不替换产品产物。
- 新脚本：boundaries.test.cjs、run.mjs。runner每次新建带时间戳的runs子目录保存日志，不覆盖旧轮日志。

来源哈希核对只覆盖本次实际运行依赖源和新脚本，不冒称重新校验全部597冻结文件；没有重跑无变化全套回归。所有构建/输出限于c-boundaries-v13目录。

## 可关闭的精确条目

`C-REMAINING-REVIEW.md`中的C-R7 **纯投影/共享schema混合恰512和513两侧**可由本报告标PASS；C-R7真实Electron非法sender/frame及preload异常回执仍由原证据/后续单独负责，不能整体标C-R7全通过。

C-R8 **终态16/17、failed/cancelled到期、4095/4096 tombstone与重启清空**在正式registry纯逻辑层闭合。completed TTL已有原用例；本次另外验证三终态16项到期后可重新接纳。注入clock的纯逻辑TTL结果不替代当前900500ms真实窗口计时，二者必须分别记录。

未发现本轮须改产品的真实缺陷；没有为了测试改变上限、允许extra字段、缩短TTL或绕过拒绝断言。当前主协调窗口及其原始证据完全不受本轮执行影响。
