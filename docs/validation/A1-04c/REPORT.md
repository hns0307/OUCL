# A1-04c 存储worker与有界流式哈希子增量

日期2026-10-24，沿用阶段1A持续实施/提交授权。新增services/workers内部协议、正式入口、StorageClient、HashPool及tests/workers/fixtures/runtime；构建增加dist/workers/entry.cjs，测试编译包含worker夹具，CI增加test:workers-runtime。无新第三方依赖、渲染IPC或磁盘格式变化。私有消息实现见[WORKERS](../../contracts/WORKERS.md)。

Node实际测试新增9项：严格消息拒绝；存储线程持久化/幂等/重启保护；32请求预算与close保留位；超时保留槽位及迟到响应；崩溃脱敏；真实64MiB流式摘要及事件循环心跳；活跃取消后释放句柄；32等待预算/排队取消；启动失败不替换未知数据。首次两个夹具测试失败因测试脚本只编译.test.ts，已修复为全部测试源参与编译、仅.test.ts执行。

`pnpm check`：typecheck/lint/56项测试/build通过。core行100%、分支98.85%、函数100%为core范围，不声称是worker层覆盖率。[check.log](check.log)仅去除行尾空白。

`pnpm test:workers-runtime`在实际Electron45.0.0/Node24.22.0中运行正式dist入口，通过SQLite受理幂等、持久任务在途状态保护、64MiB SHA1/SHA256匹配、主事件循环心跳、真实哈希进度、活跃取消/join与Windows文件句柄释放。完整数值见[electron-runtime.json](electron-runtime.json)，exitCode=0。运行器只在独立临时目录工作并于子进程退出后清理，无玩家数据/系统权限变更。

这是正式worker模块在实际Electron中的运行验证，不是主应用UI已开放业务。哈希取消用线程终止，哈希只读无提交副作用；存储调用超时不被当成取消。进程崩溃遗留owner仍安全阻塞，跨进程恢复接管/实例文件事务未完成；解压worker、ObjectStore、网络及实际渲染IPC/UI未接入，A1-04a/c均不标整体完成。没有声称游戏启动或UI FPS已验证，原阶段0缺项保留。

下一步A1-04b对象本体与来源证明/可重建索引，随后可信下载和剩余服务装配。完整目标保持进行中。
