# 持久确认服务：真实合装局部测试

2026-11-17，方案 A 持续批准的 F 小步。仅新增本轮 test/helper 与本目录证据；未修改生产实现、旧夹具、公共 backend 或真实来源配置，没有提交。

## 真实装配与边界

`distribution-confirmation-fixture.ts` 组合既有 local-domain 夹具：有效合成 Fabric JAR、真实 ModArchiveReader worker/ModInventoryService/LocalModDomain、临时 Ed25519 release 验签与真实 Coordinator.ticket。私有 `DistributionStore` schema2/OwnerGuard 存 admission/outbox；另一目录先由真实 RecordStore 写 installation 并正常关闭，再由真实 StorageClient worker 重开任务 SQLite。真实 DistributionAdmissionReconciler 在两个持久域间投影固定 taskId。

所有数据位于 `D:/MC_start/OUCL/tmp/confirmation-20261117-f/domain/<pid>/case-*`。内存 Response、平台元数据与许可端口明确合成；没有公网、真实许可或发布者证明，没有真实玩家数据。复用夹具会构建 native helper，但本片没有游戏文件写入或任务执行，不把 helper 装载称为原生发布验收。

## 实际结果

**最终 9 PASS / 0 FAIL / 0 SKIP，5205.0498 ms，exit0。** 对应追加 metadata lane 与 durable receipt 优先修复后的源码 `eba665bf...`。首轮 8PASS 原始日志/status 保留为 `tests-initial-eight.log`、`test-initial-eight-status.json`；没有运行修复前反例，不宣称已有 red 日志。

1. 真实 ticket→admit→同 taskId 对账→queued TaskSnapshot；同 ID 重试不重复 ticket。随后真实高序号 release 接纳并推进 proposal TTL，新 ID 只绑定旧 receipt alias，仍同 taskId/一条 admission/一条任务，不新授权。
2. wrong root、revision、sequence、原 request ID 改 proposal/sequence 均 REQUEST_CONFLICT；非法 ID 为 INVALID_ARGUMENT。拒绝部分不生成 admission，已成功任务不变。
3. admit 真实 SQLite 提交后抛失回执异常，由原 ID 读回恢复同 task；重复确认不再取票。
4. project 真实 worker SQLite 提交后失回执，真实 Reconciler 读回恢复同 task。
5. markProjected 真实私有 SQLite 提交后失回执，真实 Reconciler 读回 revision/phase，返回同 task。
6. 正常关闭确认服务及旧 Coordinator，重建确认服务；先以原 ID 加错误 sequence 确认 REQUEST_CONFLICT，再以原正确输入仍恢复原 task，随后新 alias 同样从持久回执恢复。ticket port 设置为调用即失败，实际未被调用；错误输入没有用内存 seen 污染 durable identity。这里是服务重建，**没有宣称进程 kill 或两个 SQLite owner 重启**。
7. 同 ID 两调用共享一个 held 真实 domain ticket；close 停新调用（UNAVAILABLE）并等待原链实际完成，结果彼此 detached，只有一个接纳记录。
8. admission 实际提交后 held 回执；close 不提前完成、不丢弃未知接纳，释放后完成真实投影/readback，保持原 taskId。
9. 同一真实 Coordinator、相同 accepted release/version prepare 两个 proposal（不推进 highwater）。并发两个不同 confirm ID，A ticket held 时 B 不启动 ticket；释放后两个完整 metadata 链顺序完成，任务 ID 不同、两条持久 admission/投影、无集合变更错误且无任一 proposal 的 journal/安装 receipt/游戏发布。

每格检查无 distribution journal、无安装 receipt、mods 空目录及 session lease 不存在；只允许 metadata admission/outbox/task 的预期变化。真实 worker 扫描在合装中运行，平台/context/许可事实仍是合成端口。close 不取消已进入链，也不代替关闭共享 Store/Coordinator。

全工程 `tsc --noEmit` exit0；两个新增文件局部 ESLint exit0。此片未发现生产阻断。全回归、构建及提交由主协调执行，本报告不预记后续结果。

## 复现与证据

已有 esbuild 将 src、测试及所需 fixture 非 bundle 编译至独占根 build，保留 worker 入口。固定父目录 Node 工具，无依赖安装：

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/confirmation-20261117-f'
$env:OUCL_SOURCE_ROOT='<本checkout绝对路径>'
node --test D:/MC_start/OUCL/tmp/confirmation-20261117-f/build/tests/distribution-confirmation-service.test.js
node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js tests/distribution-confirmation-service.test.ts tests/helpers/distribution-confirmation-fixture.ts
```

原始 fd 输出 `tests.log`、`typecheck.log`、`lint.log`，对应 status JSON 保存退出码；test-status 同时记录源码与测试摘要。

- confirmation.ts SHA256：`eba665bf96398deb79cf15c362e32047c3072cb5115de20f7765d3ac6f610a58`
- test SHA256：`69d5072926cf6721d907532d3cfcc7c2990e5c8df5caee53834031a9f020d588`
- 新 fixture SHA256：`c8751879a446efb0e607b0fd85c321877cdeec2d4578950407ef018886ecfb48`

测试与证据冻结。source/key 仍为空，不广告能力，不把 queued 投影当作文件执行许可。
