# 公共执行方案A实施

2026-11-17真实批准：用户先要求讲述方案A，主协调解释独立执行接口、持久任务、双库接纳/outbox与配置空时禁用后，用户明确回复“批准”。本次G2允许按PUBLIC-EXECUTION-PROPOSAL方案A持续小步实现distribution.execute.v1、confirmation admission/outbox、distribution-install任务/对账及受控接线/验证；真实来源、公钥和站点仍空，领域或政策条件未齐不广告/启用执行。后续不为本范围重复索取同义批准，不批量改历史PENDING，不push或替换正式EXE。

当前基础增量：audit_baseline独占store.ts、admission-record.ts、真实admission测试；audit_ui独占distribution-execution.ts公共类型/schema与单测；主协调拥有批准/ADR/计划/公共接线后继；audit_n1只读审查与任务投影地图。基线f825b8bb，原WIP和未跟踪tmp不清理。

新私有schema user_version1→2由同一OwnerGuard下SQLite事务迁移，保留旧发布/journal/receipt。确认intent绑定完整plan、rootinode和真实prepare fingerprint；store内部digest、生成唯一taskId，重复请求/同proposal aliases恢复同回执；新接纳需当前accepted release/highwater匹配，旧精确回执只读恢复不重新授权执行。outbox accepted→projected仅代表任务可观察，不代表文件已执行。

后继按依赖：固定taskId的权威tasks/requests投影和双向对账（实际在RecordStore，非下载checkpoint TransferDatabase）；再public adapter/preload/handshake、受控准备/确认/取消恢复、任务target/观察/控制、UI空配置禁用；完整领域/政策/真实来源未齐不广告execute。不得使用原TaskTable.accept随机新ID投影既定task，不从游戏目录receipt收编。

验证先局部schema/真实SQLite迁移/幂等/冲突/ack丢失/重开outbox，再已有实际type/lint/test/build，独占D根fd日志。无新依赖，固定父目录node工具，不调用会隐式修复依赖的pnpm。仅本地精确提交，无push/正式EXE覆盖。primary<=10%保存后等待既有监测恢复。
