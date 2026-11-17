# 方案A I：首次事务绑定原目录

G2，从55fa9a35继续已批准A；启动实测primary剩21%，本片后不启动新实现。新增内部transaction.commitFreshBound(plan,expectedRoot,signal?)，复用原commit主体；强制提供主进程文件factory，strict且detached DirectoryProof，任何已有journal均NEEDS_RECOVERY，不复用legacy终态早返。第一次factory即传原目录proof，initialize后复核实际identity。

这是受信内部文件原语，不授执行许可；后继executeAdmitted必须先durable admission/projection/原快照/发行许可/idle复验并亲自取得G本次成功claim，再调用此入口。不能传boolean或用running读回补许可。

范围：transaction.ts、新独立真实native代表测试及证据；source代理独占源、test代理独占新测试、review只读。legacy commit保持原行为，不增公共契约/schema/依赖，不改产品backend。真实配置仍空。

验证正确目录一次提交/重复拒、错proof无发布、缺factory和既有journal先拒、proof参数快照、既有取消回归，随后实际全test/type/lint/build，独占目录。按额度收齐已启动检查，不预记通过，不push/覆盖EXE。
