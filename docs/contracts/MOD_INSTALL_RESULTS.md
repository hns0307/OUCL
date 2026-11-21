# 安装结果持久记录

私有固定`mod-result-<taskUUID>`记录，formatVersion1，最多2MiB。绑定root/task/planRequestId/planId/instance及原修订，保存completed/failed/cancelled/needsRecovery、受控ModCode及可选既有ModReport投影。不保存异常原文、命令、任意路径或完整私有metadata；下载来源和依赖链仍在不可变计划中。

worker get/set严格校验；set重查既有确认任务与计划的完整绑定，assessment必须对应原修订/指纹/check模式。终态不可改写，只有needsRecovery可解析为最终结果；未知格式停写，原子JSON和既有日志负责恢复，不新增SQL表或依赖。

执行器在最终SQLite状态前保存结果；丢失应答只认逐字段相同的已保存内容。准备阶段ModPreparationError的本地/平台问题经既有受控报告投影持久化。重开有失败/取消结果而没有事务时可修正尚未完成的任务状态，不重新下载。完成结果仍须对应committed事务，孤立确认保持needsRecovery。

仍未开放公共结果查询/确认UI，也未在main装配安装执行器。公开接入时必须重新验证当前root/任务/计划身份，不能直接暴露内部错误或私有来源。
