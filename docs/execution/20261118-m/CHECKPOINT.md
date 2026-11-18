# A持续恢复点M

本轮L d02634b8 root-owned J→K编排完整992项988PASS/0FAIL/4SKIP；M passive provider完整999项995PASS/0FAIL/4SKIP及type/全lint/build0，真实专项7PASS。M源码/原始证据见REPORT.md。原tmp未跟踪保留，无其他源码WIP。

下一N可按已批准A具体item1接任务目标公共kind和受控观察路由，无需重问同义批准：现TargetKind仅mod-check/mod-install；扩distribution-install及query最多3种，保持其余版本/limit/timeout/全局pool与cursor预算，不因第三域扩大快照容量。新增kind是A明确批准的task-target schema扩展，先记录精确设计/测试，再改契约。

TargetAdapter可新增optional main-owned distribution reader，生产缺provider时涉及distribution查询应明确UNAVAILABLE，不能返回伪空/部分成功；混合查询先验证可用性。旧mod kinds仍进原worker；收窄ModTargetsInput为真正mod-only子集，runtime parser保持不接distribution命令，不能将新kind落进旧worker被静默遗漏。distribution reader须固定root与真实M provider scope一致；组合DTO严格校instance/revision/kind、重复task和既有总预算，复用现有cursor/filter/sender生命周期，不另建无界cache。此步骤仍不广告execute或注入假source。

后继再将M get/list加入root任务观察get/list/subscribe，接受控结果/错误、持久queued取消、恢复请求幂等，再装document facade/backend/UI。root owner必须独占L执行入口；J→K同job不能被其他直接writer绕过。document revoke只撤未确认prepare，已进入confirm元数据链须root持续、原ID恢复，不能早关global store。现M ready必须由实际startup reconciliation barrier提供，不可Promise.resolve冒审计。

point仍全库审计16MiB，不称性能已优化或硬实时；后续若优化须保持owner/被选绑定与全局审计语义并给实测。M已settled/history只读状态，不会因查询触发文件写；任务完成仅权威metadata结果，不等于游戏菜单验收。source/key/locator/许可政策/站点仍空，production五通道no-port且不广告execute。C候选仅C时快照，不冒称包含L/M；无push/正式EXE覆盖。

primary低于20%不启新实现，10%及以下保存并仅收齐已启动检查，够高继续A不重批；不使用reset/购买、不按weekly阈值停止。恢复先核真实额度和仓库现状。

2026-11-18本窗口保存：L d02634b8与M 3a30d1b3均已真实full验证，最新999项995PASS/0FAIL/4SKIP及type/全lint/build0。主协调实测primary85%已用/15%剩，按低于20%不启新增量保存，无待跑检查或源码WIP，只有原tmp未跟踪保留。停止依据仅primary规则，不按weekly作停止阈值；下一N按本页继续，A持续有效，无需重批。
