# P-D 独立代码与证据审查

日期：2026-11-14；审查者：原P-D工作包。结论：**已整合的正常代表启动证据可以接纳；以下3项静态风险待协调者决定是否验证及整改，不能将P-D描述为所有异常时序均已闭合。** 无本轮新运行测试或GUI，无生产修改。

## 对象、授权与已读材料

- 只读稳定仓库 `D:/MC_start/OUCL-download-main`：调度时HEAD `26483918cef993266d541e9aacc8249c4ad4c2d4`，产品代码基线 `fab0ac873f34d8581bf065e14fa7a9aa93c0baa3`；后续是管理文档。工作区实际 `git status --short` 为空。只读哈希核对 `release/OUCL-0.3.0-acceptance-20261113-v11.exe` 为 `3d9a0ebaf289a9552933c97033ffbd6a069e0a0258e3ea8322cc2a5ceb6efce6`，与v12报告一致。
- 已核对活跃源 `D:/MC_start/OUCL/OUCL-Codex/docs/TASK_PLAN.md`、`DECISIONS.md`、根 `docs/ACCEPTANCE_HANDOFF_20261111.md`；稳定候选 `docs/acceptance/20261114-v26/REPORT.md`、`CURRENT-CHECKLIST.md`、`HANDOFF.md`；P-D的2026-11-10明确批准及v5/v11/v12报告、原始会话、任务、菜单图片和v12审计。活跃源与稳定候选文档时间线不同，以对应后继记录判断，不把旧P-D“游戏未验”当现状。
- 范围为已批内部准确Java及锁内最终复核。公开有效Java面板、额外持久字段/新IPC未批准；本报告建议不是批准。

## 证据分层

**可接纳（既有证据）**：v11报告的655项中651 PASS、0 FAIL、4 SKIP及类型/lint/build是该冻结集合的历史检查，本轮未复跑。`docs/acceptance/20261112-v5/evidence/d-public-launch-events.json`记录`game:launch`，`d-session-results.json`记录三个新持久会话exited/exitCode0；v5原版及Fabric/FerriteCore产品入口菜单、退出与Fabric重开具代表性，不是完整世界/加载器矩阵。v12 `evidence/game/v12-result.json`记录四个新会话退出0、持久任务及索引审计；两份launcher exit JSON均为0，报告中同EXE七产物逐项比对。本人只读查看v12 Fabric/Quilt两张菜单图，分别可见Fabric 1.20.1与Quilt Loader 0.29.2主菜单；截图不替代会话退出记录。v12是EXE共存，不声称新冷下载、真实强制中断恢复。

**可接纳（静态实现与历史夹具）**：`src/services/java/selection.ts`及 `mods/java-facts.ts:15-22` / `java/runtime.ts:67-88`共用登记候选顺序及8秒预算；`launch/process.ts:53-80`先后对同一exe核对major、x64和完整版本，在唯一`open(wx)`锁后复核；`launch/service.ts:95-119`锁内核对实例、档案、设置、投影、Mod指纹及实际版本约束；unknown/unsatisfied不放行。`tests/installer.test.ts:339-381,385-416`存在真实存储/模拟进程的变化、取消及“写成功再抛TIMEOUT”夹具；`tests/game-process.test.ts:96`等覆盖同major补丁变化和锁释放。历史测试存在/报告通过不等于本轮实际执行或全部超时组合覆盖。

**待补证**：外部进程不遵守gameDir锁、检查与JVM实际打开文件之间的修改窗口；高负载/失联回执链；所有版本、磁盘、玩家数据、自然重开及强制中断矩阵。锁令牌可排除遵循协议的事务，不是操作系统对外部文件的独占；不能把v5/v12正常启动扩展成任意外部编辑安全。

**排除**：旧聊天窗口/旧锁/玩家实例、本轮其他包、未批准公开有效Java面板及新存储/依赖。本轮无GUI、无测试进程、无外网。

## 发现 1 — [P2] 提交许可应答超时叠加查询/保存失联，任务可能长期停在中间态

**代码证据**：`D:/MC_start/OUCL-download-main/src/services/launch/service.ts:165`设置`commitUncertain`，`:175-188`中的`storage.update`失败后仅等待一次`storage.get`并重新抛错；`:153-161`先`await save`再尝试`interrupted`，异常最终删除内存job。`D:/MC_start/OUCL-download-main/src/services/workers/storage-client.ts:102-113,221-227`显示请求超时并不撤销后台写入，查询和任务更新本身也有超时；`src/services/workers/entry.ts:43-46`worker按队列顺序处理。重启初始化 `launch/service.ts:43-49`只把running/stopping会话标unknown，没有扫描并转移未完成的launch任务；`:69-75`对已接纳的非queued原任务只返回原ID，`:221-224`无job时无法取消。

**可构造条件（静态推演，非本轮复现）**：`verified`写入已入worker或已提交但应答超时，紧接着对该任务的get也超时/失败，错误处理中的会话保存也因同一worker阻塞超时。保存的异常会在状态转移之前退出catch，finally删除job；后台原写稍后可能落为committing，或任务仍为verifying。重开后无代码将其自动标为needsRecovery或恢复执行。此序列不是“已经确认的游戏运行/数据损坏”；因为未得到许可，按控制流不会到spawn。影响是任务可持续显示运行/提交但无执行者，既不能按原ID继续也无法正常取消，失去所承诺的保守恢复表达。

**历史测试边界**：`tests/installer.test.ts:403-406`是先await真实update成功再人为抛TIMEOUT，之后get/save可用；它不覆盖get也超时或worker仍阻塞。不能将该用例PASS外推为整个连续失联链已安全收敛。

**建议最小整改**：保持同一owner/task身份，区分“尚未持久确认”与“已知持久状态”，把应答丢失后读取失败及重启扫描纳入可恢复的状态收敛；失败记录写入与interrupted转移不能彼此阻断。对真实进程可能已spawn的情况仍保持unknown和现有锁，不猜PID或删除锁。具体实现、是否需改变契约/存储按原审批门禁评审。

**建议协调者安排的局部验证，未执行**：在其指定独立fixture目录（推荐 `D:/MC_start/OUCL-review-round-20261114/P-D/verification/ack-loss/`）用正式LaunchService+可控存储工作队列，分别覆盖update写成功且回复超时→get失败→save失败、update未提交→get失败、worker恢复/服务重开；断言spawn=0、不得重复接纳、任务最终有可查询needsRecovery/明确不可确认、原锁释放或按所有权保留，不能永久伪装活动。先由协调者确认场景与路径，再运行。

## 发现 2 — [P2] needsRecovery可能被启动区显示为普通可重试错误

**代码证据**：`D:/MC_start/OUCL-download-main/src/services/launch/service.ts:154-159`先保存原错误码，再由`src/core/task/machine.ts:75-83`将committing后的failed变为needsRecovery。`D:/MC_start/OUCL-download-main/src/ipc/game-adapter.ts:23-26`优先投影session原始reason；当state为needsRecovery但reason为REVISION_CONFLICT或LAUNCH_FAILED时，错误仍是该reason及其原retryable属性。`D:/MC_start/OUCL-download-main/src/ui/LaunchControls.tsx:31-37`又优先使用`snapshot.error.messageKey`，因此覆盖`stageRecovery`；`src/shared/contracts/instances.ts:90,94-97`、`src/shared/locales/messages.ts:242,259`表明REVISION_CONFLICT对应“实例信息已改变，请刷新后重试”，而恢复文案要求保留文件。全局任务中心仍可分别列出needsRecovery，不能笼统称所有UI隐藏该状态。

**触发条件（静态路径）**：许可后`recheck`因实例变化抛REVISION_CONFLICT；已有 `tests/installer.test.ts:355-378` 的after-permit服务夹具确认应进入needsRecovery，但未断言GameAdapter的错误投影或启动区文案。用户可能只看到刷新重试，未看到恢复提示；不证明每次重试都会重复spawn或造成损坏。

**建议最小整改**：公开任务state为needsRecovery时，以保留现场/结果不确定的恢复提示与不可普通重试语义为优先；根因可作为不覆盖恢复状态的补充，若要新增公共字段先审批。补充正式GameAdapter投影与LaunchControls展示测试：许可后REVISION_CONFLICT、LAUNCH_FAILED及NEEDS_RECOVERY三类，断言恢复提示可见、不会只呈现普通刷新重试。

## 发现 3 — [P2] 检查与启动仍是两次独立选择，报告不是候选身份绑定

**代码证据**：`D:/MC_start/OUCL-download-main/src/services/mods/java-facts.ts:10-32`只返回`string | null`版本并在当前probe失败时尝试下一登记项；`src/services/mods/context.ts:19-25`只把该字符串放入环境。`src/services/java/runtime.ts:67-88`在启动时重新probe同序候选并选择/登记，必要时还会发现或准备Java；`src/services/launch/service.ts:87-107`对最终选定Java重新扫描并以其版本判定，提供重要的启动防线。共有排序和预算降低之前2秒/8秒差异，但没有把某次已显示检查报告绑定为将启动的同一Java身份。

**可构造条件（静态推演，非当前版本实机复现）**：Java A和B同major、不同patch；检查时A暂时probe失败且B成功，稍后启动时A恢复可用，检查报告曾依据B，而启动复核依据A。若约束对两个patch判断不同，旧报告可显示满足但启动重新评估后拒绝，或者两者相反。相同8秒预算不排除瞬时失败或探测时段不同；现有重新扫描保护意味着不能据此说不兼容Mod必然被启动。

**建议最小整改**：明确检查结果为测量时快照而非启动保证；内部将候选身份、精确版本及档案快照一起绑定，启动若另选候选必须重新评估且不得复用旧报告；对报告失效/实际Java展示若需新增公开字段或持久快照，先冻结并批准。建议确定性夹具在检查和启动两阶段对A注入先失败后成功，B固定成功，记录两次候选/约束和spawn结果；独立路径交协调者安排，不能用旧2秒/8秒夹具直接声称当前版本复现。

## 交接

本轮只读代码/历史原始证据，未运行产品或新局部测试；以上三项均为基于源码的具体可构造风险，未声称历史真实用户已触发。v5/v12正常代表游戏结论仍成立，公开有效Java面板及所有未批准扩展继续排除。报告交统一管理聊天主动读取；不修改main、活跃共享树、契约或批准记录。
