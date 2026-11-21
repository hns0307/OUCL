# 固定身份任务投影

本片仅内部任务库投影，不装配 admission、双库协调器、执行、公共 IPC 或 UI 控制。用户方案 A 已批准；本函数成功仅表示 tasks/requests 投影存在，不表示下载、安装或 receipt 成功。

`StorageClient.projectDistributionTask(expectedRootId, proposalId, payloadDigest, taskId)` 使用私有 exact worker 命令。worker 从真实 installation 派生 owner，先比对 main-owned admission 提供的 expectedRootId；参数不接受 ownerId。RecordStore 排队后，TaskTable 在同一 BEGIN IMMEDIATE 事务内写 tasks/requests，taskId 原样使用，不生成 random ID。初态 createExecution/queued。

同 owner/proposal/digest/taskId/kind 重试返回原任务，不重置执行状态。request 或 task 任一孤儿、同 proposal 不同 task、同 task 不同 proposal/owner/kind/hash 均拒绝 NEEDS_RECOVERY，不补收编。generic accept 在私有协议和 TaskTable 双层拒绝 distribution-install。既有 requests.task_id UNIQUE 和数据库格式不变。

TaskKind 及公共 TaskSnapshot kind parser 增加 distribution-install，仅提供表示能力；不新增 dispatch、retry、start 或自动恢复。调用者仍须先持久化真实 confirmed admission，后继协调器负责双库对账，本片不验证 admission 存在。

## 实际验证

独占根 `D:/MC_start/OUCL/tmp/distribution-projection-20261117-a`；固定 Node v24.21.0/esbuild，真实 RecordStore/SQLite 与实际 storage worker/client。最终 4 PASS、0 FAIL、0 SKIP，exit 0，198.0051ms，见 tests.log/status.json。

1. 固定 ID、queued 初态、重复幂等；digest/task/proposal/owner 冲突拒绝，原任务不变；generic accept 拒绝。
2. 真实内存 SQLite 构造 task-only、request-only、foreign-kind；投影拒绝且两表快照完全不变。此格刻意不设外键以注入损坏现场，不冒充正常数据库允许这些现场。
3. 真实 worker 派生 installation owner；错误 expectedRootId 拒绝且任务不存在，正确绑定成功并幂等；generic bridge 拒绝。
4. 私有命令拒绝额外 owner 字段及错误 digest/UUID。

首轮 2 PASS/2 FAIL 原始输出保留 tests-first.log：新命令最初误置 generic ownerId 检查内，实际桥接拒绝合法命令；移动到无 owner 参数专用分支后最终 4 PASS，未降低断言。

整仓 `node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit` 最终 exit 0；本片七文件 ESLint exit 0，日志 typecheck-final.log/lint-final.log。首轮类型检查曾报外部 TaskCenter kind 映射缺项，交主协调修复，本片未修改 UI。整仓测试/构建由主协调统一运行，本报告不宣称已运行。

无网络、游戏、正式 EXE、玩家目录操作，无依赖新增，无 Git 提交。测试临时目录保留供复核。
