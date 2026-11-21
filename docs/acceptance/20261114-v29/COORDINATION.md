# v29 · 统一复核与最小整改调度

2026-11-14。用户“继续”后实查五小时额度已刷新，已用1%、剩99%时恢复。main基线262d757，产品fab0ac8，仍干净。旧报告和失败物证不修改。

## 协调者源码复核

- A-01：ObjectStore.open以wx写UUID，close正常unlink；OwnerGuard只保护独立metadata目录，两者未绑定。静态机制缺口确认，尚等隔离服务层退出复现，不等同最终EXE强杀。DECISIONS 2026-11-01明确批准必要所有者租约及相关存储/安全基线调整，同时禁止接管未知旧锁；本轮复现/设计沿该既有批准，实施仍须先复核具体设计。
- A-02：InstallerService.resources的runtime被拒Promise在完成失败清理后未清缓存，静态确认；待A-01第一增量完成再安排独立重试验证，不混入锁格式修复。
- B-01：TaskObserverPool固定slice(0,8)与计划公平轮换要求不符，静态确认；派发确定性原样失败→最小调度候选。
- B-02：readModTargets在整个readModTargetAdmissions之后才检查预算，SQLite多记录遍历内无deadline，静态确认；等待B-01后安排第二增量，保持TIMEOUT与worker可继续服务语义。
- C-01/C-02：问题行采用首非空ID导致不同缺失对象均显示依赖方，与v26截图相符；cancel成功采纳新snapshot未清旧error，风险路径确认但后者待确定性组件复现。派同一只读面板最小展示/观察告警修复。
- D-01：LaunchService异常处理先await save，再状态转移；连续get/save失败会越过转移，finally删除job，initialize仅处理会话running/stopping。属于应继续验证的连续失联风险；不声称已实测或已确定全部修法。
- D-02：GameAdapter优先session reason、LaunchControls优先snapshot.error文案，恢复state会被普通根因覆盖，静态确认；派正式adapter与组件局部复现/候选。
- D-03：降为既有快照限制/设计完整性说明，不单独认定新增启动安全缺陷。P-D PLAN第50行明确历史报告仅是当时观察、启动重新复核、不持久扩展报告；IMPLEMENTATION第7–8行说明统一候选规则与本次锁内准确版本。LaunchService以本次java.version重新inspectLaunchMods，GameProcessService两次核对同executable、major、architecture和expectedVersion，之后使用同runtime.executable启动。原报告关于历史检查可能依据另一候选的描述可成立，但不能由此推出复用旧satisfied或放行不兼容JVM。公开身份展示/持久报告绑定不在本轮修复范围。

## 已实际派发

| 聊天 | 单一增量 | 独占位置 | 当前状态 |
| --- | --- | --- | --- |
| A原聊天 | A-01正式实现隔离复现及安全租约设计，不实施生产修复 | D:/MC_start/OUCL-review-round-20261114/P-A/verification/a01 | 已运行 |
| B原聊天 | B-01九活动任务公平准入、保留8详情/2并发/500ms/退订与generation | D:/MC_start/OUCL-review-round-20261114/P-B/verification/b01 | 已运行 |
| C原聊天 | C-01/C-02明确依赖双方/项目版本及终态成功清旧观察错误 | D:/MC_start/OUCL-review-round-20261114/P-C/verification/c01-c02 | 已运行 |
| D原聊天 | D-02正式adapter与启动提示恢复优先，无新DTO | D:/MC_start/OUCL-review-round-20261114/P-D/verification/d02 | 已运行 |

各聊天必须先保留原样失败证据再做最小候选，不能改稳定main/C隔离Git/活跃WIP/旧冻结副本。不GUI、不操作旧锁、不提交Git、不下派子任务或新自动化；本聊天回收实际文件与命令、检查diff和测试后统一整合。

A-01仅允许新临时根的受控Node子进程自行退出、不调用close，观察OS句柄释放及普通锁文件保留；不是CUA最终EXE强杀补证，不shell终止任何旧进程。新锁安全修复不能只凭metadata锁可取而删除对象锁。

## 统一验证副本

新非Git副本D:/MC_start/OUCL-remediation-20261114-r1从稳定main精确选取487文件，两次读取SHA相符，清单在acceptance-results/source-manifest.json。旧v3/v11冻结副本保持原样。node_modules仅链接现有v11工具链，不安装或修改依赖；首次链接权限拒绝后经工具批准创建，不涉及玩家资料或生产修改。候选返回后只复制获审的文件，在新副本运行实际局部/类型/lint/完整检查/构建，再决定精确同步隔离Git和main。

整体IN_PROGRESS。尚未接纳任何新生产修复，未推送或发布；额度仍按既定20%/10%门槛执行。下一结果追加独立版本报告，不能把本页调度当作验证通过。
