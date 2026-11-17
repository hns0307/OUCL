# J durable admitted execution：真实合装测试

2026-11-18，方案 A 已批准范围内的内部执行小步。仅新增本轮 test/helper/证据；未修改旧夹具、生产源码或公共 backend，未提交。

## 实际装配

独占 `D:/MC_start/OUCL/tmp/admitted-execution-20261118-j/domain/<pid>/case-*`：有效合成 Fabric JAR、真实 ModArchiveReader worker/Inventory/LocalModDomain、临时 Ed25519 pinned release、DistributionStore schema2/OwnerGuard、另一个 RecordStore→StorageClient SQLite 域、真实确认服务与 Reconciler、真实首次 claim 和 Windows native factory。

新 helper 自行装配信任记录和 release，私钥只在内存；HTTPS 名称/平台/许可/context/isIdle 都是明确合成端口。fetcher 仅返回内存 Response，不联网，不构成真实许可、真实发布者或公网验收。复用旧 helper 的 native 构建，但没有改旧 helper。

## 冻结源码实际结果

**9 PASS / 0 FAIL / 0 SKIP，9314.1368 ms，exit0**。

1. 真实 projected admission/queued task→本次成功 claim→bound 原生提交→H committed 薄证据；原 proposal/task 重试仅读历史证据，claim/artifact/factory 各仍1。提交后 cancel 为 CANCEL_TOO_LATE。**task 仍 running/attempt1**：本片未同步任务终态，不冒称 queued task 已变 completed。
2. 真实 claim SQLite 提交成功后，测试包装器丢失回执；任务确实 running，但无 journal/安装 receipt/lease/文件效果。原身份重试 NEEDS_RECOVERY，claim 不再次调用，不能读 running 补授。
3. 合成 isIdle 在确认后变 false，返回 INSTANCE_BUSY，claims0、taskqueued、无效果；恢复 idle 后再新增用户文件，原 snapshot 变化返回 FILES_CHANGED，未知内容保持不变。
4. 原 gameDir 改名、原路径重建空目录，原 inode namespace 不能继承：FILES_CHANGED，claims0，无效果，旧目录 mods 仍空。
5. 当前内部测试 trust port 将 key 标为 revoked，或推进时钟至真实签名 release 到期，分别 UNTRUSTED_DISTRIBUTION/RELEASE_EXPIRED，均 claims0、无文件效果。动态 port 是内部测试能力，不宣称产品运行中热撤销已接线。
6. 实际 domain context read held 期间 cancel/close；legacy ticket/confirm 被 EXECUTION_ACTIVE_LIMIT 拒绝；close 等 held port 真正 settle，原请求 CANCELLED，claims0、worker无活扫描、无发布。
7. legacy 实际产生 committed journal，但对应持久任务仍 pristine queued0；executeAdmitted 返回 NEEDS_RECOVERY，不能只凭 journal 当已获 fresh claim；无新 claim/artifact/factory。
8. **真实 receipt commit 边界**：先完成 SQLite receipt.commit，再 held acknowledgement。真实 receipt revision1 和目标 JAR 已存在；cancel 为 TooLate，close 不提前完成。放行后 native cleanup/H 完成、journal committed、lease释放，task仍running。
9. 同一真实提交门控，加明确的 terminal journal.read 异常注入：close 后最终结果 NEEDS_RECOVERY，不能误报 CANCELLED。真实 journal/receipt/files 已 committed、lease已释放，任务仍running；注入只挡 checker 读，不篡改真实存储。

所有无发布格核无 journal/安装 receipt/session lease/目标 JAR，artifact/factory计数0；unknown-claim 格明确只有任务认领状态改变。真实 effects 格核目标字节及 receipt revision，不把合成政策当真实许可。

## 检查与原始证据

新测试/夹具完整类型检查和局部 lint 均 exit0（`typecheck.log`、`lint.log` 和 status）；这些在最后仅移动 ticket busyguard 顺序前完成。最终两生产源的静态检查由实现代理另记；主协调统一 fullcheck 正在执行，本报告不预记其结果。

已有 esbuild 非bundle编译 src/新test/fixture，保留 worker 相对入口；固定父目录工具，无新依赖：

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/admitted-execution-20261118-j'
$env:OUCL_SOURCE_ROOT='<本checkout绝对路径>'
node --test D:/MC_start/OUCL/tmp/admitted-execution-20261118-j/build/tests/distribution-admitted-execution.test.js
node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js tests/distribution-admitted-execution.test.ts tests/helpers/distribution-admitted-execution-fixture.ts
```

`tests.log` 与 `test-status.json` 为最终9格结果。首轮7格6PASS/1FAIL保存为 `tests-initial-error-mapping.log`：当时预告 expiry 统一 NEEDS_RECOVERY，但已改为保留可信 ReleaseError，实际是 RELEASE_EXPIRED；修正预期并保留原日志，不改变拒绝执行断言。`tests-before-ticket-order.log` 保存最终 guard 顺序收紧前9PASS原始结果。没有伪造 red 或覆盖失败为通过。

冻结 SHA256：

- execution.ts：`440d07c5bdb8d51fef4b44157725648180ae23ec177653a6c3228a9dbe0a8dff`
- admitted-execution.ts：`1cfd7c10d162833ca9c2193c8cc9fabd25b177099ac9937d6a735561348a9600`
- 新 test：`4322dbbb4ba15a3e95c167114e3c16cde56c978c271c2f995fe09b9aac8b4d2f`
- 新 fixture：`642300a2db089c5e712abeef997b0c4ba7ae016b1be0309c2829774c5bc4d953`

测试与夹具冻结。此有限矩阵未发现最终源码阻断；任务状态同步、显式恢复、公共 backend/UI 和真实配置仍不在本片结论内。source/key 保持产品空配置，不广告能力。

## close-r2 后继复验（不覆盖此前证据）

主协调首个完整检查为979项/974PASS/1FAIL/4SKIP，失败是既有关闭测试；本报告不把首轮 full 记为通过。实现代理修复 Coordinator.close：同步发起所有 admitted/legacy 停止动作，再合并等待实际 drain，未改测试。

按新冻结 execution.ts `01291d5042c39880bbbf60e22d930db38ebbe6d883920563fc2a6a7a5aba71a0` 重新编译，在独占 `D:/MC_start/OUCL/tmp/admitted-execution-close-r2-20261118-j` 合跑本文件9格与原 `distribution-execution.test.ts` 26格：**35PASS/0FAIL/0SKIP，33220.8942ms，exit0**。旧关闭回归格实际通过。helper、两新测试源码与夹具摘要保持上文不变，没有新增 case、断言变更或 source/test 修改。

原始输出与摘要另存 `close-r2/tests.log`、`close-r2/test-status.json`；此前 final9、首轮6/1及中间9PASS均保留。当前完整回归-r2由主协调执行，不能用本35格替代整仓检查。未另启动重复静态或全量测试；源最终静态结果见实现代理证据。
