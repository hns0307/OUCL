# 双库接纳对账：真实服务局部验证

2026-11-17，方案 A 已批准范围内的内部元数据增量。只新增本报告、证据和两个测试文件；没有修改生产实现、公共 IPC/UI、来源配置或既有测试，没有提交。

## 实际装配与边界

每格独占 `D:/MC_start/OUCL/tmp/reconciliation-20261117-b/case-*`。真实 `DistributionStore` schema2 持有私有库 owner；另一目录先由真实 `RecordStore` 写 installation，正常 close 后交真实 `StorageClient` worker 重开，持有任务 SQLite 域。没有用内存任务表替代两域。

临时生成 Ed25519 密钥和合成空 operations 清单，经 `PinnedReleaseSource.resolve` 验签/CAS，再保存 accepted archive 后调用真实 admission。HTTPS 名称是 `synthetic.invalid`，fetcher 仅返回内存 Response；未联网，没有真实发布者、许可、游戏执行或文件事务。目录身份字段是本格纯元数据合成输入，不充当真实游戏授权证据。

## 10 格结果

最终重编当前冻结源码后运行：**10 PASS / 0 FAIL / 0 SKIP，2039.991 ms，exit 0**。

1. accepted 无任务：投影 admission 固定 taskId、digest，再 mark projected；重复对账不新增任务。
2. project 在真实 worker 提交后丢失回执：读回精确绑定，同 taskId 恢复。
3. mark 在真实私有 SQLite 提交后丢失回执：读回 revision2，同 taskId 恢复。
4. 孤儿任务拒绝，对账前后投影不变。
5. digest 冲突拒绝，投影不变。
6. taskId 冲突拒绝，投影不变。
7. projected admission 缺任务返回 NEEDS_RECOVERY；保持无任务，不重建 queued。
8. 未 admit 的 intent 不造任务；other-root admission 不投影；worker 的错误 expectedRoot 查询和写入均拒绝。
9. project 实际提交后 held port 未 settle 时 close 不提前完成；放行后完成 mark，close 后调用返回 CLOSED。
10. 初始扫描后新增 admission，最终集合审计返回 NEEDS_RECOVERY；保留两条 admission 与已产生的一条任务。

新文件局部 ESLint exit0；全工程 `tsc --noEmit` exit0。全回归、构建和提交由主协调执行，本报告不预记。

## 命令与证据

固定父目录 Node/esbuild 将 src、两个新测试文件非 bundle 编译到独占根 `build/`，保留 worker 相对入口；随后：

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/reconciliation-20261117-b'
node --test D:/MC_start/OUCL/tmp/reconciliation-20261117-b/build/tests/distribution-reconciliation.test.js
node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js tests/distribution-reconciliation.test.ts tests/helpers/distribution-reconciliation-fixture.ts
```

原始输出保存 `tests.log`、`typecheck.log`、`lint.log`，对应 `*-status.json`。保留首轮夹具目录遗漏造成的 0/10 失败、端口委托误用 prototype spread 造成的 8/10 结果；均修复夹具后重跑，没有改产品或降低断言。`tests-before-budget.log` 是预算收紧前 10/10 的历史结果，不代替最终日志。`typecheck-during-export.log` 保留并行源码尚未导出常量时的失败，最终静态检查已通过。

最终 SHA256：

- test：`37a2cb2acc814976b5175af2f04cbe5c8cc36b7940f06d801b1df9edecfa73d2`
- fixture：`ad53cd8c93cd9bf1cf320b1f9601d366f349976bf80cbab21acd3d898268607e`
- reconciliation：`1aaab2ef01b505a010680127a7704a0e432393435d9d8a1cab9c1282851ec7d4`
- admission-record：`27d0e9b2d5b44d050564caf7154c4b34d131ac9973f2c5b7f83adc279f39e37b`

本矩阵没有发现生产阻断。对账仅修复任务投影，不授权重放游戏操作；启动期间新 admission gate 关闭由上层装配保证，本测试用集合变更反例验证了底层保守拒绝。未测试真实进程 kill、公共 handler、任务执行调度或真实来源；来源/公钥保持产品空配置。
