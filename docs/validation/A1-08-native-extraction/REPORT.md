# A1-08安全native准备基础

新增严格ZIP读取/校验、隔离目录独占解压和专用NativeExtractor工作线程，约定见[NATIVE_EXTRACTION](../../contracts/NATIVE_EXTRACTION.md)。无新依赖、渲染通道或持久schema；这是实例/会话准备基础，不是完整A1-08实例事务或A1-09会话。

`pnpm check`退出0，168项166 PASS / 0 FAIL / 2既有环境SKIP，类型、lint、构建通过，见[check.log](check.log)。core行/函数100%、分支98.98%，该比例不覆盖全部IO/UI。新增12归档测试和4worker测试：合法stored/deflate/UTF8/data descriptor/空目录、原摘要、CRC/尾垃圾/展开上限、链接及路径别名、全局大小写/目录冲突、预算、ZIP64/加密/header/重叠、实际目录junction逃逸、空目录与禁止覆盖、exact协议、取消/关闭/限时与线程join。

真实官方验证`node scripts/verify-native-archives.mjs`（先pnpm test生成.test-build）：1.20.1的7归档解出18文件、3,354,056字节；1.12.2的2归档解出7文件、462,336字节。所有输入先经官方SHA1/实际下载/ObjectStore校验，再由解压线程核对SHA256；临时目录清理，gameLaunched=false。见[official-natives.json](official-natives.json)。这不是所有MC版本兼容承诺，也没有加载DLL或验证游戏窗口。

`pnpm test:workers-runtime`退出0：实际Electron45/Node24.22正式打包worker解出单文件fixture并验证字节，退出后文件/目录可删除；此前存储、批量下载、共享proof/取消、续传与哈希事件循环验证继续通过，见[electron-runtime.json](electron-runtime.json)。fixture DLL仅测试数据，未作为可执行内容运行。

剩余：受管共享视图/复制回退、持久安装任务与实例事务、私有natives最终发布、Java发现/管理、离线档案、游戏进程及安装/启动UI、新exe下载/启动实测。取消或归档中途错误保留隔离workspace，不宣称完整自动回滚或崩溃恢复。最终目标继续进行中。
