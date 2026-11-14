# A-02 候选补丁交接

- 基线文件：`D:/MC_start/OUCL-download-main/src/services/install/installer.ts`，SHA256 `61cc82b9efd6ccf284fce40e6f90afeb44243762472eeb191721275f668578fe`。
- 候选文件：[installer.ts](candidate/src/services/install/installer.ts)，SHA256 `210def46d85fce870c2e47ea3fc34fc882612a55fedb00bbc1b3f5af96301ac6`。
- 单文件差异：[installer.patch](installer.patch)，SHA256 `0c30a923e4cf2abf3ce727eddbb00062f69858bf3d3ea400d8ddfc6f57a238c9`。已对上述基线只读执行 `git apply --check`，通过；**尚未应用**。
- 回归夹具：[a02.test.ts](candidate/tests/a02.test.ts)，SHA256 `1e7826a82eef10b307cc41cfbbc71945b3b3dac8b602c94131cf3f17824a8368`；需要整合方按目标测试环境设置 `A02_ROOT` 为其自有隔离目录并编译运行，不向目标测试目录硬编码本机路径。执行器 [run-a02.cjs](run-a02.cjs) 只供本机证据复现。

修改点全部在 `resources()`：关闭后阻止启动新runtime；缓存尚未完成的同一Promise供并发调用复用；失败后等待本方法拥有的协调器、两个解压器、对象库（若已取得）和哈希池按依赖顺序结束，只有所有清理成功且缓存仍指向该Promise才删除失败缓存；清理失败转 `NEEDS_RECOVERY` 并保留失败缓存，不用新初始化覆盖不确定资源。成功结果保持唯一复用，现有 `close()` 仍等待原Promise。

未改ObjectStore/OwnerGuard及其恢复逻辑、公开IPC、持久schema、依赖和锁文件。整合前应复核A-01改动及同文件基线是否改变；若对象库内部清理无法证明完成，不能把A-02外层资源清理理解为A-01已解决。整合方负责复跑适用的全量验证与共享文件协调。
