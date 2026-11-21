# K 任务终态结算真实合装测试

2026-11-18，沿已批准方案 A。仅新增 `tests/distribution-task-settlement.test.ts` 和本目录证据；复用 J/旧 helper，未改其源码、生产实现或公共接线，未提交。

## 实际范围

独占 `D:/MC_start/OUCL/tmp/task-settlement-20261118-k/domain/<pid>/`，复用 J 真实临时签名验签、持久 admission/固定任务投影、StorageClient worker SQLite、首次 claim、有效合成 JAR worker/domain 和 native 发布。K 的 updateTask 直接委托真实 StorageClient.update CAS；service 本身只有元数据读取与 task CAS 端口，不做 claim 或文件操作。

平台、许可、环境及发行来源均为明确合成测试端口，fetcher 无网络。真实文件变化发生在结算前置 native 事务中，不把这些效果归因于 K。没有玩家数据或真实许可/公网结论。

## 最终冻结结果

**7 PASS / 0 FAIL / 0 SKIP，11474.4579 ms，exit0。**

1. J 实际原生 committed 后真实 task 为 running；K 第一次写 completed，attempt1/revision只加1，后续 settle 返回同完整元数据，update计数仍1。
2. 实际 worker CAS 已提交后包装器抛合成失回执异常；K 精确读回原预期 tuple 并成功返回，重复调用不重写。非真实传输故障或 kill。
3. 真实持久 admission 后亲自通过 worker claim，独占构造 protected native TransactionService，在 staged checkpoint 普通异常触发实际 rollback。Journal rolledBack、receipt真不存在、mods为空；K 将任务结算 failed。该事务的 authorize 是本格明确合成端口，复用真实 domain 验证；签名接纳已由前置 J 夹具完成，不宣称它是完整后继公共执行装配。
4. 已 completed 后，另一个合成许可 Mod 通过真实签名高序号 release 和 native 事务产生实际 receipt revision2；重建 K 服务并设置 receipt.read 为调用即失败，旧 completed 仍原 tuple/revision，update仍1，证明历史回读不依赖最新 receipt。
5. wrong root/proposal/task，以及 legacy 真实 journal 配 pristine queued0，全部 NEEDS_RECOVERY；无 task CAS，原 queued 状态不变。
6. update port 内先通过真实 worker 完成另一个 needsRecovery/revision+1 CAS，再尝试旧 revision 的完成 CAS；后者冲突。K 不将该不同结果当 lost-ack成功、不覆写 needsRecovery。
7. 真实 task CAS commit 后 held acknowledgement；close 不提前返回，后续调用 UNAVAILABLE；放行后原请求读取 completed，close才完成，只写一次。

正常、失败和未知ack格都使用真实 SQLite，故障/held port 明确合成；没有为 green 修改断言。首轮7PASS日志另存 `tests-before-revision-floor.log` 与对应status，最终重编含 revision 下界检查的源后仍7PASS。

## 复现和证据

esbuild 非bundle编译 src、新test和已有helper，保留 worker入口；固定父目录工具，无新依赖：

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/task-settlement-20261118-k'
$env:OUCL_SOURCE_ROOT='<本checkout绝对路径>'
node --test D:/MC_start/OUCL/tmp/task-settlement-20261118-k/build/tests/distribution-task-settlement.test.js
node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js tests/distribution-task-settlement.test.ts
```

本测试代理实际全工程 tsc/lint exit0日志在 `typecheck.log`、`lint.log`（最后仅service revision下界guard前完成）；源代理另记录最终冻结两源静态通过。最终测试 `tests.log` / `test-status.json` 绑定：

- settlement.ts：`f9b55aa971132c87bfd43551c5b70aace1de6f4da5cf1f8c4e09d59a16b7d9d9`
- core/task-settlement.ts：`2ea7756e0cfb7ad0d101b9556ae734c3fa1f276b82d3ad769e7856543acfd0fe`
- 新 test：`d6d5c539f5680eaa77250710cb5c51c0e26508eadbd0c7160bd7250de943f1c9`

测试源码冻结，本有限矩阵未发现最终实现阻断。完整回归/构建与提交交主协调，不预记结果。未接产品 backend/UI，source/key仍空，不能用本片广告执行能力。
