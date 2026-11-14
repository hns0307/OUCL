# D-01 候选与局部验证（收尾版）

状态：独立非 Git 候选及受控局部验证完成，等待协调者审核；未声称真实 worker/SQLite 故障或真实游戏通过。唯一生产候选文件为 `candidate/src/services/launch/service.ts`，差异见 `candidate.patch`；旧 D-02 候选、共享源码和公开契约未改。基线文件 SHA256：1646843329cf4a1b555e0e5d1524074185a994d8a7542eebc05920083c15024a；候选 SHA256：214080d91810e4213a715042614e74114314faeb4d0b00b842d7dbb5fa917429；补丁 SHA256：020ffe6a217c6aeee854a490999ca0f45e527673d731ee0b79e8d616ccd83802。

## 收尾与证据

- 启动期只检查最新至多 32 条会话，使用共享 2 秒检查点软预算，在每次任务 get/update 前后检查；任一读取、写入或预算异常立即停止本批。单次 RPC 不能硬打断，仍受现有超时控制，2 秒不是硬上限；未扫描任务依靠单项查询惰性收敛。
- 会话错误保存失败后仍执行任务收敛；动作、保存、收敛错误中如有后两者失败，`job.done` 用 AggregateError 保留原动作错误及对应失败，不新增公开字段、日志或堆栈暴露。
- `budget-probe.log`：40 条历史中恰好扫描最近 32 条；未扫描项查询恢复；首读取失败仅 1 次 get；受控时钟在 get 后或 update 后超过预算均立即停止，后续查询恢复；查询遇 CAS 冲突向调用方传播，权威状态不被覆盖，后续重试恢复。
- `probe.log`：保留原提交许可回执丢失、连续存储失败、恢复、重建、重复初始化/查询、同请求不重放、取消、活动 job 和 owned 保护等断言；另验证保存和收敛都失败时 AggregateError 保留三个错误，以及保存失败但收敛成功时保留原动作和保存两个错误且任务进入 needsRecovery。模拟 spawn=0。

夹具将实际候选 LaunchService 和实际状态机打包；纯启动计划、配置、安装器、存储、进程均为替身。只运行夹具构建和上述局部测试，没有运行完整类型检查、lint 或正式 build。

## 前提与限制

正式入口目前只装配一个 LaunchService，Windows 元数据打开使用 OwnerGuard。本候选依赖同一元数据所有者内唯一有效 LaunchService，不阻止人为绕过正式装配在同一进程创建第二实例；不能推断任意双实例安全。收敛不依赖 spawned:false 判定外部 JVM 退出，不碰进程、文件或锁。现有初始化对 running/stopping 会话的处理未改，本次预算针对新增的 committing 恢复扫描。verifying 等状态未扩大处理。

## 复现

设置 `OUCL_SOURCE_ROOT` 为此候选根，`OUCL_TOOLCHAIN_ROOT` 为含现有 esbuild 的树，`OUCL_TEST_ROOT` 为 D 专用可写测试根；依次运行 `node build.mjs`、`node probe.mjs`、`node budget-probe.mjs`。构建仅写测试根的 `d01-fixture`，不安装依赖。

2026-11-14 收尾追加：AggregateError 已补 cause 并添加标准回归；最新 SHA、测试文件及本地 type/lint/测试证据以 TEST-RESULT.md 为准。
