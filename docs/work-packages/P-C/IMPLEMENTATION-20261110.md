# P-C 开始实施记录 · 2026-11-10

用户在本聊天已交付方案后回复“开始”。本次执行首个可验证增量 V2a 的纯计算底座，随后按依赖推进。V2a 产品入口及 V2b 文件启停尚未交付；新发现的存储兼容变更单独列出，不将该指令扩大到新方案批准。

遵循最初分包协作限制，仅维护本包新文件及独立新增 core/test 文件；共享 TASK_PLAN/DECISIONS、worker、UI、锁、依赖和分支不修改。本记录保存本聊天直接指令，供汇总者更新审批索引；不把其他聊天修改当本包成果。

## 本增量

- 新增 `src/core/mods/maintenance-impact.ts`，输入同一库存的本地/平台事实，输出启停前后双重检查、增减问题、整根JAR全部provider、直接与传递反向依赖；无IO。
- 不接受本地/平台激活状态不一致、重复文件ID或超过256根文件；512关系上限触达时显式truncated，不能ready。依赖关系表示结构关联，是否兼容由原检查器判断；不据图自动批量禁用。
- 多声明、别名、嵌套声明在预览中完整计算；这不解除V2b首版的单声明受管限制。未知来源/未知版本/既有损坏保守阻止。core输出为内部完整诊断，不是已批准公开IPC投影，未来公开512项上限需在投影层整体检查。
- fileId仍只是快照定位符；本函数不验证摘要、来源所有权、文件身份或运行占用，不产生文件执行授权。
- 新增10项单测。验证脚本 `verify-v2a.mjs` 将仓库同样的TypeScript编译/Node测试覆盖率阈值及Vite/esbuild产物写入本包 `evidence/v2a/`，测试进程工作目录也独立，避免公共 `.test-build` 与 `dist`。

## V2b 新发现：不能复用 modCommitId

当前工作树 `services/install/installer.ts:prepareLaunch` 根据modCommitId读取旧mod-txn；`services/install/launch-inputs.ts:matchesLaunchProjection` 要求该事务committed、taskId匹配、instanceRevision+1等于当前修订、afterInstanceDigest匹配当前实例。PLAN §4.3 中“复用modCommitId作维护提交点”的候选在此不兼容，**停止采用**。这不是游戏实测故障，只是精确源码约束。相关共享源码已有其他聊天修改，本包未改。

### 可审阅修订（PENDING，取代上述候选）

推荐方案A：保留modCommitId的原新增安装语义，InstanceRecord v2增加可选UUID字段 `modMaintenanceCommitId`，仅ready且非vanilla记录允许；原无字段记录读取不变。维护提交只改修订和该字段，不覆盖modCommitId。恢复日志增加不可变 `beforeMaintenanceCommitId: UUID|null`，继续保存beforeModCommitId及before/afterInstanceDigest。before/after修订严格相邻；维护taskId/operationId统一为同一UUID，减少两套提交身份歧义。

启动读取最近安装及最近维护两份回执，根据当前实例摘要和修订选择唯一最新提交证明：

1. 安装候选必须满足原committed/taskId/root/instance/afterDigest/instanceRevision+1规则。
2. 维护候选必须committed，operationId=modMaintenanceCommitId、root/instance一致、afterRevision=当前修订、afterDigest=当前实例摘要。
3. 两者都不匹配或同时声称同一修订时拒绝，不能按“时间较晚”猜。未新增维护字段的旧记录仍走原路径。
4. 校验安装投影不变时，只排除明确允许变化的summary.revision、modCommitId和modMaintenanceCommitId，其他环境、对象、路径、来源必须深相等；不忽略任意字段。
5. 后续新增Mod安装保留modMaintenanceCommitId，用原modCommitId保存新安装证明；其新afterDigest覆盖包含维护字段的实例。之后维护保留新modCommitId。同一revision仍只允许一笔CAS提交。
6. 维护归属解析沿前驱回执核对根、实例、三摘要及入口状态；环/缺失/未知版本停写。启动证明只核对最新提交和静态投影，不把此检查宣传为整个Mod目录完整性验证。

涉及具体文件：storage/instance-records.ts精确schema、storage/mod-maintenance.ts及worker白名单、mods/maintenance-transaction.ts、install/installer.ts读取双证明、install/launch-inputs.ts验证、对应schema/投影/交错测试。无SQL表或运行库新增。由P-D与本包串行协调两处启动文件，不抢改。

备选方案B：维护同时重写安装投影，以新revision使实例与投影相等。这会增加一个文件提交点和恢复顺序，扩大写入面；不推荐，也不能未经设计直接操作投影。

方案A新增实例字段与启动证明语义超出原“若不兼容另提schema”的占位方向；按AGENTS G2需用户明确批准该具体修订后实施。批准前可继续V2a只读层和独立文件原语验证，不实现维护提交。

## 验证状态

实际结果见[验证报告](REPORT-20261110.md)：局部10项通过、原语3项通过，完整回归394PASS/189FAIL/1CANCELLED/1SKIP，隔离构建通过。当前仅证明内部纯计算，不证明IPC/UI、Windows文件恢复、Electron或真实游戏通过。
