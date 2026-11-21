# 受管不可变文件投影

FileViewService.materialize(directory,relative,spec,object,{mode,existing?,signal?})是主进程安装服务内部能力，沿用共享对象/受管软链接/权限不足复制回退方向，不增依赖、公开IPC或独立持久schema。输出FileViewReceipt `{relativePath,objectDigest,size,mode:symlink|copy}`供安装日志/清单记录。

输入目录必须为主进程选定的普通受管目录；文件相对路径使用既有Windows安全规则。先用ObjectStore.lookup验证独立来源和实际对象，按受管store/objectDigest定位源文件。不得将任意renderer路径传入此API。当前只建立单文件入口，不会自动发布实例或建立assets/libraries目录junction。

优先文件软链接，仅能力错误EPERM/EACCES/ENOTSUP/EOPNOTSUPP/EINVAL时回退副本，不提权或修改开发者模式。副本通过wx创建、有界256KiB读写、fsync、实际SHA256/大小核对后只读；明确返回copy，不能冒充共享磁盘节省。不使用hard link。既有copy若nlink不是1则停写，防止将外部硬链接当成独立副本。

未知既有入口拒绝VIEW_CONFLICT，不覆盖。只有调用方提供已记录receipt才核对并复用；已登记入口缺失、内容变化、链接目标不符或父链含未知junction均NEEDS_RECOVERY。默认实现与真实文件系统创建/复核分开检查，每个服务实例串行，跨服务/进程须由安装操作锁协调。

取消在入口创建前停止；副本失败仅删除本次wx创建的条目，不跟随链接删除共享对象。入口完整建立后即使此刻取消也返回receipt，让操作所有者登记真实副作用；不能误称“已取消且无写入”。后续安装事务必须先持久化计划、持锁执行、记录receipt后处理取消/ready。尚无跨进程操作日志接入或玩家数据替换/删除，文件创建后进程崩溃遗留未知入口会保守冲突，不猜测所有权。
