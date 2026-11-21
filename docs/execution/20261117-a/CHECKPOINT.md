# 方案A已批准的恢复点

基线f825b8bb，本片基础与证据随本记录精确保存，提交号见Git。完整893项889PASS/0FAIL/4既有SKIP，type/全lint/build通过。primary91%已用、9%剩余触发保存；恢复够高后继续已批准A，不再问同义许可。

首步：新公共契约Accepted/Recovery snapshot.kind应收紧为distribution-install；当前guard仍通用TaskSnapshot，接线前补正/反例。然后对本片admission/schema2/固定投影做独立有限复核，所有原始日志/源码SHA在本目录。

下一可验证增量：增加有界读取已投影distribution tasks/admissions的API，双向对账服务（admission→同taskId投影→markProjected，ack丢失读回，孤儿/绑定冲突needsRecovery）。不能调用generic accept生成新ID，不能把projected当已执行。worker必须校验expectedRootId与当前实际installation rootId，owner始终从存储派生。现未新增可选list query或双库协调器，不能预记通过。

再后：接5个严格public IPC/preload/handshake能力门禁、prepare有限后台任务与document生命周期、confirm持久接纳、distribution-install任务执行/target观察/cancel/recover/UI确认；每步局部及实际存在全检查。恢复无确认不投影、无journal不重放写文件。

真实站点/source/key仍空，源/许可/领域条件不齐时执行能力不广告，禁用入口。现有内部mod gate仅顶层mods，其他区域unsupported保持。A批准不授权虚构真实API/许可证或绕过native工厂。旧正式EXE/原mod_loaders WIP/未跟踪tmp均保留，无push。
