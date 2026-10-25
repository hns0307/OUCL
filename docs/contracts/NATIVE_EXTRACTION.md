# 私有native归档解压

落实已批安全解压worker与实例私有natives方向；没有新增依赖、渲染IPC或持久schema。使用Node自带zlib，不能直接在主进程调用同步归档展开函数。

NativeExtractor.run(destination, archives, {signal})仅为主进程安装服务提供能力。每次一个专用worker，无隐式无限队列；并发拒绝EXTRACTION_BUSY。请求exact `{version:1,kind:native-extract,destination,archives:[{file,sha256,size,exclude}]}`，只允许有界绝对服务路径；不接受脚本或renderer输入。成功exact `{version:1,kind:native-result,files,bytes}`，失败exact `{version:1,kind:native-failed,code}`，无路径/异常文本。

工作线程堆128MiB、默认120s硬期限，一次最多64归档、每档64MiB、总压缩输入256MiB、总展开256MiB、最多4096条目、单项64MiB。总输入Buffer和inflate输出也受上述预算约束，线程堆限制不等同总RSS限制。取消/超时/close会终止并等待worker退出后才交还控制，调用方此后可处理自己创建的隔离workspace。

读前检查来源父路径无链接，通过受校验文件句柄读取，大小和SHA256必须与已验证共享对象一致。SHA256仅确认内容身份，来源信任仍由既有官方元数据/ObjectStore提供。ZIP中央与本地目录、条目区域、CRC和完整deflate消费均校验，只支持stored/deflate；不支持ZIP64、多卷、加密、特殊链接/路径别名。META-INF/及指定前缀不写入，仍校验其正文和资源预算。

目的地必须是已存在且为空的受管目录；每层检查无junction/软链接，文件使用wx禁止覆盖。全局条目预算及大小写/文件目录冲突在首次写入前拒绝。CRC或磁盘中途错误可能留下本次隔离workspace部分文件，不能冒充事务回滚；不清理既有玩家目录、不发布到实例、不执行任何库。当前尚无与安装操作日志/任务恢复/实例租约绑定的最终natives目录提交。

各路径检查和独占创建不代表对同用户权限的恶意并发文件系统替换提供完全TOCTOU隔离。主进程必须只传自己的受管staging与已验证对象，后续物化/会话服务负责持锁、隔离workspace和失败恢复。
