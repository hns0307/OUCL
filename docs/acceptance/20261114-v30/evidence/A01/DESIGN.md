# A-01 对象根独立所有者租约设计（待统一管理者审阅）

2026-11-14。此页为复现后的最小修复设计，未实现、未修改批准。依据2026-11-01已批准的安全所有者接管及相关存储/安全基线调整；只有超出该范围的变化才需另审批。不引入依赖、公开IPC、任务表或玩家数据迁移；A-02缓存重试不在本增量。

## 目标及明确范围

在**对象租约成功open之后**，只要旧对象根的可验证OS排他句柄已释放，新持有者能够验证同根/同guard/同格式并安全取得该对象根；其他活跃profile仍不能竞争写入。metadata与store各自决定所有权。旧UUID、损坏、未知或身份不符的对象标记继续停写。

不保证全部启动初始化断电、介质损坏、目录迁移、外部非协作写入或游戏gameDir锁自动恢复。对象根租约修复只证明可取得写入排他权，不将部分对象或来源证明自动改为已提交。

## 推荐结构：共用机制，固定域配置，独立根实例

推荐抽取OwnerGuard的底层Windows SQLite排他/身份核验机制为私有 `FileOwnerLease`，由两个薄包装使用**编译期闭集配置**：metadata OwnerGuard与新的ObjectOwnerGuard。保留metadata现有文件名、APPLICATION_ID、marker字节格式与行为，避免顺带迁移它。ObjectOwnerGuard放在`services/objects`或storage私有基础层，ObjectStore只持有该租约，不持有metadata租约token。

| 属性 | metadata（现状保持） | 对象根（新格式提案） |
| --- | --- | --- |
| 根 | profile/metadata | 安装登记得到并guardDirectory验证的store |
| 兼容互斥标记 | owner.lock | objects.owner.lock（继续使用该入口，使旧客户端wx失败） |
| OS guard | owner.guard.sqlite | objects.owner.guard.sqlite |
| domain/application_id | 既有值不变 | 专用对象域值，不等于metadata值 |
| marker前缀 | 既有oucl-owner-v2 | 固定oucl-object-owner-v1 |
| 身份 | 既有格式不变 | guard UUID、guard文件dev/ino；建议同时绑定对象根目录dev/ino |

新marker须严格解析固定前缀、标准UUID、十进制文件身份，不允许由调用者传任意marker路径、文件名或schema。新对象guard数据库须验证application_id、schema/version、唯一domain/id行与integrity_check。guard文件为普通单链接文件、非符号链接、ino非0；所有祖先均受guardDirectory保护。锁定前后复核根目录及guard dev/ino稳定。不同路径别名解析至同一物理store时必须竞争同一个guard；不按profileId或rootId另外生成guard文件。

不推荐直接在store调用现有OwnerGuard.acquire：它会创建owner.lock/owner.guard.sqlite并使用metadata域格式，容易产生两套兼容标记及错误信任关联。也不推荐以“本profile metadata guard已取得”为理由删objects.owner.lock：另一个profile的metadata锁可以同时有效，本轮已证明这一点。

抽取公共机制会扩大少量metadata代码差异，若协调者要求第一片保持metadata源完全不动，可先用严格对象域薄实现并在下一独立重构归并；不能通过给现有OwnerGuard增加任意字符串路径参数来省代码。实施前选定一种方式，避免同时出现两套不一致的回收协议。

## 取得协议

1. 从可信登记解析store规范路径，核对普通根及祖先身份。先读取兼容对象marker；**旧UUID或未知格式立即STORE_BUSY且不修改任何证据**，即使metadata guard可取得、对象guard存在也一样。
2. 仅处理“marker不存在”或“严格新对象格式”两类。存在marker但缺guard、损坏guard、孤立未知sidecar、文件/根身份不符均NEEDS_RECOVERY；不删除后重建。
3. 对对象guard取得SQLite `BEGIN IMMEDIATE`（busy_timeout=0），活跃竞争者返回STORE_BUSY。该句柄由对象根的主进程ObjectStore持有到全部操作退出，worker消失不能提前释放。不同profile共享根时也遵守该唯一入口。
4. 在OS锁内重新读取marker、核对guard/根身份；新格式旧marker必须与已验证身份完全一致。marker不存在时用wx创建并write/sync/close；marker存在且匹配时原字节保留。旧持有者退出由成功取得同一实体的OS锁证明，不使用PID、时间、窗口、缓存索引或新token猜测。
5. 成功才发布ObjectStore实例；创建staging/objects子目录等失败时，先完成本次局部清理，再只移除确属本次持有且字节/身份一致的marker并释放guard。无法确认则停写保留证据。未返回成功的open不向任何任务授予对象操作权限。

## 初始化、辅助文件与提交边界

最小片的恢复承诺从guard完成初始化、marker已持久化、ObjectStore.open成功开始；对该点之前的中断必须逐点列明，不能借A-01修复宣称所有初始化断电已解决。

| 中断/状态 | 推荐处理与边界 |
| --- | --- |
| 首次guard建立前，无marker/无guard | 可正常创建对象guard；legacy标记若出现则拒绝 |
| 初次空guard文件已建立、schema尚未提交 | 可能留下空/无application_id数据库；不能把任意空文件当可信初始化。最小片安全返回NEEDS_RECOVERY并保留；若要自动恢复这一格，需要额外可验证初始化发布协议，另行细化，不能覆盖重置 |
| guard有效、marker尚未创建 | 取得OS锁并验证唯一对象domain/UUID后可创建新marker；先检查孤立/异常sidecar |
| marker写入被截断、未知内容或身份不符 | 继续停写；不凭guard可锁定推断marker可丢弃 |
| 成功open后进程退出 | OS释放SQLite锁；新持有者按步骤3–4验证并接纳同格式旧marker。A-01主目标 |
| 有效guard的热rollback journal | 由同SQLite受控打开进行其标准恢复并验证完整性，随后取得排他事务；不要手工删除journal。若不能验证，停写 |
| guard不存在但发现-journal/-wal/-shm | 保留NEEDS_RECOVERY。不要创建新guard掩盖辅助文件 |
| guard存在且出现未经支持的WAL模式/sidecar组合 | 不盲删；对象guard可固定rollback日志模式并校验。不把应用对象索引的WAL与所有者guard sidecar混为一谈 |
| close已删除marker、仍持OS锁时进程退出 | 新进程取得OS锁并验证现有guard后，可创建新marker；旧客户端可能wx先进入，此时新客户端再次读取marker必须看到旧UUID并拒绝，不能双写 |

对象内容/来源证明的提交顺序保持原ObjectStore协议：先已验证内容，再独立来源证明，再可重建索引。取得新租约后仍执行既有验证/恢复，不自动删除孤儿内容、临时文件或.sources，也不改下载任务ready状态。崩溃发生在对象落盘与proof/索引之间时，租约可重取只代表排他权恢复；不能将缺proof对象当可信对象，索引仍仅提示。后续测试应用现有对象/provenance夹具覆盖，无需新网络。

## 正常关闭与失败生命周期

先停止新接纳、等待本ObjectStore串行队列和引用它的传输/worker结束；然后在仍持OS排他权时复核根、guard及marker身份，只移除自身匹配marker；最后rollback/close OS guard。metadata OwnerGuard最后由StorageClient自身关闭，不由ObjectStore代管。

对象租约处于closing/failed时不得继续接纳写入。unlink或身份验证失败必须保持证据并报错，不能在未知资源还活跃时强制释放/重开。构造失败只处理本次所有权；未知旧锁永远不走“清理重试”。不顺带修改InstallerService.runtime拒绝Promise缓存（A-02）。

## 兼容与安全决策

- 新guard和标记新增在对象store根；metadata文件、公开IPC、SQLite任务/实例JSON格式不变。此为已批所有者协议方向内的私有存储证据变化。
- 现有所有UUID对象锁，包括刚由当前fab0ac8创建并遗留的锁，均无法自动归属；继续停写是兼容底线。不得为了迁移“已知来自新版本”的旧锁而猜测。
- 旧客户端只认objects.owner.lock的wx排他：新进程持锁期间保留该标记可阻止它。两新profile则由同对象guard保证唯一。正常关闭时marker先移除、OS锁后释放；新客户端需二次核对marker以防旧客户端窗口竞争。
- 不移除或重命名未知guard、sidecar、旧锁，不尝试以硬链接/目录搬移回避占用。克隆后guard身份不符且marker存在应停写；干净目标重新登记不等于旧根恢复。
- Windows为本片验证平台；不自动声称POSIX文件替换/目录重命名具有同样保证。

## 实施后建议的精确验收（尚未执行）

1. 重用本轮握手后自exit模型：新对象guard和metadata均可重取；旧对象marker字节/身份被验证，内容/proof不变；两个OS guard均真正竞争排他。
2. 两个不同profile同时竞争同store，只有一方成功；赢家正常close后另一方可取得；metadata相互独立。路径别名和根身份变化各有受控拒绝用例。
3. UUID/未知/截断marker、marker无guard、guard损坏/替换/多链接、孤立sidecar及失败close全保持证据；不扩大为旧锁回收。
4. 在已经成功open的新空根内，复用正式对象提交夹具的关键边界，断言重取租约不绕过哈希/来源proof验证，不将孤儿对象升级为可信。
5. 局部通过后才做对应完整类型/lint/单测/build及正式worker；若有新产品EXE证据，由唯一GUI协调者在受支持归属条件满足时安排。当前CUA拒绝bootstrap派生强杀的格仍DEFERRED，不能用本Node模型代替。

本轮只提交设计；没有运行上述修复后用例，没有扩张真实强杀矩阵，也未触碰A-02。
