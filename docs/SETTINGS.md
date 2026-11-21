# 启动设置 v1（0.2.0）

2026-10-25用户明确批准前端改版计划中的接口和固定记录扩展。

`settings:update`接收`{expectedRevision,patch:{memoryMiB?,isolationDefault?}}`，至少一项；拒绝额外字段。5秒超时表示结果未知，重新读取，不当作取消。返回与`settings:get`相同的设置投影。新增错误`REVISION_CONFLICT`、`MEMORY_OUT_OF_RANGE`，仍有发送方和schema双重校验。

固定`launch-settings.json`记录包含既有`{schemaVersion:1,revision,data}`信封，data仅`memoryMiB`和`isolationDefault`；复用worker、原子写和SQLite操作日志。缺失记录读取2048 MiB/开启隔离，不修改历史记录。内存512–65536整数且不超过本机物理内存，启动读取已保存值；当前仅64位Java。设置修订与Java/账户记录修订独立。默认隔离仅初始化新建实例选项，不移动已有目录。

验证：首次受限环境测试在临时目录rename/目录链接处遇到EPERM；使用工作区临时目录并正常权限执行`pnpm check`后通过。具体完整日志保留`.test-build/v02-settings-verified.log`，不据此关闭历史阶段缺项。
