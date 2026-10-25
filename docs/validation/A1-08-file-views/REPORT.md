# A1-08共享文件投影基础

新增FileViewService：已验证对象→受管文件软链接或明确复制回退→副本哈希校验→receipt；具体边界见[FILE_VIEWS](../../contracts/FILE_VIEWS.md)。不新增依赖、公开IPC或持久schema，尚未作为完整实例事务装配。

最终工作区`pnpm check`退出0：185测试183 PASS/0 FAIL/2既有环境SKIP；其中168既有测试、7项文件投影测试及10项并行Java基础测试。类型、lint、构建通过；完整输出见[check.log](check.log)。core行/函数100%、分支98.98%不等于IO或UI整体覆盖率。

7项投影测试实际使用ObjectStore和HashPool：副本与来源校验、登记入口复用、未知/损坏拒绝、权限错误回退、真实junction逃逸拒绝、预取消/坏输入/缺失receipt、同目标并发、实际链接能力选择与删除不影响对象、外来hard link不冒充副本。

`pnpm test:workers-runtime`实际Electron45/Node24.22通过，当前系统fileViewMode=copy、fileViewVerified=true；不是成功创建文件软链接的声明。既有下载/原索引/解压/哈希/存储验证继续通过，见[electron-runtime.json](electron-runtime.json)。没有修改权限或系统设置，未推送。

剩余：目录junction与共享视图装配、持久安装操作与consumer关联、实例清单/ready提交、私有natives发布、Java选择/注册、离线档案、游戏会话/实际UI和exe下载/启动验证。半成品不登记ready；本服务没有玩家文件覆盖/迁移/删除能力，也不宣称跨进程崩溃恢复完成。
