# 私有首次启动 claim

API：`StorageClient.claimDistributionTask(expectedRootId, proposalId, payloadDigest, taskId): Promise<StoredTask>`。worker 从 installation 派生实际 owner 并核 expectedRootId；命令 exact parser 不接受 caller owner。RecordStore 使用原串行队列，TaskTable 在同一 BEGIN IMMEDIATE 事务内核 requests/tasks 的 owner、proposal、digest、taskId、kind，索引查询 LIMIT 2 拒绝额外映射。

只接受 pristine queued：attempt=0、revision=1、lastSequence=0、bytesDone=0、无 bytesTotal。通过 `controlTask('start')` 并严格核 running/attempt1/revision2/sequence0/bytes0/无total 后持久写回。重复 claim 或任何非初态均 NEEDS_RECOVERY；无新 schema、表、公共 IPC 或执行接线，generic accept 仍拒 distribution-install。

只有本次成功调用的返回值代表 fresh claim。超时/丢失 acknowledgement 不得用读回 running 替代；执行层必须亲自等待成功后才 effects。启动后、journal 前崩溃留 needsRecovery 是预期保守边界，不能自动重新 claim。

## 实际验证

独占根 `D:/MC_start/OUCL/tmp/distribution-claim-20261117-g`，固定 Node v24.21.0/esbuild。新 4 项及旧投影/查询 7 项合计 **11 PASS / 0 FAIL / 0 SKIP，exit 0**，376.7679ms，见 tests.log/status.json。

- 真实 RecordStore 一次初始 claim；错 root/proposal/digest/task 拒绝且原 queued 不变；重复拒绝且 running 不变。
- 真实通用 update 产生 revision2 的 queued（含 attempt/sequence/progress/total 代表变化），不能回到首次启动许可。
- 真实 worker/client 核 expectedRoot；成功 commit 后测试包装器明确抛合成 ack-loss，原任务真实 running，重复 claim 拒绝；关闭/重开 worker 经真实 recover 变 needsRecovery，仍拒 claim。不是实际网络丢包或强杀。
- 私有 command 拒 owner 注入、坏 digest/UUID。旧投影/双向查询与损坏/超限测试保持通过。

整仓 `tsc --noEmit` exit 0，本片六文件 ESLint exit 0，原始日志保留；源码摘要见 checks.json。整仓测试/构建由主协调统一执行，本报告不声称已运行。

无文件执行、真实网络、玩家目录、正式 EXE、依赖或 Git 提交操作。
