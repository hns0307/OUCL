# 阶段1A启动参数与进程服务

本增量落实既定LaunchPlan与gameDir排他方向，不增加公开IPC或第三方依赖。`planOfflineLaunch`为纯函数，输入已解析版本、GameLayout、相对classpath、受信Java引用和已验证离线身份，返回executableRef/args/cwd/redactedPreview。Java必须匹配所需8/17/21与x64；内存为候选512–65536MiB整数，实际可用物理内存仍需上层验证。官方条件参数已由版本解析器选择；现代JVM参数保留，旧版补classpath与natives。客户端jar采用实际继承位置，路径绝对化、Windows分隔符、参数数组保持值完整，不经shell。

拒绝内存/JVM重复、未知占位符、无资产标识、过量/控制字符参数与超Windows命令行预算。离线accessToken为0、user_type为legacy，不代表正版认证。预览替换身份/凭证和本地路径，真实参数不写日志；纯函数不决定账户UUID策略或向上游查询身份。

`GameProcessService.launch`只由可信主进程调用：调用方先解析Java引用并复核依赖；服务重新探测明确选择的java.exe并验证版本，规范化gameDir，以wx创建oucl.session.lock并fsync随机所有者标记。相同gameDir互斥，不按实例名、PID或时间抢占。spawn数组、shell:false、隐藏控制台、剥离Java options及CLASSPATH环境注入；只有收到spawn事件才返回running。spawn失败等实际close再释放自己标记，未知标记不删除。

取消仅适用于spawn前；spawn后必须操作明确session。实际close后才能发布exited并释放原目录锁；锁已改动则unknown并保留，禁止依靠PID强行接管。Windows暂无可靠graceful实现，明确返回STOP_UNSUPPORTED，绝不自动转强杀。force要求confirmed:true，实际等待close后返回。会话摘要无PID/路径；服务只存有界固定游戏里程碑，不返回或持久化原始stdout/stderr、用户名、设备或凭证。

6项进程测试使用真实临时目录和进程替身，覆盖固定参数、环境清洗、外来占用、同步/异步spawn失败、强停确认和所有权变化；5项参数测试覆盖新旧规则、虚拟资产、继承jar、空格路径、错误/限额与脱敏。完整233项检查见官方安装验证check.log。真实1.20.1+本机Java17已复核66项启动依赖及native树并出现实际游戏主菜单，见A1-08-official-launch/menu.png。该证据仍是源码服务，不是exe或产品启动UI；生产账号/Java注册、任务与会话IPC、应用退出保活等尚待接线。
