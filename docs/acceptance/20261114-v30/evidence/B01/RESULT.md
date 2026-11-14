# B-01 候选验证结果

> 额度交接：统一协调报告五小时剩余 12%，停止新增测试与修改。候选源码维持 [PATCH.md](PATCH.md) 所列 SHA；本包 22 项观察池测试及 1 项装配测试为隔离局部证据。统一首轮类型检查通过，统一 lint 有 C/D 便携测试 globals/unused assignments 问题；全量回归未通过，多数在使用系统 TMP 的 `StorageClient.open` 处返回 `UNSAFE_PATH`，不能归因于 A-01 guard。本包没有复跑该全量：后续由统一协调在 D 盘统一副本下设置新的 `OUCL_TEST_ROOT`，使测试脚本重定向 TEMP/TMP 后复验，保留原 full-r1 失败。尚未合入 main。

## 最新续办：观察池预算通过，待统一复核

统一协调已明确本次八订阅预算仅覆盖 `TaskObserverPool` 及同 ownerKey 的跨根新池；`LaunchControls` 等其他 bridge 直接调用不属于该预算。按此范围，22 项 observer 测试及 1 项实际 `taskPool` 装配测试通过，候选可交统一协调复核；本聊天未自行整合。不能据此声称全 renderer 的物理订阅总数不超过八。

协调者选择保守预算后，候选 `TaskObserverPool` 使用模块私有 `WeakMap<object, number>`，以原始 `window.oucl` 为键；尝试订阅前保留一个槽，最多八个，不因 `dispose()`、失败、超时、隐藏、旧 pool 关闭或迟到回执而复用未知槽。槽耗尽后同一共享读取预算下使用 `getTask`，`confirmed` 只表示最近查询可达，不保证仍有事件订阅。若包装器中的排队操作被取消、最终没发出，额度也会保守消耗。

生产 `InstallPanel.tsx` 换根会创建新的包装 bridge；候选仅在内部装配时将原始 bridge 作为第二个私有构造参数，公开 bridge/IPC DTO、通道和存储不变。继续使用真实 `rendererTaskReads` 约束跨池在途数和 500ms 启动节奏。

- 最新 fake-timer 定向测试 **22/22 通过**，包括之前“退订延迟 + 显式重连”反例，见 [budget-final.log](evidence/budget-final.log)；原 [current-tests.log](evidence/current-tests.log) 的 21 通过、1 失败原样保留。
- 从候选实际 `InstallPanel.tsx` 构建的 `taskPool` 装配测试 **1/1 通过**：[assembly-tests.log](evidence/assembly-tests.log)。仅构建时暴露原私有函数、替换 React 和 launcher hook；保留生产观察池、`taskPool` 包装及 `rendererTaskReads`，模拟旧根两个在途订阅、切根后新包装对象、迟到回执、四次显式查询和隐藏/恢复；模拟观察池远端峰值 8、跨池 in-flight 峰值 2、每秒最多两次启动。不是实际 Electron 或操作系统层证据。
- 候选严格类型检查覆盖 `task-observer.ts`、实际 `InstallPanel.tsx` 及测试，退出 0；三个改动文件 ESLint 退出 0；observer 浏览器 esbuild 与装配测试构建退出 0。未运行整应用构建或全仓测试。

实际命令（工作目录 `.../b01/candidate`，工具均为 `D:/MC_start/OUCL-download-main/node_modules`）：`node .../esbuild/bin/esbuild tests/task-observer.test.ts --bundle --platform=node --format=esm --target=node24 --outfile=../evidence/budget-final.mjs` 后 `node --test ../evidence/budget-final.mjs`；`node .../typescript/bin/tsc --noEmit -p tsconfig.b01.json`；`node .../eslint/bin/eslint.js --config D:/MC_start/OUCL-download-main/eslint.config.mjs src/ui/task-observer.ts src/ui/InstallPanel.tsx tests/task-observer.test.ts`；`node .../esbuild/bin/esbuild src/ui/task-observer.ts --bundle --platform=browser --format=esm --target=es2023 --outfile=../evidence/budget-observer.js`。装配验证在 `.../b01` 运行 `node assembly-build.mjs` 和 `node --test assembly.test.mjs`。各命令退出 0；池外范围说明单独的 `node --test outside-bridge.test.mjs` 如预期退出 1，不能计入通过。

### 范围排除：观察池外的现有订阅

`D:/MC_start/OUCL-download-main/src/ui/LaunchControls.tsx:28`–`:45` 对同一 `window.oucl` 直接调用 `bridge.subscribeTask`，不经过观察池或其 WeakMap。`D:/MC_start/OUCL-download-main/src/ui/App.tsx:74`、`:87`、`:95` 保留隐藏的 home 节点，下载页任务中心可与仍挂载的启动控件并存。静态触发条件：观察池已有八个有效或未知订阅时，启动控件仍有一个进行中的启动或停止任务并发出订阅。

本轮 [outside-bridge.test.mjs](outside-bridge.test.mjs) 使用实际 `taskPool` 装配和同一假 bridge，在观察池建立八个订阅后直接模拟该池外调用：断言全 bridge 峰值不超过八失败，峰值 **9**，见 [outside-bridge.log](evidence/outside-bridge.log)。没有实际执行 React `LaunchControls`、Electron 或游戏；代码调用路径与模拟反例表明当前候选只能限制**观察池自身发出的订阅**，不能证明其他调用者参与时全 bridge 的严格上限。

统一协调已明确本次八订阅上限只针对观察池与同 ownerKey 的跨根新池；不扩改启动控件或 bridge。保留池外反例作为范围说明，不把它当本轮要求失败，也不声称全用户路径远端峰值不超过八。B-02 未修改。

候选现有三个修改文件及 56 个复制源文件 SHA 见更新的 [PATCH.md](PATCH.md) 和 [source-sha256.json](evidence/source-sha256.json)。本轮未运行全量、GUI、游戏或改变主仓库。以下是上轮历史记录，保留当时失败与方案，不代表最新候选状态。

2026-11-14。状态：**待协调，候选不能整合**。九个活动任务的自动确认饥饿已在独立候选复现并缓解，但严格的“远端同时最多八个订阅”在延迟退订与显式重连组合下未满足。未改动 main、活跃共享树、冻结副本或 IPC；未启动 GUI、游戏或选择器，也未提交、推送、发布或运行不相关全量测试。

## 候选与来源

- 候选目录：`D:/MC_start/OUCL-review-round-20261114/P-B/verification/b01/candidate`，非 Git 工作区；产品来源 `D:/MC_start/OUCL-download-main`，开始 HEAD `262d757ecad08add5a0db16817b2adab01b98149`，产品基线 `fab0ac873f34d8581bf065e14fa7a9aa93c0baa3`。
- 唯一改动的生产源码：`candidate/src/ui/task-observer.ts`；测试：`candidate/tests/task-observer.test.ts`。新增候选专用 `candidate/tsconfig.b01.json`，其余 `src/core` 和 `src/shared` 是类型/打包所需的只读拷贝。所有 52 个原始文件的源 SHA256 见 [source-sha256.json](evidence/source-sha256.json)，改动与候选 SHA 见 [PATCH.md](PATCH.md)。
- 额度首次核对五小时已用 4%，中途已用 35%；周额度未作为门槛。

## 修复前和候选证据

先在原样源码上增加 fake-timer 九任务场景：10 秒后第九项仍 `unconfirmed`，预期 `confirmed`；17 项中 16 通过、1 失败，见 [baseline.log](evidence/baseline.log) 和保留的 [baseline.mjs](evidence/baseline.mjs)。

候选超过八项时保持七个稳定订阅位和一个到期轮换的单次读取位；八项及以下保留原订阅逻辑。调用上限仍为每 500ms 最多一次、并发最多二；在途项不被轮换位抢占。即时响应 fake-timer 夹具中，九任务首轮在 4.5 秒内全部确认；65 秒内每项至少三次确认，相邻确认最大间隔不超过 16.5 秒；100 个持续活动任务在 90 秒内均至少首次确认。连续轮换不重复订阅；旧 generation、隐藏页面、终态与显式重连等既有/补充测试见 [final-tests.log](evidence/final-tests.log)，当时 21/21 通过。

随后为验证实际要求补充“退订确认延迟 + 显式重连”对抗夹具：原有八个远端订阅中一个 `dispose()` 后模拟远端 3 秒才释放，再显式重连第九项；可观测的远端订阅峰值为 **9**。当前候选完整定向结果 **21 通过 / 1 失败**，见 [current-tests.log](evidence/current-tests.log)，原失败独立保留 [delayed-release.log](evidence/delayed-release.log)。这是可控假桥/fake-timer，**不是实际 Electron 复现**；但严格八远端订阅条件未能证明且模拟反例成立。此前 21/21 只是加入此反例之前的结果，不能称当前候选全通过。

当前候选 `tsc --noEmit -p tsconfig.b01.json` 退出 0、指定两文件 ESLint 退出 0；浏览器目标 esbuild 对候选 observer 打包退出 0，见 `evidence/typecheck.log`、`lint.log`、`build.log`。这些是局部检查，不是完整应用构建或完整仓库验证。

## 冲突与待协调决定

已有 `D:/MC_start/OUCL-download-main/src/ipc/preload-instances.ts:65`–`:68` 的 `dispose()` 返回 `void`，异步发送 `events:unsubscribe`，观察池无法知道主进程已实际释放或回执丢失。强行轮换并重新订阅可以保证本地 `admitted` 不超过 8，但无法由 `dispose()` 证明远端已释放，故本候选不应被当成满足严格物理订阅上限。

可供统一协调选择：

1. **推荐设计，待边界审查**：保留现有 `events:unsubscribe` 通道和 schema，在 preload/本地桥提供可观察的退订完成结果；仅收到确认或 sender 销毁后释放订阅额度，未知结果继续占位；额度不足时使用按预算的单次读取。需要改变桥接 API/类型及跨进程行为，当前“不得改 IPC”的派发不覆盖实施，是否需额外批准由协调者判定。
2. **不改桥的保守降级**：每次退订后的远端额度一直按未知占用保留，耗尽后只轮询，不再接纳新订阅；可确保不因复用未知额度而越界，但长期运行可能永久降级、显式重连不能保证重新获得订阅，与原重连体验有显著取舍，也不应未经明确接受直接替换。

请协调者先确定上限指本地逻辑还是必须覆盖远端未确认退订、以及可接受的桥接/降级边界；本聊天不自行扩大实现。B-02 未修改。

## 可复现命令

工作目录 `.../b01/candidate`，现有工具链均为 `D:/MC_start/OUCL-download-main/node_modules`：

1. 修复前保留产物：`node --test ../evidence/baseline.mjs`（预期退出 1，原饥饿断言失败）。
2. 当前候选：`node D:/MC_start/OUCL-download-main/node_modules/esbuild/bin/esbuild tests/task-observer.test.ts --bundle --platform=node --format=esm --target=node24 --outfile=../evidence/current-tests.mjs`，再 `node --test ../evidence/current-tests.mjs`（当前预期 21 通过 / 1 失败，峰值 9）。
3. 类型：`node D:/MC_start/OUCL-download-main/node_modules/typescript/bin/tsc --noEmit -p tsconfig.b01.json`。
4. lint：`node D:/MC_start/OUCL-download-main/node_modules/eslint/bin/eslint.js --config D:/MC_start/OUCL-download-main/eslint.config.mjs src/ui/task-observer.ts tests/task-observer.test.ts`。
5. 局部构建：`node D:/MC_start/OUCL-download-main/node_modules/esbuild/bin/esbuild src/ui/task-observer.ts --bundle --platform=browser --format=esm --target=es2023 --outfile=../evidence/task-observer.js`。
