# core

已批准的纯逻辑层，不导入Electron、UI或真实IO。阶段1A已明确授权，首个模块为version：验证上游client元数据、解析继承与规则、合并库与选择natives、整理新旧参数。输入来源信任及实际文件/网络/进程由后续services负责，解析成功不代表游戏可启动。

path/layout负责Windows受管布局、身份分离、隔离优先级、绝对classpath、对象位置和受保护删除计划。它不检查真实文件系统，不能代替主进程的路径/链接验证与锁。
