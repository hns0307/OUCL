# L root-owned J→K runner：真实合装测试

2026-11-18，已批准方案 A。仅新增 `tests/distribution-execution-runner.test.ts` 与本目录证据；未改 J/K 源码、旧测试或夹具，未提交。

## 真实层级与边界

复用 J helper 的临时 Ed25519 release/真实签名验证、DistributionStore admission/OwnerGuard、另一任务域 StorageClient worker SQLite、有效合成 JAR worker/Inventory/Domain、fresh claim 和 protected native factory；新测试自行装配真实 K SettlementService 与 Runner。K CAS 委托真实 worker update。

独占测试根 `D:/MC_start/OUCL/tmp/execution-runner-20261118-l/domain/<pid>/`。发行、平台、许可、环境和 idle 是明确合成端口，内存 Response 无公网，不是实际许可或发布者验收。held/异常包装器均为故障注入，下面区分其后的真实提交或回滚。不触玩家目录，不接公共 backend/UI。

## 最终结果

**6 PASS / 0 FAIL / 0 SKIP，7515.4938 ms，exit0**。最终整仓 `tsc --noEmit` exit0，新测试局部 ESLint exit0。

1. wrong task 首次拒绝不毒真实身份。实际 J 原生 commit 完成后，测试包装器明确抛“J完成回应丢失”；Runner亲自K得到真实 completed 后返回真实StoredTask，claim/CAS各1。后续另一个合成签名release/原生事务产生receipt revision2，重建Runner回读旧completed仍原完整tuple，J调用计数不增加、task不重写。
2. K实际CAS已commit后held acknowledgement，同ID单飞得到detached同结果；另一个job身份INSTANCE_BUSY，尚未进入其J。K段cancelTooLate、close不提前完成，放行后completed/只写一次，共享taskclient仍可用。这里验证单个root-owned Runner的占位，不宣称多个任意Runner实例之间存在全局互斥。
3. 在新测试包装domain.readContext（不改夹具文件），只当真实journal applying/pendingnull/allpublished时held最终validate。确认目标JAR实际已发布，再通过Runner.cancel→真实J信号→native rollback；K持久failed，原typed DistributionTransactionError(CANCELLED)仍抛出，journal rolledBack、receipt不存在、目标JAR移除。
4. 真实claim commit后包装器丢ack，Runner只得到NEEDS_RECOVERY；任务实际running但无journal/receipt/目标文件。另一个Runner后续只走K，不重进J、不再次claim、不伪造终态。
5. 合成idle改false，原typed INSTANCE_BUSY保留，任务仍queued、claims0、无文件效果；K没有把无journal拒绝升级成成功或假终态。
6. J实际domain校验held时close：测试cancel包装器先真实发停止、捕获其Promise以避免unhandled，再同步throw。Runner.close仍不抛错或提前结束，放行后原CANCELLED、taskqueued、无文件效果，外部共享存储仍打开。

首次6PASS结果保留在 `tests-before-close-guard.log` 与对应status，最终版本加入原关闭格的同步throw回归后仍6PASS，未新增大矩阵。首次lint的prefer-const失败另保留 `lint-initial-prefer-const.log`；只修测试局部变量声明，最终lint0，没有产品失败被掩盖。

## 复现及冻结摘要

已有esbuild非bundle编译src/新测试/所需旧helper，保留worker相对路径。固定父目录工具，无依赖安装：

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/execution-runner-20261118-l'
$env:OUCL_SOURCE_ROOT='<本checkout绝对路径>'
node --test D:/MC_start/OUCL/tmp/execution-runner-20261118-l/build/tests/distribution-execution-runner.test.js
node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js tests/distribution-execution-runner.test.ts
```

原始fd输出 `tests.log`、`typecheck.log`、`lint.log` 和status JSON齐全。最终：

- runner.ts SHA256：`9165391bc5dbdd2e88fbfa4408cd14de37df0452fb70d5a940203d9d453547fb`
- 新test SHA256：`e999b3b2ac0196ee60e0f6fab2d607f186cbd763ced8b46e30ac6d3e91fef28e`

测试源码冻结，未发现有限矩阵内的最终阻断。完整回归/构建/提交由主协调执行，本报告不预记结果。不作startup自动运行、不做持久queued取消或显式恢复；真实source/key继续空配置，不广告执行能力。
