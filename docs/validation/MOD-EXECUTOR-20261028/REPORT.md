# Mod确认任务执行器验证

本增量增加私有持久任务执行器，连接此前已有的确认接纳、准备下载和新增事务；没有开放公共按钮或生成新EXE。

验证使用生成JAR、独立.test-build目录及本地HTTP/metadata适配器，不访问公网或用户游戏数据，不启动Minecraft：

- 真实准备闭环：根资源库复验、一个必需依赖实际传输进入可信对象、逐JAR声明检查、一次文件事务、实例modCommitId/revision及索引提交；资源库记录保持。全部经过实际服务，平台标签版本不替代JAR声明。
- 执行器结合真实StorageClient/SQLite/文件事务验证重复确认只执行一次、进度落盘、准备取消等待清理、不生成实例修改、发布失败安全回退、无事务孤立确认不重放、提交阶段拒绝取消及close等待实际完成。
- 模拟最终任务更新缺失：真实事务先完成、SQLite任务仍committing，真实worker重开后needsRecovery；initialize只依据对应事务恢复completed，未重新准备、未递增第二次修订。
- `node scripts/mod-transaction-runtime.mjs`扩展为同时执行准备与事务两组测试；Electron45 as Node及正式dist worker共27项，27 PASS/0 FAIL，见electron-runtime.json。原11项报告保留在MOD-TRANSACTION-20261028，不覆盖历史证据。

尚未验证真实断电或强制kill全矩阵。详细失败原因的持久报告、公共确认IPC/任务投影、主进程及UI装配继续待办；内部闭环不当作产品交付。

最终pnpm check：506项/504 PASS/0 FAIL/2既有系统能力SKIP，类型/lint/build及核心覆盖率通过（行98.83%/分支96.90%/函数99.56%）。完整本地输出在.test-build/mod-executor-check.log，不把未运行的联网/游戏/EXE测试计入结果。
