# 对象根私有租约 v1

本协议仅覆盖成功打开对象根之后的进程退出恢复；不改变metadata OwnerGuard、公开IPC、任务表、实例JSON或依赖。Windows使用独立ObjectOwnerLease，其他平台继续使用UUID标记的普通排他，旧标记不自动接管。

- 兼容入口：`store/objects.owner.lock`。Windows严格格式为 `oucl-object-owner-v1:<uuid>:<guardDev>:<guardIno>:<rootDev>:<rootIno>`，普通单链接文件；旧UUID及未知前缀返回STORE_BUSY，新前缀截断/不符返回NEEDS_RECOVERY，保持证据。
- OS guard：`store/objects.owner.guard.sqlite`，application_id=`0x4f554f47`，user_version=1，仅一张 `object_owner(id, domain)` 表和一行，domain=`oucl.object-store.v1`；固定rollback/delete日志模式。不得使用metadata guard或profileId代替对象根独占。
- 取得：验证普通根及祖先，校验所有文件身份；SQLite BEGIN IMMEDIATE提供排他，同根不同profile仍竞争。guard及根的dev/ino在锁前后核对，marker在持锁后再次读取；与本guard/本根身份完全一致的新marker才可在前持有者退出后接纳。
- 兼容：创建marker用wx，旧客户端若在无marker窗口抢先写入UUID，新客户端重新读取后拒绝。持有新lease时marker保留以阻止旧客户端wx写入。不能通过新guard可取得去清理旧锁。
- 运行：每个对象操作开始/完成时核验租约；异步哈希、用户checkpoint、proof发布、对象移动及索引记忆前再次检查。marker删除/替换/多链接、guard替换/多链接或根身份变化会使当前lease永久失效，停止后续对象效果。非协作外部进程与文件API间仍有TOCTOU窗口；这不是针对任意外部写入的原子隔离保证。
- 关闭：拒绝新接纳，等待已排队对象工作结束；持锁验证并仅删除自身marker，然后rollback/close OS句柄。失败关闭不删除不符marker，释放句柄必须在工作排空后，原错误与清理错误保留为cause，不吞错。metadata由StorageClient独立关闭。
- 初始化边界：首次空guard未完成schema提交、marker缺guard、损坏/错误域/错误身份或任意guard sidecar均保留NEEDS_RECOVERY。本片**不自动回放guard的hot journal**：成功open后guard仅持无写入事务，不应生成sidecar；初始化中断留sidecar属于范围外安全阻断。不能删除sidecar或覆盖空guard凑恢复。
- 对象信任：重新取得lease只恢复排他权。对象内容、来源proof和可重建索引的原验证顺序不变；缺proof孤儿不会因租约恢复获得信任，也不会自动删除。
- 非Windows：不新建SQLite对象guard，继续UUID wx排他与正常close；增加每次操作的自身marker及文件身份核验。未在本轮运行非Windows平台，不声称跨平台恢复。

进程退出的服务层测试和真实EXE强制中断验收分开；后者仍需受支持的归属操作路径。
