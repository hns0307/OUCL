# 任务终态落盘K结果

新增纯settleDistributionExecution及main-owned DistributionTaskSettlementService，首次读取真实projected admission/完整任务绑定并亲自H，attempt1且running/needsRecovery、revision>=2才能CAS收敛；committed→completed、rolledBack→failed，只改state/revision。已有completed/failed须revision>=3且稳定journal/原绑定一致，不读当前receipt，避免后继合法更新误降级。未编造取消原因或执行新文件。

同proposal/task singleflight，不同proposal最多16并发，seen最多1024轻身份；wrongtask在记录验证前不加seen。close停新并drain，不取消未知CAS/关闭共享store。未知CAS结果只原身份精确目标读回，不第二次写、不重执行/claim。

最终专注真实7PASS/0FAIL/0SKIP，11474.4579ms，含真实J/native→settle、CAS commit后丢ack、实际rollback→failed、后继receipt推进旧终态不读current、错误绑定/queued、实际竞争CAS及held CAS关闭排空；原首轮7PASS保留。测试/合成政策层级见test-evidence/SETTLEMENT.md。

最终完整986项982PASS/0FAIL/4既有SKIP，61293.9572ms；type/全lint/build均exit0。checks-evidence及run-checks.mjs保存命令、原始日志和退出码。独立只读审查有限认可；core SHA2ea7756e0cfb7ad0d101b9556ae734c3fa1f276b82d3ad769e7856543acfd0fe，service f9b55aa971132c87bfd43551c5b70aace1de6f4da5cf1f8c4e09d59a16b7d9d9。

限制：首次settle晚于后继receipt推进时H仍保守拒，root执行调度应将J→K作为同一受管job及时完成；本片没有自动执行队列或公共接线。任务领域结果/错误、queued取消、显式恢复、观察/目标及UI仍后继。source/key/站点空，productionno-port不广告；不push/覆盖正式EXE，原WIP/tmp保留。
