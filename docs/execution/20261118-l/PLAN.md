# 方案A L：root-owned执行与终态编排

G2，从e9d84204/K 5b842e5b完整986项982PASS/0FAIL/4SKIP及type/lint/build0继续。额度独立监测恢复后主协调实测primary1%已用；A持续明确批准，无需重问同义批准。source/key/站点继续空。

新增内部DistributionExecutionRunner及独立测试，不改J/K底层、公共IPC/schema/依赖。固定root、真实admission/完整投影绑定；单个root job在首await前占位，持有至J→K与最终任务读回结束。同身份singleflight，其他job拒busy，seen最多1024轻身份，错误task不毒化正确身份。

仅pristine queued允许本人调用J；已completed/failed直接K history，running/needsRecovery也只尝试K有据收敛，不重演。J成功后K真实落盘才返回StoredTask。J失败后若K证明真实completed可返回该结果；真实rolledBack落failed则保留原可信typed错误；无证据必须读回当前状态，unknown claim/partial/running无journal保持NEEDS，实际仍pristine queued才保留preclaim source/idle等错误，不reset queued/重claim。

cancel仅active job，不宣称持久queued取消；J阶段交实际事务门禁，K阶段不取消CAS。close同步停新、请求可撤销J停止并drain完整job，不提前关闭共享coordinator/settlement/store。必须由main受审装配独占该root执行入口，不能把局部mutex说成系统锁；本片不自动startup执行或新建持久队列。

实现代理独占runner.ts，测试代理独占新test/helper，review只读；主协调计划、整合、全检。验证真实J/native→K完成、历史新receipt绕J、held K独占、真实取消回滚failed且保留原错、claim未知无文件、关闭J/K排空；合成发行/许可与真实SQLite/native分层记录。先专注后实际全test/type/lint/build，结果不预记。后续任务目标/观察/控制/显式恢复与document facade/UI仍未完成，不广告生产能力、不push/覆盖EXE或原WIP。
