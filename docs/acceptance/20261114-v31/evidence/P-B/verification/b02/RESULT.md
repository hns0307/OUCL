# B-02 库存遍历 deadline 候选结果

2026-11-14。状态：**局部候选及验证完成，交统一协调复核；未整合 main**。仅处理 B-02，没有改 B-01 观察池或其测试、公开 IPC/DTO、任务表、依赖或持久格式；未运行 GUI、游戏或不相关全量测试。

候选是非 Git 目录 `D:/MC_start/OUCL-review-round-20261114/P-B/verification/b02/candidate`，从稳定 `D:/MC_start/OUCL-download-main` 的 HEAD `096dd22e402ef6af58e49b7cdb89a1b4fdcdb07e` 复制源码；三处产品文件和测试夹具的精确 SHA、差异见 [PATCH.md](PATCH.md)，所有 227 份复制源文件的原始 SHA 见 [source-sha256.json](evidence/source-sha256.json)。根聊天提供的 687 项统一回归不是本轮测试结果，本报告不把它归入本候选。

## 原问题和最小修改

`readModTargets` 原在整个 `readModTargetAdmissions` 完成后才检查同一 2000ms deadline。候选仅在私有调用链传入可选 `checkBudget`：每个域、每次受控 SQL 查询前后，以及 tasks/request 清点的每条记录前检查；正常调用可以省略回调。`RecordStore.serial` 将未知异常包装为 `STORAGE_IO`，所以 `readModTargetAdmissions` 只在预算回调确实抛出时恢复**同一个**异常对象，其他存储异常沿原规则处理。worker 的原 2 秒 deadline 未改变，不强杀 worker。单个 SQLite `.all()` 或其他单次 IO 调用本身不能被此回调硬中断。

## 修复前与修复后

测试专用 [build-fixture.mjs](build-fixture.mjs) 在**输出到证据目录的测试构建**中注入受控目标时钟和 `TaskTable.get` 计数；候选产品源码没有测试时钟或计数器。真实 worker、`RecordStore`、SQLite 和六条正式接纳/索引记录运行在本包独立目录。测试时钟在第三次 task `get` 后跨过 deadline，不是在进入库存之前触发。此法证明确定性逻辑与错误传递，不是慢盘墙钟性能测试。

- 原源码 worker：返回 TIMEOUT 之前实际已读取 **6/6** 条，而测试要求第三条后停止；[baseline.log](evidence/baseline.log) 1 项失败，原始 [baseline-test.mjs](evidence/baseline-test.mjs)、[worker-baseline.cjs](evidence/worker-baseline.cjs) 和 `fixtures/inventory-2OcqmF/metadata/b02-trace.log` 保留。
- 候选：返回 **TIMEOUT 而非 STORAGE_IO**，第三条之后、第四次 `get` 之前停止；[fixed.log](evidence/fixed.log) **3/3 通过**，最近一次跟踪 `fixtures/inventory-Tnozwc/metadata/b02-trace.log` 为首次 `gets:3`、第二次非注入读取。测试前后逐字节比较 `tasks.sqlite`、`tasks.sqlite-wal`、`mod-jobs.json` 和 SQL tasks/requests 的序列化内容；同一个 worker thread ID 保持不变，随后安装根读取及同一域六条目标重查成功。日志含数据摘要；没有声称可中断单次 SQLite 调用。
- `RecordStore` 定向测试确认 callback 抛出的同一 `WorkerError('TIMEOUT')` 对象得到保留，普通 `INVALID_RECORD` 不被改写，后续无回调库存查询可用；callback 参与的内存 SQLite 双域各 1000 项可读，任一域 1001 项拒绝。
- **未注入时钟**的候选正式 worker 相关测试 [worker-regression.log](evidence/worker-regression.log) **4/4 通过**，包含实际 SQL 接纳到索引提交间隙的读取屏障；库存既有测试 [inventory-regression.log](evidence/inventory-regression.log) **5/5 通过**；独立屏障失败释放 [barrier-regression.log](evidence/barrier-regression.log) **1/1 通过**。测试层级分别为真实 worker/SQLite、内存 SQLite、受控 service，不相加冒充全量回归。
- 候选相关源码和测试严格 `tsc --noEmit -p tsconfig.b02.json`、指定文件 ESLint 均退出 0；未注入时钟的正式 worker esbuild 构建退出 0。没有跑完整应用 build、全仓 lint/测试或游戏。

## 实际命令

除另指明，工作目录 `D:/MC_start/OUCL-review-round-20261114/P-B/verification/b02`：

1. 保存的原失败可通过设置 `B02_WORKER` 为 `evidence/worker-baseline.cjs` 绝对路径，再运行 `node --test evidence/baseline-test.mjs` 复现；原始 `baseline.log` 未覆盖。
2. 当前候选：`node build-fixture.mjs fixed`；设置 `B02_WORKER` 为 `evidence/worker-fixed.cjs` 绝对路径，执行 `node --test evidence/deadline-test.mjs`。
3. 内存 SQLite 回归：用 esbuild 将 `candidate/tests/task-target-inventory.test.ts` 和 `task-target-dual-capacity.test.ts` 分别 bundle 到 `evidence/regression`，再运行 `node --test` 两个输出；接纳屏障同法对 `task-target-barrier.test.ts` 单独执行。
4. 未注入正式 worker 回归：将 `candidate/src/services/workers/entry.ts` bundle 为 `evidence/runtime/src/services/workers/entry.js`（Node/CJS），将 `candidate/tests/task-target-worker.test.ts` bundle 为 `evidence/runtime/tests/task-target-worker.test.mjs`，在 `evidence/runtime` 运行 `node --test tests/task-target-worker.test.mjs`。
5. 候选目录运行 `node D:/MC_start/OUCL-download-main/node_modules/typescript/bin/tsc --noEmit -p tsconfig.b02.json`；lint 运行同工具链 `eslint/bin/eslint.js --config D:/MC_start/OUCL-download-main/eslint.config.mjs src/services/storage/tasks.ts src/services/storage/records.ts src/services/workers/mod-targets.ts tests/b02-deadline.test.ts`。

稳定 main 的 `node_modules` 未提供 `smol-toml`，初次测试构建因模块解析失败；未安装依赖，后续仅将已存在的 `D:/MC_start/OUCL/node_modules` 作为只读解析路径（`nodePaths` / `NODE_PATH`）复用。测试输出、临时根和日志均在本包目录；未修改工具链或依赖。
