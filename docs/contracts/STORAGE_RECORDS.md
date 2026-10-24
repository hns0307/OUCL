# 阶段1A私有元数据仓库实现约定

2026-10-24。实现已批准的版本化JSON、SQLite事务任务和操作日志方向；不是新增IPC能力，不改变实例/共享对象布局。当前仅独立临时目录验证，尚未注册为应用实际数据仓库。具体实例物化事务仍按STORAGE_LAYOUT的清单/入口协议实现，不用本模块声称已覆盖文件制品回滚。

RecordStore仅接受主进程登记的专用目录，未来由单一后台worker持有。目录各级当前不能是链接/junction；Windows只接受本地盘符，展开8.3名称后保持真实路径。owner.lock排他创建，内容是随机所有权标识；正常关闭核对后移除，未知或崩溃遗留标记不自动抢占。它不依赖PID/时间自动判死，不承诺抵御同权限恶意进程持续替换路径的TOCTOU。

JSON记录名为受控ID（1–80字母/数字/下划线/连字符，排除Windows设备名）加.json；exact envelope为`{schemaVersion:1,revision:正安全整数,data:领域schema}`，上限4MiB。当前领域解析器由服务注入，不能作为renderer任意JSON写接口。revision=0仅用于新建请求。未知版本/额外字段拒绝；当前无旧版可迁移，未知版本保留现场停写。

tasks.sqlite使用application_id=0x4f55434c、user_version=1、WAL、synchronous=FULL、foreign_keys=ON。缺失数据库且目录非空时拒绝初始化；数据库不是可删除的缓存。表：

| 表 | 内容与不变量 |
| --- | --- |
| operations | id UUID主键、record_id、phase、before_json可空、after_json；记录完整小型JSON前/后像，不存凭证；phase仅PREPARED/APPLYING/COMMITTED/ROLLED_BACK |
| tasks | id UUID主键、稳定owner_id、kind(download/install/java/launch/stop)、私有Execution JSON；任务元数据留在SQLite，不生成任务JSON文件 |
| requests | owner_id+request_id复合主键、kind、payload_digest SHA256、唯一task_id外键；与新任务同一事务受理，重复内容恢复原taskId，异内容复用拒绝 |

Execution严格字段为state/attempt/lastSequence/revision/bytesDone/bytesTotal?，状态见core/task/machine.ts。这是内部存储格式，不是IPC TaskSnapshot。读写按稳定owner授权，更新采用expectedRevision；应用重载不改变归属。重启时在途running/verifying/committing/pausing/cancelling/failing变needsRecovery，不直接重放；终态/暂停/排队保留。

提交顺序：PREPARED日志→APPLYING→排他暂存文件写入与fsync→复核旧目标→同目录rename（JSON提交点）→COMMITTED。操作串行化且仓库持排他标记。恢复逐项核对JSON与前/后像：APPLYING且JSON等于后像则补提交，JSON等于前像则回滚；其余停写。日志历史、修订、最新结果、孤立JSON/暂存、任务与请求证据不一致均拒绝恢复，不清空数据库。已知正确暂存才清理；损坏暂存保留。

边界：没有游戏安装任务图/成功result持久化、制品入口恢复、有界worker装配或崩溃遗留owner的人工恢复流程；不能据此标A1-04a整体完成。文件fsync不等于已证明Windows目录元数据/硬件断电持久性。上线前还需真实子进程中断、任务执行器和实例事务集成证据。
