# v32 接续

先检查额度，低于20%不新开，工作中10%及以下保存等待。源代码及完整回归见v31（691项687PASS/4SKIP、类型lintbuild及专项通过）；本版仅新EXE/热运行时/合成离线档案正常关闭重开，未观测数值exit码，不含MC游戏和对象库使用。

新包SHA ba24713708030ba8b96a65858305fb4593d6e3fb0b2afc0ef83e6a4258904be7；候选原件在D:/MC_start/OUCL-remediation-20261114-r1/release，独占GUI副本在D:/MC_start/OUCL-acceptance-exe-v32-20261114；PID17828、2424窗口都已关闭，不操作旧目标。正式StorageClient读后close，metadata owner标记不存在。旧v11EXE不覆盖。

下一v33做修复后新包的代表旧资料/真实游戏正常路径。参考v11 GAME-PREPARATION和v12，但先检查源冻结及新的正式恢复要求，不手工改ready、不删未知锁、不沿链接修改旧玩家数据。GUI仅本聊天。A强杀产品恢复继续DEFERRED，C公网取消/非主frame等不以本版覆盖。A–E已回交等待，无需重建聊天或重跑不变的全量回归。不push发布，共享活跃树不整体暂存或清理。
