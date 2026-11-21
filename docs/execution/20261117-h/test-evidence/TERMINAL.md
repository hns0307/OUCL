# Admitted terminal：真实存储与原生事务验证

2026-11-17，方案 A 的 H 内部只读 checker。只新增 `tests/distribution-admitted-terminal.test.ts` 及本目录证据，没有修改生产源码、旧测试/夹具，没有提交。

## 真实装配及边界

复用 confirmation helper：临时签名 release/pinned 验签、真实 JAR worker/Inventory/LocalModDomain、Coordinator ticket、DistributionStore schema2/OwnerGuard、RecordStore→StorageClient 任务 SQLite 与真实 Reconciler。先通过真实 confirmation 持久接纳，再在独占合成游戏目录调用旧 Coordinator.confirm 或真实 TransactionService，使用现有 Windows native factory。

测试根 `D:/MC_start/OUCL/tmp/admitted-terminal-20261117-h/domain/<pid>/`。生成的有效 Fabric JAR 和 MC1.20.1/Java17/Fabric0.16.14 环境为合成夹具，平台及许可端口明确合成，fetcher 只返回内存 Response。没有公网、真实许可或玩家目录，没有公共执行服务接线。

`readAdmittedTerminal(rootId, admission, {journals:{read}, receipts:{read}})` 的 checker 端口仅提供 read，没有 write/commit。真实文件效果由前置事务产生，不能归因于 checker。

## 最终结果

**7 PASS / 0 FAIL / 0 SKIP，10954.7479 ms，exit0**；全工程 `tsc --noEmit` exit0，新测试局部 ESLint exit0。

1. **真实存储**：projected admission 稳定无 journal，四次读顺序 J/R/J/R 返回 undefined，任务保持 queued；随后真实 Coordinator/native commit 产生 journal/receipt，checker 返回精确薄 Evidence。修改返回 identity 不污染存储；前后 journal/receipt/admission digest 相同，目标 JAR 仍为事务提交的原字节。
2. **真实回滚**：TransactionService 在 staged checkpoint 抛受控普通异常，实际 native rollback 并持久 rolledBack journal，mods 为空、receipt 真 undefined；checker 得到 rolledBack、receiptRevision0 和实际 journalRevision。commit 调用本身返回 NEEDS_RECOVERY 异常，不把这当作事务没有落终态。
3. **注入反例**：wrong expectedRoot、非法 task UUID、被改 plan/identity 的 admission、被改 gameIdentity 的 journal 均 NEEDS_RECOVERY。没有宣称每个改动都是合法且重新计算 digest 的独立攻击。
4. **注入反例**：prepared/applying/needsRecovery、terminal pending、committed 缺 after receipt、rolledBack 对着 after receipt 均不能认证终态。
5. **真实较新回执**：另一个有效合成 Mod 经真实高序号 release/原生事务提交，实际 receipt revision2；旧 admission 的终态检查保守 NEEDS_RECOVERY，两个真实 JAR 字节均保持。
6. **注入漂移**：J2 或 R2 envelope revision 与首次读取不同，拒绝认证。
7. **恶意端口**：超4MiB输出、额外字段、循环结构、read throw、unsafe revision 均统一 NEEDS_RECOVERY；真实 journal/receipt 前后 digest 不变。超大格同时含非法额外字段，不宣称独立验证了精确预算阈值边界。

Journal schema 没有 taskId：H 验 admission.taskId 合法并回显，无法独自认证另一个合法 task UUID 与任务库的关系；上层仍须真实 projection gate。本测试故意不臆造 checker 未提供的任务读取能力。Evidence 不含 raw journal、manifest、路径或 leaseToken，不是执行许可。

## 命令、摘要与证据

已有 esbuild 非 bundle 编译 src/测试及复用 helper，保留 worker 相对入口；固定父目录工具，无新依赖：

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/admitted-terminal-20261117-h'
$env:OUCL_SOURCE_ROOT='<本checkout绝对路径>'
node --test D:/MC_start/OUCL/tmp/admitted-terminal-20261117-h/build/tests/distribution-admitted-terminal.test.js
node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js tests/distribution-admitted-terminal.test.ts
```

原始 fd 输出 `tests.log`、`typecheck.log`、`lint.log`；各 status JSON 保存退出码，test-status 记录实际源码摘要。

- admitted-terminal.ts SHA256：`d8a9022585a8a9fdf0fff66eda5fb548d4951b53dc1fe59817c587bcc7297eb8`
- 新 test SHA256：`b61f172dbe7cafa7ed9e8ca52825ba38c7258728cf3ac081cb226946f1fa6dd1`

未发现本片生产阻断。测试源码冻结，交主协调全检/构建/提交；本报告不预记这些结果。来源/公钥仍空，不广告 capability，不把无 journal 返回值解释为可自动重放。
