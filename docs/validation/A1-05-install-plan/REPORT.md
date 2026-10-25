# A1-05安装准备、共享消费者与哈希会话

本增量恢复后整合了暂停时保留的改动：core/install、来源字段、InstallMetadataService、DownloadCoordinator、ObjectStore.adopt及持久HashPool。无新依赖、公开IPC或磁盘schema，具体约定见[INSTALL_FOUNDATION](../../contracts/INSTALL_FOUNDATION.md)。最终目标现在明确为可运行exe中的下载和启动，尚未达到。

`pnpm check`退出0：144测试142 PASS / 0 FAIL / 2既有环境SKIP，typecheck/lint/build通过。[check.log](check.log)只规范行尾空白；core行100%、分支98.98%、函数100%，不等于服务/UI覆盖率。

新增关键验证：库/索引真实父来源；资产名、大小写/路径/摘要冲突；新旧Maven及native输入、virtual资源入口和多proof去重；原资产正文精确保留与大小/hash拒绝；A取消不影响B、全部暂停/join再恢复、最后取消后的新需求、队列/并发预算、独立proof与关闭收尾；取消不能掩盖持久化/证明故障；40个小文件只创建1个hash worker、取消后换线程、旧job回复隔离及文件句柄释放。还覆盖ESLint纯core/path导入与真实Node/UI模块禁入，未放松分层。

真实官方准备验证`node scripts/verify-install-plan.mjs`（先pnpm test生成.test-build），完整结果见[official-plans.json](official-plans.json)：

| 版本 | 资产对象逻辑数 | 去重制品数 | Windows x64 native归档 | Java需求 |
| --- | --- | --- | --- | --- |
| 1.21.1 | 3911 | 3960 | 8 | 21 |
| 1.20.1 | 3598 | 3641 | 7 | 17 |
| 1.12.2 | 1305 | 1323 | 2 | 8 |
| 1.6.4 | 1120 | 613 | 1 | 8 |

全部描述和索引经真实官方信任链校验。旧1.6.4的虚拟视图1733项有计划，别名仍去重，不是丢资源。每个gameDownloaded/gameLaunched均false，本轮只生成计划，不把逻辑字节数当真实传输。现代metadata列有多架构native，本轮已明确仅把x64纳入解压计划，防止覆盖不兼容DLL。

`pnpm test:workers-runtime`：实际Electron45/Node24.22正式worker通过原存储/64MiB哈希/续传，对共享消费者取消隔离和独立proof追加的验证亦通过，整个测试仅创建2个hash线程（包含一次主动取消后的替换），见[electron-runtime.json](electron-runtime.json)。旧历史报告未覆盖。此为fixture字节的正式服务运行，不是游戏已安装。

两项SKIP仍是文件软链接权限和Windows拒绝替换打开SQLite的实际路径；确定性身份适配器测试照常通过，不修改系统策略。没有新增失败被略过。

未完成：consumer与安装任务的持久关联、tasks:*与进度订阅、批量执行器和原索引导入、受管链接/复制物化、安全解压、Java管理、离线档案、游戏进程和实际安装/启动UI，以及新exe打包实测。旧release目录仍工程骨架，不能当最终exe。目标继续进行中。
