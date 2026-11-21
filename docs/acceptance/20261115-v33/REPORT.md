# v33：新 EXE 的三实例真实游戏正常路径

2026-11-15（Asia/Shanghai）。修复后的v32最终EXE已实际启动原版1.20.1、Fabric0.20.1/FerriteCore6.0.1及Quilt0.29.2，三次分别进入真实主菜单并用游戏内Quit Game自然退出0。只闭合本版所列正常路径；启动器正常关闭/重开复验仍待补证，整体IN_PROGRESS。

产品代码0c2a889ccea544d3294136a80c74ac8a5e6f348f；前置统一检查v31为691项687PASS/0FAIL/4既有SKIP、类型/全lint/build通过。EXE410112字节，SHA256 `ba24713708030ba8b96a65858305fb4593d6e3fb0b2afc0ef83e6a4258904be7`，实际提取七产物仍与v32及r3构建一致。不是冷下载、数字签名或发布，没有生产改动和无变化全量重跑。

## 独立资料与预检

A专项只写D:/MC_start/OUCL-acceptance-v33-20261114/game-data及其独占准备报告。来源PA-clone只读；源21任务/21请求/640条COMMITTED操作、18 JSON提交摘要链确认，无活动任务/所有者标记。SQLite用只读官方backup，不复制旧guard/锁、objectindex/transfers、saves/logs。15387文件/1881117097字节逐文件复制前后源SHA与目标一致，源链接仅在批准边界内物化，目标普通文件nlink1。

使用0c2a889c的full-r3编译正式服务和最终dist worker，正式API记录installation重绑，7302来源证明实际rebuildIndex，复制Java17.0.15由ProfileService实测；三实例正式prepare/verify/inspect各18 natives、local satisfied。准备不冒充游戏。root另核15份交付摘要并执行原未运行的audit.mjs：exit0、15409文件/4628目录、无链接/多链接/残留锁，历史账本及源18JSON不变，双索引和七产物通过。游戏后root独立审计再次核原资料与实例记录，不重跑prepare或删除副本。

## 本次真实会话

由CUA启动同一v32 EXE并传新profile目录；bootstrap26108派生正式启动器PID3884/HWND262364。Java窗口均只读核对为该PID的新子进程，准确使用独占复制Java，Fabric/Quilt命令行只记录实例匹配布尔值、不保存完整命令行。

| 实例 | 本次sessionId | 开始UTC | 窗口PID/HWND | 结果 |
| --- | --- | --- | --- | --- |
| 原版 | d676efd4-ff58-44c3-9ba5-c7e4d134f630 | 2026-11-15 03:46:29.291 | 31760 / 199728 | 实际菜单、Quit Game、自然exit0 |
| Fabric | 65e357f5-a3cc-495d-a0e8-4507dbe03e77 | 2026-11-15 03:47:54.255 | 38736 / 461894 | Fabric菜单、本次日志FerriteCore6.0.1、Quit Game、自然exit0 |
| Quilt | d0326c8c-517d-4036-a80f-152bf92615cd | 2026-11-15 03:49:50.167 | 34568 / 592532 | Quilt Loader0.29.2菜单、Quit Game、自然exit0 |

三张主菜单截图由统一协调逐张实际查看，菜单不是由日志推断。会话snapshot均exited/revision3/exitCode0、spawned=true、无stop任务；三个真实launch任务均completed。独立只读SQLite审计保留源21历史task，历史session与启动前快照相等，源18JSON和三个实例record不变；双索引SHA1为ada52cc672270e8dc69e912b2ba0ea9c141ed664及2b3aa959237269caa09ac97fc3f7eae651315696。本轮使用原有合成档案OUCLTest16；后台选择新OUCLAV33未应用，不把工具click回执当选择成功。

## 保留的工具与验收限制

首次Quilt选择/启动连续点击没有新接纳，后续实际稳定画面单次点击才开始本表会话；一次后台space被工具拒绝。无产品缺陷推断。系统拒绝激活本轮启动器窗口：账户选择前台尝试、正常关闭菜单/AltF4均foreground_unavailable；标题栏后台像素点击未生效。未操作其他应用、未以shell发关闭或kill绕过。已向用户请求方便时切换到本轮OUCL窗口以完成正常关闭复验。

截至本版冻结，PID3884窗口仍打开、没有游戏运行；metadata和objects所有者标记仍由该进程持有，不删除。只读退出观察器持有该精确进程句柄，exec session83374等待正常退出并拟写game-run/launcher-first-exit.json，当前没有数值启动器退出码。启动器正常关闭/重开及重开后Quilt菜单必须在后继版补证，不能按旧v12结果写通过。

A真正最终EXE强杀恢复仍DEFERRED；C公网pending取消未触发/首早close根因UNKNOWN、正常安全配置不可达非主frame等继续保留。C文件动作、E通用导入安装、D公开Java、新契约/格式/依赖仍排除。未push/发布，未清理或整体暂存活跃共享树。证据由SHA256.json固定，大型复制清单仅记录路径/尺寸/SHA并保留独占目录。
