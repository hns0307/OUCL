# M 被动任务视图：真实服务测试

2026-11-18，沿已批准方案 A。仅新增 `tests/distribution-task-views.test.ts` 与本目录证据，未改旧 J/K/L 源码或夹具，未提交。

## 实际装配

独占 `D:/MC_start/OUCL/tmp/task-views-20261118-m/domain/<pid>/`。复用 J 真签名/Store/任务 worker/Mod worker/native，再装配真实 K/Runner；通过实际 StorageClient.writeInstance 注册项目现有 modReadyInstance 合法合成记录，真实 installation/root revision1 由原 fixture 持久化。

Provider 只拿 ready/readByTask/listAll 和 storage 只读端口，没有执行、claim、元数据写入端口。第一格中的 task completed 是前置真实 Runner 的效果，不归因于 views。实例记录是合成安装元数据，不宣称真实游戏安装；平台/许可/发行/环境端口仍合成，fetcher 无公网，不触玩家目录。

## 最终结果

**7 PASS / 0 FAIL / 0 SKIP，5156.5104 ms，exit0**。最终全工程 tsc exit0；新增测试局部 ESLint exit0。

1. 真实注册 root/instance 的 queued get/list/targets 绑定同任务、历史instanceRevision1；实际 Runner/native/K 后三种读取均 completed。真正无两侧记录的 taskId 才 undefined。
2. 真实任务投影缺 admission 返回 NEEDS_RECOVERY；再在独占SQLite连接明确关闭该连接FK、删除该task但保留真实dangling request，point仍拒绝，不能伪undefined。另有明确port注入：findAccepted错taskId拒；readByTask返回accepted对象在下一storage await被改为projected仍UNAVAILABLE，验证立即快照。
3. 真实另一个注册实例原先targets为空；任务全域增加真实孤儿投影后，即使查询该空实例也NEEDS_RECOVERY，list同样拒绝，不能先过滤后隐藏损坏。
4. 真实同release的新proposal prepare→ticket→admit，未投影的accepted记录使get/list/targets都UNAVAILABLE，不伪空。另有listAll raw accepted数组在下一projection await被repair的明确注入，立即snapshot仍拒绝为UNAVAILABLE。
5. 外部startup barrier held时metadata read计数0；释放后真实queued可读。barrier抛合成对账错误时UNAVAILABLE且不读取metadata，不假称startup成功。
6. 注入instance envelope/summary revision不一致返回NEEDS_RECOVERY。真实worker在第一轮readInstance后CAS写revision2，targets前后scope检查OUT_OF_SCOPE；注入installation revision漂移返回ROOT_UNAVAILABLE。历史point get仍可读，不把当前instance变化用于隐藏任务历史。
7. 同task并发get共享held真实read；close不提前完成，新请求UNAVAILABLE，释放后旧读正常settle。另provider的list/targets共享held inventory；同instance targets单飞，第二instance允许，第三不同instanceCAPACITY_EXCEEDED；全程inventory在途首次调用计数1。

FK删除是故意损坏**测试根**元数据，不是产品允许的写操作；raw对象变更、root drift和错binding均标明恶意port注入。没有将这些包装器冒称真实外部竞态或全公网验收。

## 原始证据与复现

首轮7PASS日志/status保留为 `tests-before-review-guards.log` / 对应status；最终补齐末审反例并重编冻结源后再跑原7格。没有修改断言制造green或覆盖历史。

固定父目录esbuild非bundle编译src/test/旧helper与modReadyInstance，保留worker入口；无新依赖：

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/task-views-20261118-m'
$env:OUCL_SOURCE_ROOT='<本checkout绝对路径>'
node --test D:/MC_start/OUCL/tmp/task-views-20261118-m/build/tests/distribution-task-views.test.js
node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js tests/distribution-task-views.test.ts
```

`tests.log`、`typecheck.log`、`lint.log` 及status JSON保存实际退出码；test-status绑定最终源码和测试摘要。Provider SHA256：`724d96c2aa656ad18d6c433776d5af4b1fcfa22206766fa0636307ce4012c52e`；admission-record SHA256：`40a6c6b179e0b5e181f5f4fadeeb011b5e60aee5664da627af0f0e7f1daf5c20`。

新test SHA256：`3082504b2cf1cbfb27a161ae9b2a97562e0c54a54a3823e2e15c6b35c45fcc0a`。

测试源码冻结，未发现有限矩阵内的最终阻断。完整回归/构建/提交交主协调，不预记结果。readByTask保留全库审计，本报告不宣称点查消除了全库成本；没有公开kind/router、startup执行、任务控制或产品配置接线。真实source/key仍空。
