# 启动档案持久化

用户D-20具体批准记录见DECISIONS，正式ProfileService落实已批UUID算法、显示名分离、改游戏名新建档案及明确选择Java后的探测/固定引用。复用既有版本JSON/原子提交/SQLite日志，无新依赖/公开IPC或数据库schema修改。

`pnpm check`退出0：237测试235 PASS/0 FAIL/2原有环境SKIP，typecheck/lint/build通过，完整[check.log](check.log)。4项新增测试包含固定UUID兼容向量、严格字段/关系/路径校验、真实StorageClient关闭重开后的档案/Java保持、同请求重试/改变payload拒绝、同名冲突、并发Java/账户创建不丢记录、改游戏名保留旧档案、CAS及失败探测。核心覆盖行/函数100%、分支99.07%，不代表服务整体覆盖。

本机可信JDK17执行独立Java标准UUID.nameUUIDFromBytes计算，Notch、Steve、OUCL_Test1三向量与Node实现一致，见[java-uuid-vectors.json](java-uuid-vectors.json)。该独立计算验证UUID字节/位规则；字符集/长度作为用户批准的产品规则，不冒充所有游戏版本实机已测。

`pnpm test:workers-runtime`退出0，正式Electron45/Node24.22打包worker实际写入并关闭重开，offlineIdentityPersisted/javaSelectionPersisted=true，见[electron-runtime.json](electron-runtime.json)。该存储测试JavaProbe使用明确fixture（profileJavaProbeMocked=true），不冒充新本机JVM探测；既有真实Java17探测及游戏主菜单另有报告。

公开Java/账户/设置契约、系统Java选择操作、账户/启动/会话UI与新exe仍待接入。当前正在运行的1.20.1验证进程来自此前源码启动服务及专用测试身份，不是这些新档案驱动，也不能结束它来伪造退出通过。
