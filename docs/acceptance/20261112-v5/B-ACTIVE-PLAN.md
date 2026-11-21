# B 活动态 / B 选择同采样最小补验

2026-11-12。仅静态审查和新辅助文件；未启动/操作 GUI、访问进程或修改 profile、产品/冻结文件。五小时实际新窗口复查已用2%、剩98%；不以周额度门槛。本次授权为主协调的现有 B 只读验收准备。

## 诊断：globalTasks 的 TASK_NOT_FOUND 来自合成准备缺项

`listTasks({limit:100})` 参数正确。v4准备使用 `modReadyInstance` 的合成 ready 记录，summary.taskId 是随机 fixture 身份；只正式创建了 mod-check，未创建安装任务。这一点已在 v4准备报告声明，但没有据此排除全局任务列表作为证据，是准备方案的遗漏。

真实路径：`src/ipc/installer-adapter.ts:146`–`:149` 先遍历 instance summary，对每个 summary.taskId 调用 installer.task；`src/services/install/installer.ts:326`–`:328` 查不到对应 install 任务会抛 INSTANCE_NOT_FOUND；adapter `:25` 映射 TASK_NOT_FOUND。这一异常发生在 `additional.list` 追加 Mod 任务之前，故全局列表整体失败。state-after-hot.json 中三个任务全是 completed/mod-check，与这一解释一致。window-v5-active.jsonl 同时有 B target 查询成功、globalTasks 的 TASK_NOT_FOUND，不能用该全局错误推断 A 任务不存在。

因此目前证据不能证明“真实安装完成的正常用户数据也会触发全局列表缺陷”。不修产品、不补造 install completed、不把合成实例改写成真实安装验收。此 profile 的全局列表能力不适合验收；隔离目标查询与单任务 get 仍可独立验证。

## 现有日志检查

静态扫描 cold=198份public-and-dom（无globalTasks字段），hot=38份（有globalTasks字段），两者选择过A/B且正常退出0。提取器 `extract-active.mjs` 对当前 cold/hot 返回 NOT_COVERED、证明3个任务的实例归属，0个“A活动/B选择”证据。完成任务与B截图不能代替这一缺项。

原 window-active.cjs 每1.5秒采样，先捕获选择/DOM，然后依次 await handshake、globalTasks、selected targets。即便globalTasks成功，也只是顺序读；不能声称数据库/DOM原子同时快照。harness Modrinth hold5000ms、正式客户端 NETWORK_FAILED 后250ms退避并只重试一次，每次请求12秒上限，通常可形成约10秒等待窗口；这不是硬保证或真实上游延迟。

## 最少下一步（主协调唯一执行窗口）

1. 正常关闭当前 window-active 对应产品窗口，等待进程退出；不要删profile。新入口仍用原 v4 profile 和生产包（含现有至少3个完成任务及本轮新增任务）：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\v5-bc\window-targets.cjs' '--bc-run=targets'
```

2. 选 A，等已有动作空闲后点一次“一键检查”，**立即选B**，停留约4秒。无需中途看日志、打开任务页或再点第二次检查；网络层最多5秒延后取消，正式平台重试仍由产品自己执行。
3. 在B保持选择，等待约15秒让A正常完成，再正常关闭窗口。提取：

```powershell
node acceptance-results/v5-bc/extract-target-proof.mjs window-targets.jsonl
```

主协调如已具备当前 main 的 executeJavaScript 访问，可在当前窗口直接执行 v5-bc/sample-readonly.js 的表达式，避免为取证重启；但它最初依赖globalTasks，当前不推荐。**推荐新 window-targets.cjs 自动只读采样**，不修改/热替换旧harness或产品。未创建任何额外 GUI 控制接口。

## 新 harness 的精确断言与证据

新文件位于 `D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v5-bc/`，只设置独立userData（既有v4 profile）、网络拦截和记录公开bridge/DOM；原产品main/renderer/preload、domain服务全部沿用，不替代hooks或领域仓库。网络仅受控拒绝，不构造平台成功。

每1秒、同一串行采样：

1. DOM 捕获 beforeSelected。
2. `listInstanceTaskTargets(A,mod-check)` 找到真实活动 taskId，获得持久归属链。
3. `getTask(taskId)` → activeBefore。
4. `listInstanceTaskTargets(B,mod-check)` → bTargets。
5. `getTask(同taskId)` → activeAfter，再读 afterSelected/reportInstance。

BRACKETED_WITNESS 必须同时满足：前后选择=B，显示报告实例=B；A目标返回全页且每行属于A；B目标返回全页且每行属于B、不含A taskId；同一A任务在B读取前后均为queued/running/verifying/committing/pausing/cancelling/failing（不把completed或needsRecovery当活动），after revision不回退。提取器再独立核对aTargets中的活动绑定、两次get身份/活动、nodeAbsent；不能只相信harness打印的verdict。

每条 `target-proof` 记录包含startedAt/finishedAt、前后选择、A/B目标请求ID、两个真实getTask DTO和DOM。输出 `proof-window-targets.json` 给出源行号、taskId、前后状态及B taskIds。结果有证据则 BRACKETED_WITNESS_FOUND/exit0，无证据则 NOT_COVERED/exit2，不自动改判通过或重放检查。

这提供“B读取被同一A活动任务前后夹住且选择稳定”的顺序IPC证据，强于原globalTasks单读，但仍不是跨进程原子事务或绝对无外部操作的数学同时性证明。不得称真实上游游戏/平台网络验收。

## 已新增与实际执行

- `extract-active.mjs`：旧日志按同采样globalTasks+目标归属提取，既有数据只返回NOT_COVERED；输出analysis-baseline.json和baseline.log。也已扫描v5-active尝试，输出analysis-v5-attempt.json，不将global失败计为A活动。
- `window-targets.cjs`：新独立生产壳启动harness，不自动点击/写业务。
- `extract-target-proof.mjs`：独立校验新harness公开DTO证据，输出精简行号/身份摘要。
- `sample-readonly.js`：最初准备的可选读取表达式依赖globalTasks，保留研究记录，**本profile勿用作新通过证据**。

`node --check window-targets.cjs`、`node --check extract-target-proof.mjs` 均无语法诊断。没有运行新harness或调用真实窗口bridge；尚无window-targets.jsonl和真实新采样通过结果。所有新增文件仅在指定v5目录及本报告，未改旧harness/network-hold/profile/冻结源码。
