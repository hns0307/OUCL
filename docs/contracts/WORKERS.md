# 阶段1A最小后台执行器

2026-10-24。落实已批准的主进程显式装配、有界worker、任务持久化及异步哈希方向；不是渲染端IPC，preload未增加方法。只有内部平台适配器可传已登记目录或staging文件；本接口不能接收renderer任意路径。当前存储/哈希可运行，解压与完整对象提交尚未接入。

构建产物为dist/workers/entry.cjs，入口由仓库构建脚本固定，不能由UI指定脚本或下载脚本替换。worker启动数据仅接受exact对象：

- `{version:1,kind:storage,directory:已登记专用绝对目录}`，一个目录一个写worker，先open/recover后ready。
- `{version:1,kind:hash,file:已登记暂存绝对路径,maximumBytes:0–64GiB}`，一次流式哈希后退出；路径祖先与文件handle复核，拒绝链接/非普通文件，SHA1/SHA256及实际大小交由可信元数据策略核对。哈希本身不证明来源。

存储请求exact envelope为`{version:1,id:UUID,command}`；command仅accept/get/update/close。accept携带稳定ownerId、业务requestId、taskKind与payloadDigest，get/update携带ownerId/taskId，update含expectedRevision/Execution。没有任意SQL/JSON/脚本命令，JSON领域服务后续另接固定schema。成功response仅可带StoredTask，失败仅枚举WorkerCode，禁止堆栈/本地路径。启动ready、startup-failed，hash-progress与hash-result亦严格校验字段/版本/整数/摘要。

StorageClient最多32个未完成请求，另保留一个close控制位。默认响应/启动期限10s，调用等待超时仅表示结果未知：不杀写worker，不假取消，不释放未完成槽位；后续同业务requestId恢复受理，get查询实际状态。迟到响应释放槽位。主进程退出前close排队到早先请求之后，等数据库关闭、本人lease释放和实际worker退出；线程崩溃统一WORKER_FAILED，不自动重放。shutdown超时终止线程会保留不明现场，后续恢复不能自动抢占owner。

HashPool默认并发2、最多4，最多32个等待任务；worker堆上限64MiB，256KiB流块，单次任务期限120s。排队取消不启动线程；执行中取消终止且等exit后才reject(CANCELLED)。close取消全部并join。进度最多10Hz，终态附最终字节数/摘要。哈希超量、输入变化、不明worker消息或崩溃不返回成功。

存储worker堆上限128MiB，SQLite同步能力始终留在线程内。Node/Electron具体兼容及响应证据见A1-04c报告；主事件循环心跳不是UI FPS测试。后续受控解压、对象仓库、实例物化、任务调度和实际IPC装配完成前，不标A1-04整体或简易启动器完成。

A1-04b补充：私有存储消息现包含object:lookup/sourceKey、object:remember/sourceKey/object(digest,size)、object:clear。成功响应可带object或task之一，严格拒绝两者同时出现。索引单独保存在objects-index.sqlite，规则见[OBJECT_STORE](OBJECT_STORE.md)，不是任意SQL/路径接口。test:workers-runtime目前将新增对象证据写入A1-04b，A1-04c旧报告保留历史。
# 2026-10-27 接受凭据只读查询

固定私有指令find-accepted与accept使用相同ownerId/requestId/taskKind/payloadDigest严格schema，但只查既有requests/tasks，不插入、恢复或更新任务；返回原StoredTask或缺失，参数/类型不符为REVISION_CONFLICT，不接受SQL/路径/额外字段。RecordStore持有原lease并串行派发，复用现有SQLite表/事务格式。用于加载器接受结果丢失后的本地恢复；renderer没有该原始指令权限。

