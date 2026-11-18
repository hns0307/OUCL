# 方案A M：被动任务视图与目标

G2，从L d02634b8完整992项988PASS/0FAIL/4SKIP及type/lint/build0继续A。新增内部DistributionTaskViewProvider，get/list/targets只读真实任务及归属，不执行、结算、修复或恢复，不改公共TargetKind/main路由/worker协议/schema/依赖。

新增AdmissionRepository.readByTask使用既有unique task_id索引映射，但保留owner verify与全库validateStored，不宣称已优化16MiB审计。get核admission、任务与request双侧；list/targets先完整有界集合/孤儿校验，再按实例筛选，不用过滤隐藏损坏。ready等待真实启动对账barrier，失败不伪空；known accepted/outbox在途明确UNAVAILABLE，projected缺失或孤儿NEEDS_RECOVERY。

固定root，读真实installation/instance注册metadata并复核scope/revision，targets不接受调用者自证revision。目标行保留admission原instanceRevision历史绑定；get/list可保留已删除实例历史，targets缺真实实例则OUT_OF_SCOPE。Snapshot直接来自execution，仅DTO允许字段，不编造旧错误/许可详情或临时篡改状态。

同task get单飞最多8，list/targets共享inflight有界inventory，close停新并drain读，不能把超时当作实际读已停止。实现代理独占admission-record.ts和新task-views.ts，测试代理独占新test/helper，review只读；主协调文档和全检。验证真实queued/完成视图、归属/孤儿/在途拒绝、startup和scope变更/并发/关闭；注册实例元数据夹具不等于真实游戏安装，合成策略分层记录。先专注后实际全test/type/lint/build，不预记结果。

后继再按已批准A接任务中心/目标公共kind及路由、控制/结果/恢复和document facade/UI；source/key/站点继续空，productionno-port不广告，不push/替换正式EXE或原WIP。
