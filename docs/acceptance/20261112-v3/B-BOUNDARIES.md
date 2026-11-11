# P-B v3 必需边界补证

日期：2026-11-12。执行源为独立副本 `D:/MC_start/OUCL-acceptance-v3-20261112`。开始时核对其 TASK_PLAN/DECISIONS，沿既有 B 只读契约与此次主验收明确测试授权执行。五小时额度已用 25%，剩余 75%；未以周额度作为门槛。

本次只新增 v3 的 `tests/acceptance-task-targets.test.ts`、`docs/work-packages/P-B/acceptance-v3-targets.mjs`，生成物仅在 v3 `acceptance-results/b-targets/`。活跃树仅新增本报告。未改产品源码、公共契约、既有测试或 ADE 的源码/夹具；未访问 v1/v2，未提交、未运行全量、未操作 GUI/游戏。

## 结果

定向结果 **13 PASS / 0 FAIL / 0 SKIP**，退出码 0，约 7.26 秒。计数含 5 个父级测试及 8 个子测试，不是 13 个独立端到端场景。未发现本轮须改产品源码的缺陷。

| 测试位置（v3） | 场景及结果 | 证据层级 |
| --- | --- | --- |
| tests/acceptance-task-targets.test.ts:61 | 建立 A/B 正式确认计划和 SQL 接纳，基线 B 仅返回 B；重开 worker 后删除 A 计划或只改 A 文件字节，查询 B 的 install 域均 NEEDS_RECOVERY，不返回看似完整的 B 部分页 | 真实 StorageClient → worker entry → RecordStore → SQLite/JSON；测试根外部文件故障注入 |
| tests/acceptance-task-targets.test.ts:73 | 同步测试 JSON 与 SQLite operations.after_json 后，未来 envelope 被启动恢复拒绝 NEEDS_RECOVERY；未来 plan.formatVersion 被目标读取拒绝 INVALID_RECORD；跨根 plan、requestId 不匹配、合法重算 planId 后与旧确认摘要不匹配均 NEEDS_RECOVERY；目标实例归属其他根返回 TARGET_OUT_OF_SCOPE | 真实 worker/SQLite；测试中对日志与文件同步修改，特意越过一般文件哈希拒绝以验证领域证据 |
| tests/acceptance-task-targets.test.ts:108 | 目标读取时受控 Date.now 跨过 2000ms，返回 TIMEOUT；随后 installation 读取成功，worker 没被终止 | 真实 worker/SQLite，专属 wrapper 只注入生产 mod-targets.js 调用的时钟；不是墙钟性能或慢盘验证 |
| tests/acceptance-task-targets.test.ts:136 | 两个初始请求占满全局槽，第三 sender UNAVAILABLE；约 2507ms 两请求 TIMEOUT，第三仍不能提前入场；释放原读取后无迟到 snapshot/cursor，再发新请求成功 | 生产 TargetAdapter + 真实定时器；存储/任务投影为受控替身，不是 Electron main 窗口 |
| tests/acceptance-task-targets.test.ts:156 | 16 个 sender 各取得一个 2000 行合法 DTO 快照，每份≤1MiB，总序列化 14,113,008 字节（约13.46MiB）≤16MiB；第17快照逐出最早并使旧游标失效；重放/推进产生超过256次游标后仍最多256引用，旧游标失效 | 生产 TargetAdapter + 合成合法任务投影；通过只读结构视图检查内部资源计数，无私有状态修改，不是 JS 堆内存测量 |

计划类负例改的是 A，实际请求目标是 B：缺证据时不能证明 A 无关，因此必须阻断整个请求域。除了未来 envelope 在启动阶段拒绝，其余同步日志场景确认 worker 启动成功后才执行目标读取拒绝，并验证 installation/原任务 ID 仍可查询。

公共错误映射在既有 adapter 中将 INVALID_RECORD 归为 NEEDS_RECOVERY、TARGET_OUT_OF_SCOPE 归为 OUT_OF_SCOPE；本次真实 worker 测试断言的是私有 code，不将其称为真实 preload/窗口错误展示验证。

## 实际命令与日志

cwd：`D:/MC_start/OUCL-acceptance-v3-20261112`。

- `node docs/work-packages/P-B/acceptance-v3-targets.mjs`：退出 0；仅编译 src、既有 fixtures 和本次新测试，Node 只运行本次新测试。日志 `acceptance-results/b-targets/tests.log`，摘要 `result.json`，隔离编译 `.test-build/`，各独立元数据根 `tmp/`。
- `node node_modules/typescript/bin/tsc --noEmit`：退出 0；日志 `acceptance-results/b-targets/typecheck.log`（空，无诊断）。
- `node node_modules/eslint/bin/eslint.js tests/acceptance-task-targets.test.ts`：退出 0；日志 `acceptance-results/b-targets/lint.log`（空，无诊断）。

首轮为 2 PASS / 11 FAIL，已保留 `tests-initial.log`、`result-initial.json`。是新夹具自身三项错误：误用不存在的 listTasks 方法；对未来 envelope 忽略启动恢复先行拒绝；持续重放一个已被容量逐出的游标却期望成功。修正为按实际 get API 检查任务、断言启动 NEEDS_RECOVERY、在容量循环中按新游标推进后，定向重跑全部通过。没有为通过测试修改产品代码或降低拒绝要求。

## 仍开放的验收与限制

- 本次 2000 行和 16MiB 证据是 main 合成投影；不等同真实双域各1000条完整确认计划、SQLite/worker 全链。每域1000/1001既有库存测试仍属其原层级，不能合并口述成“真实worker双域2000已验”。
- 16MiB 是 16 个≤1MiB序列化快照的上界与容量验证，不是精确占满16MiB边界或进程峰值。合法快照样本为14,113,008字节；本次没有新增1MiB/2MiB超限负例，不将其记为通过。
- worker 2秒测试用目标读取调用栈限定的测试时钟注入，未模拟真实慢盘/共享队列等待；main 2.5秒则使用真实定时器，两者证据分开。
- 未新增真实产品壳 A/B 切换、持久重开、preload 或 GUI/游戏测试；未代替原观察 seq/revision/取消/读取屏障回归。主验收统一运行全量及其选择的其他测试。

## 指纹

| v3 文件 | SHA256 |
| --- | --- |
| tests/acceptance-task-targets.test.ts | 00901F88602C339B3002119A6F6859A011DDC1D0776751AEA0A703E62A4DE44B |
| docs/work-packages/P-B/acceptance-v3-targets.mjs | CB664D232B2B443AD5161F7B01368126F4F0B57417663A8F5C93F8FABA060D86 |
| src/ipc/task-targets.ts（只读） | 9379F58EBC646FB38075A23B5519F33C81469217A019A63F4837DB3C17D4C683 |
| src/services/workers/mod-targets.ts（只读） | C84381F0C29D1ABFC6140E0E8DB257E924CF5F3DA5349F69A28B128723108812 |
