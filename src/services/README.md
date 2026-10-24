# services

storage为已获批阶段1A的私有元数据仓库基础：异步JSON提交、SQLite权威操作日志/任务/幂等受理和保守恢复。同步SQLite模块必须由后台worker独占，当前未被主进程入口导入。具体约定见docs/contracts/STORAGE_RECORDS.md；实例文件事务与执行器接入仍在进行中。

workers提供StorageClient和有界HashPool，正式worker产物已在Electron运行时验证。存储请求超时仅表示结果未知；哈希取消等线程退出后结束。当前均未装配到普通应用入口，解压和业务IPC仍待实现，详见docs/contracts/WORKERS.md。

objects提供固定SHA256本体、独立来源证明、去重提交和索引重建，已接存储/哈希worker并通过Electron验证。来源认证仍由元数据服务负责，不能只凭本地摘要或索引相信内容；未知/损坏证据保留，不自动覆盖或GC。详见docs/contracts/OBJECT_STORE.md。

已批准的主进程IO编排层。本轮不实现下载、账户、实例或启动服务；平台能力经适配器注入。
