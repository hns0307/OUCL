# Confirmation ticket：真实服务局部验证

2026-11-17，已批准方案 A 的 D 小步。新增 `tests/distribution-confirmation-ticket.test.ts`；按主协调明确授权，仅将共享 local-domain 夹具 ROOT 增加 `process.pid` 子目录，防两个测试进程并行构建同一 helper。未改生产源码、公共接线、旧测试断言或真实来源配置，没有提交。

## 实际装配

复用真实 `DistributionExecutionCoordinator`、临时 Ed25519 签名与 pinned 验签、`DistributionStore` schema2/OwnerGuard、`ModArchiveReader` worker、`ModInventoryService` 和 `LocalModDomain`。JAR 是项目工具生成的有效 Fabric 合成样本，运行环境为 MC1.20.1 / Java17 / Fabric0.16.14；平台及许可端口明确合成，不构成真实许可证据。内存 Response 取代网络，无公网请求。

夹具复用 native factory，并在独占 `D:/MC_start/OUCL/tmp/ticket-20261117-d/domain/<pid>/` 构建 helper；本轮票据路径没有运行文件发布操作，不将 factory 的存在称为 native 执行验收。

API 为 `ticket(proposalId): Promise<Omit<AdmissionIntent,'confirmRequestId'>>`。票据仅供主进程接纳，不是公共 DTO，也不自行创建任务或执行文件变更。

## 7 格真实结果

最终进程目录隔离后 **7 PASS / 0 FAIL / 0 SKIP，2366.0228 ms，exit0**：

1. ready proposal 含 instanceRevision；ticket 五字段与 accepted archive/原计划绑定，返回 detached。修改首张票据不能污染再次取票。ticket 前后无 journal/receipt/admission/目标 JAR；真实 `admissions.admit({...ticket,confirmRequestId})` 后重复请求回执与 taskId 完全相同、只有一条 accepted outbox，仍无发布。
2. prepare 后新增用户文件，ticket 返回 FILES_CHANGED，未知文件内容保持不变，无 admission/发布。
3. 接纳更高序号真实签名 release，旧票据返回 UNTRUSTED_DISTRIBUTION，无 admission/发布。
4. 5分钟 TTL 到期后首次与重复 ticket 均返回 EXECUTION_REQUEST_EXPIRED，旧 identity 不复活。
5. ticket 阻塞于真实 domain 的 context port 时 cancel；close 等到 held port 实际 settle，票据 CANCELLED，无发布/活扫描。
6. 同样 held port 下直接 close，close 不提前完成，释放后票据 CANCELLED，无发布/活扫描。
7. ticket 在途同 proposal singleflight；ticket→legacy confirm 与 legacy confirm→ticket 两方向均 EXECUTION_ACTIVE_LIMIT。取消并释放 held port 后原在途请求 CANCELLED，仍无 journal/receipt/admission/目标 JAR。

全部格明确检查 session lease 文件不存在。没有用真实 kill；held port 是生命周期合成门控，其后仍运行真实领域服务。正常 legacy 发布由原测试矩阵验证，本文件不重复扩大范围。

全工程 `tsc --noEmit` exit0；新测试和共享夹具局部 ESLint exit0。原始输出：`tests.log`、`typecheck.log`、`lint.log` 与各自 status JSON。`tests-before-pid-isolation.log` 和对应 status 保留目录隔离前 7PASS 的原始历史，不覆盖旧报告摘要。

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/ticket-20261117-d'
$env:OUCL_SOURCE_ROOT='<本checkout绝对路径>'
node --test D:/MC_start/OUCL/tmp/ticket-20261117-d/build/tests/distribution-confirmation-ticket.test.js
node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js tests/distribution-confirmation-ticket.test.ts tests/helpers/distribution-local-domain-fixture.ts
```

编译使用已有 esbuild，非 bundle 输出 src/fixture/test，保留 worker 入口结构；无新依赖。

冻结 SHA256：

- execution.ts：`0c67ae0a5853e9728d51396216871b79d75bbda9be8bd0744a32c35a2032efd5`
- 新 test：`f71d9e82191cad176cc2dcaf2586edbf368bd93cddbd11470b5fc51419be3514`
- 共享 fixture（仅 PID 一行）：`a84f4203470482262e8018c5faf759750bdf9c71f6858a4d2217a499065e948e`

本有限矩阵未发现生产阻断。真实 source/key 继续为空；没有公共 backend 或任务执行接线结论。文件已冻结，交主协调执行全检与提交，本报告不预记全回归结果。
