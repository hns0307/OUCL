# A1-05原版批量下载执行器

在5620b0c基础上增加InstallDownloadService及精确索引导入。仅内部服务，无新增依赖、渲染IPC或持久schema。完成表示可信共享对象齐备，尚不表示实例物化/游戏可启动。

`pnpm check`退出0：152项测试，150 PASS / 0 FAIL / 2既有环境SKIP；类型、lint、构建通过，完整输出见[check.log](check.log)。core行/函数100%、分支98.98%，不声称服务或UI整体覆盖率。最初受限环境执行真实文件/SQLite测试失败，在正常本机权限下重跑通过；没有修改权限策略或跳过新增失败。

新增8项测试使用实际ObjectStore文件、受控字节与内存搜索索引：固定并发窗口、原索引字节保留、多proof追加、重复运行缓存、坏索引/预取消零网络、并行安装取消隔离、回调异常脱敏与兄弟收尾、写入失败优先于取消、文件/清理错误脱敏、取消等待不可撤回commit、调用方修改输入不影响已接收计划。fixture传输不是官方游戏实际下载。

`pnpm test:workers-runtime`退出0，实际Electron45/Node24.22正式storage/hash worker通过：索引原字节提交和client fixture共2份制品，重复批次仅有1次网络适配器请求；独立来源、共享取消、续传和事件循环验证继续通过。证据见[electron-runtime.json](electron-runtime.json)，并非真实MC启动。

边界：索引从已验证metadata正文直接写受管staging后ObjectStore.commit，不扩大artifact host。一次最多4个默认下载consumer，逐制品追加独立来源；不会将数千文件一次性入活跃队列。失败中止本批，等待消费者/commit/adopt收尾，不关闭全局协调器，不删除共享缓存。进度仅累计已完成验证字节。任务关联仍仅内存，进程退出后的完整安装任务恢复、物化、安全解压、Java、离线档案、进程与UI和exe实测继续待办。
