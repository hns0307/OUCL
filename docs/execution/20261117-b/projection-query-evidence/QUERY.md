# 有界任务投影读取

本片只读，不投影、启动或恢复任务，不新增 schema、公共 IPC 或 renderer 能力。固定 ID 投影 API 保持原样。

`StorageClient.readDistributionTaskProjections(expectedRootId): Promise<DistributionTaskProjection[]>`，其中 `DistributionTaskProjection = {proposalId,payloadDigest,task:StoredTask}`。私有命令 `distribution-task:list` 仅接受 expectedRootId；worker 从 installation 派生 owner 并比对 expectedRootId，不能由 caller 指定 owner。缺根或错根拒绝 NEEDS_RECOVERY。

`RecordStore.readDistributionTaskProjections(ownerId)` 经原串行队列调用同步 `TaskTable.readDistributionProjections(ownerId)`。tasks、requests 各读取 LIMIT 1025；任一超过 1024 拒绝，不截断为伪完整清单。两侧计数、task ID 集合、请求 ID、digest、kind、owner 与 task 解析均核对，孤儿、非法或不匹配行拒绝 NEEDS_RECOVERY。私有 reply parser 再做 exact shape、上限、重复 proposal/task 和 kind 校验；client 再核对实际 owner。

## 实际结果

固定 Node v24.21.0/esbuild；独占测试根 `D:/MC_start/OUCL/tmp/distribution-query-20261117-b`。新 3 项加原固定投影 4 项，共 **7 PASS / 0 FAIL / 0 SKIP，exit 0**，294.4527ms，见 tests.log/status.json。

- 真实 RecordStore 空/正常读取；关闭重开真实 worker/client，错根拒绝、正常重复读取完全一致。
- 真实内存 SQLite task-only、request-only、错 kind、非法 digest、1025 对任务超限均拒绝，前后两表快照相同。损坏格刻意无外键以注入现场，不宣称正常数据库会允许这些状态。
- 私有 command 拒绝 owner 注入，reply 拒绝重复 alias。原投影四项保持通过。

整仓 tsc --noEmit 与本片六文件 ESLint 均 exit 0，原始输出见 typecheck.log/lint.log。整仓测试、构建由主协调统一验证，本报告不冒称运行。source 摘要见 checks.json。

本查询仅供后继双库对账使用，不将 task 或 projected 的存在当作确认、执行成功或恢复授权。没有网络、玩家数据、正式 EXE、依赖或 Git 提交操作。
