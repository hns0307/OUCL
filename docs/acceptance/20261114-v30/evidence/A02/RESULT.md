# A-02：InstallerService 初始化失败缓存

2026-11-14。统一管理聊天明确分派的独立局部修复；E既有审查未重开。只在本目录非Git候选实施，稳定main及活跃共享WIP均未修改、提交、发布或操作GUI。

## 复现与结果

基线 `D:/MC_start/OUCL-download-main` HEAD `262d757ecad08add5a0db16817b2adab01b98149`，产品基线 `fab0ac8`。原始 `src/services/install/installer.ts` SHA256 `61cc82b9efd6ccf284fce40e6f90afeb44243762472eeb191721275f668578fe`。复制到本目录候选前后基线摘要相同；只读目录比较显示候选 `src` 仅 `installer.ts` 不同。

使用**正式InstallerService、正式ObjectStore和真实独立文件系统对象库**，storage为仅提供登记/实例读取/索引接口的确定性夹具，没有运行真实SQLite或网络。测试在本包output新建目录中由另一个正式ObjectStore正常持有owner；同一服务两个并发公开 `prepareJava` 请求共用首次初始化，均返回 `STORE_BUSY`，owner内容未改变。该owner正常 `close()` 后，同一服务公开 `prepareLaunch` 再次请求仍收到旧 `STORE_BUSY`，登记读取次数仍为1；预期是经过新的初始化后因夹具无实例而得到 `INSTANCE_NOT_FOUND`。[原始失败日志](baseline-runtime.log)：1项失败，故障按预期复现。

候选在相同场景下重新读取登记，取得对象库后到达 `INSTANCE_NOT_FOUND`，读取总次数2。进一步测试并发重试只产生一套成功runtime、存活时其他owner受 `STORE_BUSY` 阻止，正常 `close()` 后新的正式ObjectStore可正常获取并正常关闭。`prepareJava` 使用空文件清单的合成输入，只验证公开入口/资源所有权，不代表真实Java准备或游戏启动。

最终局部测试 [fixed-final.log](fixed-final.log)：**5 PASS / 0 FAIL / 0 SKIP**：

1. 真实对象库占用者正常退出后，同一服务可重试；成功runtime复用、close幂等及后继owner获取。
2. 注入延迟的HashPool清理期间，第二调用仍共享原失败；全部清理settle后方重新初始化。
3. 两个同时发起的失败后重试共享一次成功初始化。
4. 注入NativeExtractor清理失败时，其余清理仍执行，返回 `NEEDS_RECOVERY` 且同服务不重新初始化。
5. 服务close与在途失败清理交错时，close等待清理、拒绝新初始化；测试结束由其真实owner正常关闭自身锁。

第2、4、5项通过仅在测试进程内临时替换现有对象原型的方法注入等待/错误，最后恢复；不能称为真实worker崩溃或真实断电。没有删除其他owner的锁，也没有强杀进程。

## 命令与限制

在本目录运行：

```text
node run-a02.cjs
node D:/MC_start/OUCL-download-main/node_modules/typescript/bin/tsc --noEmit -p candidate/tsconfig-a02.json
node D:/MC_start/OUCL-download-main/node_modules/eslint/bin/eslint.js --config D:/MC_start/OUCL-download-main/eslint.config.mjs candidate/src/services/install/installer.ts candidate/tests/a02.test.ts
```

第一条基线运行退出1见 `baseline-runtime.log`；修改后退出0见 `fixed-final.log`。候选关联TypeScript严格检查通过（`typecheck-fixed.log`为空、退出0），两文件lint通过（`lint.log`为空、退出0）。首次类型检查发现 `exactOptionalPropertyTypes` 不接受赋值undefined，已改为 `delete this.runtime` 后重跑；原 [typecheck.log](typecheck.log) 保留。首次测试构建因稳定树未安装 `smol-toml` 失败（[baseline.log](baseline.log)）；后续只读复用活跃工作区已装的1.9.0库，未安装/修改依赖。

按分派不运行无关全量；此前655项不能记成本候选回归通过。此片未修改ObjectStore/OwnerGuard，不解决A-01自身open内部失效/所有权恢复；如果ObjectStore.open在返回前未能完成自己的清理，其证明和修复仍依赖A-01。`InstallerService.close()` 对已拒绝的初始化Promise沿旧逻辑吞掉该Promise错误，候选通过保持失败缓存和closed门禁防止同服务重新初始化，不额外声称close会报告清理失败。

候选文件、补丁、摘要及整合注意见 [PATCH.md](PATCH.md)。所有样本目录和日志保留，未清理其他人的工作。
