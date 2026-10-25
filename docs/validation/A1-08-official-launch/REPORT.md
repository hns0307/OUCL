# 源码服务真实游戏启动

`node scripts/verify-game-launch.mjs <此前已验证可信的java.exe>`使用实际官方安装记录与原始元数据，StorageClient重开、JSON提交点比对、66项启动依赖重新校验、官方native重新解压到隔离workspace并逐文件比对既有树，然后纯LaunchPlan→JavaProbe→gameDir锁→实际spawn。实际运行Minecraft1.20.1与本机Oracle17.0.12/x64；无shell，不改系统环境。

Computer Use实际观察欢迎页和完整主菜单（Singleplayer/Multiplayer/Realms/Options/Quit Game及1.20.1版本），保存[menu.png](menu.png)及[menu-observation.json](menu-observation.json)。进程服务观察identity-bound、renderer-initializing、sound-ready、blocks-atlas-ready。里程碑不等于世界通过；主菜单结论来自窗口截图。检测到用户手动输入后停止继续键鼠操作，未自动建世界或强停游戏。

official-launch.json由仍在运行的验证进程写入，RUNNING/spawnObserved不等于整体PASS；其中menuVisuallyVerified是脚本自身无法进行的视觉判断，独立视觉结果见menu-observation.json。退出时脚本会记录实际退出状态/码并关闭存储与worker；游戏仍运行时不删除gameDir锁、不结束拥有者进程。尚未验证世界、自然退出、再次启动或exe默认入口。测试账号OUCL_Test1及UUID仅是显式验证夹具，未写生产账户。

失败记录：首次在旧验证日志重开遇worker OOM（已在官方安装报告独立复现/修正）；新独立实例的预检脚本最初错误调用prepareInstanceNatives参数，在spawn前返回ERR_INVALID_ARG_TYPE，现改用正式archive输入与versionDirectory后通过。没有将失败冒充游戏启动。生产离线策略获用户后续明确批准，具体见DECISIONS；不将测试夹具UUID写成生产生成规则。
