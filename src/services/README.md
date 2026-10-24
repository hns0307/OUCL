# services

storage为已获批阶段1A的私有元数据仓库基础：异步JSON提交、SQLite权威操作日志/任务/幂等受理和保守恢复。同步SQLite模块必须由后台worker独占，当前未被主进程入口导入。具体约定见docs/contracts/STORAGE_RECORDS.md；实例文件事务与执行器接入仍在进行中。

workers提供StorageClient和有界HashPool，正式worker产物已在Electron运行时验证。存储请求超时仅表示结果未知；哈希取消等线程退出后结束。当前未装配到普通应用入口，解压/对象提交/业务IPC仍待接入，详见docs/contracts/WORKERS.md。

已批准的主进程IO编排层。本轮不实现下载、账户、实例或启动服务；平台能力经适配器注入。
