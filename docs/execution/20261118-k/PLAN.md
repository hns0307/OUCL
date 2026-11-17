# 方案A K：任务终态落盘

G2，J f3c7fc9c已完整979项975PASS/0FAIL/4SKIP及type/lint/build0。本片新增纯task-settlement reducer与main-owned DistributionTaskSettlementService，不改schema/公共契约/依赖，不接生产执行。

固定root、严格durable admission/完整投影绑定；首次有启动证据的running/needsRecovery亲自H，committed→completed、rolledBack→failed，不能编造cancelled。CAS仅state/revision，未知ack只精确读回同次目标，不重写/执行/claim。已settled分支校稳定journal及绑定，不要求当前receipt，避免后续合法发行推进使历史任务降级。

服务单飞、有界metadata队列，close只停新调用并排空，不取消未知CAS或关闭共享store。错误task身份不得永久毒化正确回执；非精确CAS冲突、queued/attempt0、证据缺失不写。真实J/native+任务worker证明结果，恶意端口注入另标。

实现代理独占两个新模块，测试代理独占新test/helper，review只读；主协调文档/全检。专注真实settle/重试、update后丢ack、回滚failed、后续receipt推进、拒绝/close排空，再运行实际全test/type/lint/build。任务进度/取消/恢复/观察、backend/facade/UI仍后续，source/key/站点空，不push/替换EXE。
