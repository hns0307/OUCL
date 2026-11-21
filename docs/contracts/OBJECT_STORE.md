# 阶段1A共享对象与来源记录

2026-10-24。落实已批准的固定store、SHA256本体、独立来源记录、只读策略与可重建SQLite索引；不改变既有任务数据库格式，不增加渲染IPC。当前为独立服务及Electron运行验证，尚未接网络和实例物化。

ObjectStore在已登记专用store目录持objects.owner.lock随机所有权标记，串行提交。未知/遗留owner拒绝抢占。staging/<UUID>.part仅由服务分配，渲染端不能提供本地文件路径。下载器须结束写入并关闭文件后才交给commit；中断暂存保留，discard只删除指定受管普通文件入口。

对象位置为objects/sha256/<前两位>/<完整摘要>。提交前通过有界worker计算SHA1/SHA256/大小，与可信预期同时核对，再fsync暂存并同卷rename；设置只读。已存在同摘要对象必须重新核对，错误内容保留并拒绝覆盖。受管写入遵守仓库排他约定，不声称防御同权限恶意进程持续替换路径的竞态。首版没有自动GC，不删除无引用/孤立本体。

来源文件位于每个对象旁的<摘要>.sources/<sourceKey>.json，exact格式为`{schemaVersion:1,objectDigest,expected,anchor}`。expected为algorithm(sha1/sha256)、digest、size(0–64GiB)、provenanceId；anchor为kind(mojang-version/mojang-assets/adoptium-runtime)、algorithm、digest。算法决定摘要长度，均规范为小写。来源记录≤64KiB，未知字段/版本拒绝。kind枚举只描述证据关联，不代表已完成发行商API或来源验证。

sourceKey是规范化expected+anchor的SHA256；不同来源即使内容相同，亦保留不同记录。服务调用方必须先建立官方元数据/可信发行商链，本模块不能因字符串合法或本地SHA256相同而认证来源。来源证明独立原子暂存/fsync/rename，之后才更新搜索缓存。lookup必须读取匹配证明并重新核对本体，不能只信索引。

objects-index.sqlite位于受存储worker lease保护的metadata目录，与tasks.sqlite物理分开。application_id=0x4f554349、user_version=1、objects(source_key主键,digest,size)，只存搜索提示。私有worker增加object:lookup/sourceKey、object:remember/sourceKey/object、object:clear白名单和严格object响应，不接受任意SQL。未知数据库/版本保留并停用对象搜索；不把未知库当缓存随意删除。

索引丢失时可依据对象旁来源证明及重新哈希重建，清理范围仅objects表，不影响任务、请求幂等、操作日志或对象文件。没有来源证明的孤立对象保留且不获得信任；来源暂存忽略但不删除。提交后、证明前中断只留下不可信孤立本体；证明后、索引前中断可重建提示。此追加协议不执行玩家入口替换，实例事务仍需既定操作恢复日志。

尚未完成跨进程崩溃后owner接管、真实磁盘满/断电、链接物化和已损坏对象修复。当前发现损坏拒绝复用且不自动覆盖，后续修复需保护有效消费者。私有接口不处理显示昵称、存档、配置、凭证或用户任意目录。

## 2026-10-25 Java运行时来源扩展

用户已明确批准按需Java准备。anchor.kind追加`mojang-runtime`，其digest为已验证Mojang运行时manifest的SHA1；expected为manifest内raw文件的大小/SHA1，provenanceId固定为`java:<manifest-sha1>`。保持schemaVersion=1及原记录字段，旧kind继续支持；没有新渲染通道或SQLite迁移。来源仅由主进程JavaRuntimeService在验证官方索引→内容寻址manifest后构造，调用同一下载协调/对象仓库；不将字符串枚举合法视为信任证明。具体发布与恢复边界见根docs/BOOTSTRAP.md。
