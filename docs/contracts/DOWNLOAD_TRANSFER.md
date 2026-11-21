# 阶段1A可信制品物理传输

落实已批下载、SQLite事务元数据、固定共享对象及有界worker方向；不新增渲染IPC，不改变原tasks.sqlite schema。本模块只有单个物理传输执行器，不代替多消费者/安装任务编排及tasks:*订阅。

DownloadSpec为`{url,expected,anchor}`，来源定义沿用OBJECT_STORE，key=sourceKey(expected,anchor)。调用方必须先验证官方描述，再传入制品事实；ETag/Last-Modified只决定续传，最终仍核对官方摘要/大小与本地SHA256。当前传输仅允许piston-data.mojang.com、resources.download.minecraft.net、libraries.minecraft.net、launcher.mojang.com的HTTPS，禁止URL凭证、端口、query/fragment及重定向，采用identity编码。localhost只在测试fetch适配器中映射。

## 权威续传状态

transfers.sqlite与任务库/搜索库分离，由同一存储worker和RecordStore lease独占。application_id=0x4f554354、user_version=1、WAL、FULL，STRICT表transfers(key TEXT PRIMARY KEY,record_json TEXT NOT NULL)，每行≤16KiB。

exact记录为`{key,stagingId,revision,url,expected,anchor,bytesDone,state,etag?,lastModified?,objectDigest?}`。key为64位小写SHA256，stagingId UUID，revision正安全整数；bytesDone是fsync并获SQLite确认的前缀，不依据文件长度猜测。state=partial/complete/committed，后两者要求完整大小；仅committed有objectDigest。强ETag须带引号，无可靠validator的部分从零重取；规范HTTP Last-Modified可作为If-Range。

CAS要求revision逐次加一，首次partial/0字节/无validator；身份及staging不可变，退回只能到0，换源须回0并清validator，committed不可改写。原RecordStore的transfers.json保存`data:{enabled:true}`，先提交marker再允许插入传输。marker在而库丢失不建空；无marker但库非空也停写，只有空初始化窗口可补marker。启动检查schema/integrity/全部记录；每次get/set/list复核文件类型与初次dev/ino，不只信旧SQLite句柄。可注入stat适配器做测试，生产默认真实检查。

私有worker仅增加transfer:get/key、transfer:set/expectedRevision/record和严格transfer响应，不开放任意SQL/路径，也不将原始记录暴露renderer。

## 文件与HTTP

HttpTransfer仅写已分配的受管staging：检查祖先、普通文件及handle身份；实际文件短于已确认前缀则停写，多出的未登记尾部截断。处理partial write，约每1MiB及异常/结束时先fsync再提交checkpoint；取消/断网也等文件关闭。物理onProgress是内部通知，UI发送合并由后续任务层负责。

headers默认15s、读流闲置30s。206核对起止/总长/长度/validator；200忽略Range先登记0再截断；416仅接受完整前缀及相符总长。异常Range最多清零全量重试一次。清零确认后立即清除内存偏移，避免truncate/fsync失败后重新登记旧计数。超量/错误编码不成为complete。429/503返回有界Retry-After提示，不阻塞sleep或无界重试。

ArtifactTransfer拒绝同key并发物理写入，后续协调器负责合并消费者。身份登记先于HTTP，完成后对象校验/追加提交，最后记committed。对象提交前检查取消；提交开始后不假装回滚共享本体。错误摘要不提交，登记零前缀供明确重试。确认丢失只有在来源/对象重新验证且权威摘要不矛盾时才恢复既有结果。

尚未提供多消费者暂停/取消、安装任务图/订阅、Java传输、实例提交、对象修复、异常进程owner接管及断电保证。对象已移动而来源/索引未完成可能保守停在needsRecovery，不把正常关闭重开称为完整崩溃恢复。


## 2026-10-28 网络失败修复（当前行为）

SourceTransfer在单个文件传输边界内最多三轮尝试，覆盖NETWORK_FAILED、TIMEOUT和可等待的RETRY_LATER；250/500ms退避可取消，Retry-After更长时优先，超过30秒不提前重试。404等永久HTTP错误归BAD_RESPONSE，不进入瞬时故障重试循环；既有并行到串行验证回退仍有自身一次尝试。每轮从最新确认checkpoint重新打开staging，不绕过逐字节哈希；同源镜像保留前缀，跨源仍清验证器/偏移。单文件开始时冻结下载偏好，后续重试不偷偷换设置；磁盘/NEEDS_RECOVERY优先于同时发生的取消。429/503及408/500/502/504作为临时响应处理。

目录JSON读取对临时连接/408/5xx最多三次尝试；429和其他永久HTTP状态不在内部提前重试，摘要/长度/编码错误保持拒绝。Maven官方SHA1 sidecar和HEAD大小分别拥有12秒、三次的预算，可取消退避，HEAD重试不重新获取已验证sidecar；body与请求所有者在下一轮前退出。无新增公开IPC、持久字段、依赖或源白名单。具体测试和参考取舍见../validation/NETWORK-FIX-20261028/REPORT.md。


同轮完整安装进一步触发Electron内置Undici不可捕获断言；桌面生产通过main/network.ts将Electron net.request一跳流适配显式注入下载/目录/加载器/资源/Java，不修改测试默认传输。HTTPS和证书验证保持，禁止环境会话Cookie和认证凭据，手动跳转仍交既有白名单验证。无Node解析器接管/全局fetch替换或新依赖；普通Node单测通过注入传输继续运行。
