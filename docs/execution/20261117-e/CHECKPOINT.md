# A持续实施恢复点

已保存：B41120eed双库对账（915/911PASS）；C46197ef9公共transport/preload/main doc owners/no-port（937/933PASS）且独立execution-20261117-c候选11文件/73runtime/真实outer26检查、正常退出锁释放；D958aa363内部ticket（944/940PASS）；E旧回执alias原语随本恢复点精确保存。最新945项941PASS/0FAIL/4既有SKIP，type/全lint/build0，证据在本目录。

primary实测92%已用，剩8%触发保存停止；已有独立监测够高后继续，无需重复批准A，不使用reset或购买，不按weekly停止。原WIP/tmp/正式EXE不清理覆盖，不push。

下一可验证增量：实现main-owned持久确认服务，用Coordinator.ticket+store.admissions.admit或bindReceiptAlias+Reconciler返回同task真实snapshot；已确认原request回执只读恢复，不重跑prepare。bindReceiptAlias只绑定既有匹配root/digest，解决highwater前进后回执查询，不能授执行。确认接纳点前后取消/响应超时必须明确且按原ID恢复。

接着实现持久distribution-install执行/target/控制/恢复服务及document facade：执行从durable admission和projection核原previewFingerprint/gameIdentity/实例revision、当前accepted release/keys/time/领域/许可/idle，必须protected native factory。无journal不得盲重放；终态receipt读回不重复写；部分journal needsRecovery明确恢复。不能把ticket、alias、projected或transport重派当执行授权。

再接UI确认、任务结果/target观察及configured完整内链E2E，复用现有全局pool预算。C生产仍new Adapter()无port，合法五方法SOURCE_UNAVAILABLE/握手不广告execute；真实source/key/locator/许可政策空且mods外domain unsupported，未齐不能开产品。D/NEXT-SERVICE.md更详路线的alias原语现已由E提供，其余服务未实现。

候选C是其当时构建快照，不冒称包含D/E内部增量或真实分发验收。历史取消补证不重启，原始失败/夹具问题/有限测试层级均保留。
