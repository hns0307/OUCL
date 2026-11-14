# P-A 专项只读审查（2026-11-14）

## 范围与基线

本轮由统一管理聊天 `01a1cab6-af91-7db2-bbb0-7b614ed3ebb6` 派发，只审查所有者恢复、资源索引及隐藏依赖隔离和既有产品证据。未恢复旧实施任务，未操作 GUI、选择器、游戏或进程，未删锁，未修改生产、测试、契约、依赖、批准及统一索引；没有执行任何新测试或新故障注入。唯一写入为本报告。

稳定目录为 `D:/MC_start/OUCL-download-main`。首次读取 HEAD=`26483918cef993266d541e9aacc8249c4ad4c2d4`；末次读取 HEAD=`2f7202cfb002d3de10bb4b6f95504661ba906198`，工作树均干净。两者差异仅为 TASK_PLAN、DECISIONS、验收 README 和 v27 管理文档；`fab0ac8` 至末次 HEAD 的 `src/tests/scripts/bootstrap/package.json/pnpm-lock.yaml` 差异为空，产品身份仍是 `fab0ac873f34d8581bf065e14fa7a9aa93c0baa3`。以上为本轮 Git 只读检查，不是重新构建证明。

额度：开始五小时已用44%（剩56%），报告收尾已用72%（剩28%）；周额度按调度要求忽略。没有使用重置、自动化、下级任务或跨聊天消息。

## 已读材料与证据层次

- 活跃资料 `D:/MC_start/OUCL/OUCL-Codex/docs/TASK_PLAN.md`、`DECISIONS.md`：核对2026-11-01安全所有者机制、11-11索引方案A、11-12双摘要路径及11-13 v12本地接纳记录。仅继承既有批准。
- 根 `docs/ACCEPTANCE_HANDOFF_20261111.md`，v26 `REPORT.md`、`CURRENT-CHECKLIST.md`、`HANDOFF.md`，并核对v8强制中断被拒记录。
- 稳定候选 v11 `REPORT.md`、`A-INTEGRATION.md`、`GAME-PREPARATION.md`相关段落、完整测试原始日志、product-manifest/package.json；v12 `REPORT.md` 和 `evidence/game/v12-result.json`。v11历史记录为655项/651通过/0失败/4既有跳过、类型/lint/build通过，本轮未重跑。
- 本轮直接查看归档的 `vanilla-menu.png` 与 `quilt-reopened-menu.png`：分别可见原版及 Quilt Loader 0.29.2 菜单。这是对历史图像内容的只读复核，不是本轮真实窗口运行。Fabric/FerriteCore、四会话exit0及两次启动器exit0以v12原始审计/报告为既有证据，不冒称本轮再次运行。
- v12审计把新会话、任务、两资源索引、依赖JAR/JSON、日志及七产物身份分别核对；其48项PASS不从游戏日志推断菜单。EXE既有记录为406528字节，SHA256 `3d9a0ebaf289a9552933c97033ffbd6a069e0a0258e3ea8322cc2a5ceb6efce6`，appHash `d863502b24972f98dc62e578794ea5e881bea5033e86efd5074ee4d20a63bb5d`。
- 稳定候选源码重点：`src/services/storage/owner-guard.ts`、`records.ts`、`workers/storage-client.ts`、`workers/entry.ts`、`objects/store.ts`、`install/installer.ts`、`instance-files.ts`、`core/install/plan.ts`、`core/launch/plan.ts`、`launch/service.ts`；现有owner-guard及别名/收据/布局测试。只读检索全部对象锁引用。
- 原P-A现场材料 `D:/MC_start/OUCL/docs/work-packages/P-A/evidence/launch-debug.log` 与索引冲突报告：历史诊断真实捕获 `ObjectError: STORE_BUSY` 的 ObjectStore.open 栈；原始旧锁未被接管。该诊断不是fab0ac8的真实强制中断测试。

## 问题

### P1：对象存储仍为新实例生成不可恢复的UUID锁，元数据guard恢复不能恢复实际启动/下载能力

**位置**：`D:/MC_start/OUCL-download-main/src/services/objects/store.ts:49`（创建及EEXIST拒绝，47–52行）；`D:/MC_start/OUCL-download-main/src/services/objects/store.ts:202`（仅正常close释放，202–204行）。调用链为 `D:/MC_start/OUCL-download-main/src/services/install/installer.ts:176`，`prepareLaunch` 自同文件200行开始并先调用 `resources()`；元数据恢复入口独立位于 `D:/MC_start/OUCL-download-main/src/services/workers/storage-client.ts:53`。

**可复现条件**：当前候选在任意一次安装/启动使用对象存储后，主进程在 `runtime.objects.close()` 前异常结束；Windows释放metadata guard句柄，但普通 `store/objects.owner.lock` 文件仍在。下次主进程可重新取得metadata guard，首次启动/下载仍在ObjectStore.open对该文件的`wx`打开处得到EEXIST/STORE_BUSY。此文件仍只含随机UUID，不含可验证持有者失效证据；现行代码没有区分旧锁与当前候选新生成锁的恢复路径。

**实际依据**：本轮静态确认ObjectStore只在open失败清理自身锁及正常close时unlink；全src检索无启动恢复该锁的路径。`OwnerGuard.acquire`保护metadata目录，未传递或绑定到ObjectStore。原P-A历史诊断已实际出现同类型对象锁阻断，转构造副本才完成游戏验收。现有 `tests/owner-guard.test.ts:60` 之后的子进程终止用例只取得OwnerGuard，未打开ObjectStore，因此不能关闭此缺口。v12只验证正常退出，未覆盖上述异常路径。本轮未新运行复现，不声称fab0ac8发生过实际强制中断。

**影响/结论**：数据仍被保守保护，但当前候选自己的异常退出也会使后续游戏启动/安装永久停在STORE_BUSY，直到人工处理或换独立根。应把“metadata guard可恢复”和“产品运行资源可恢复”明确分开；这不是仅缺最终EXE强杀物证。该问题不推翻v12正常共存证据，但阻止将A完整恢复目标验收通过。历史已暴露同型症状，本轮确认其仍存在于稳定候选。

**最小整改建议**：由协调者安排独立增量，为每个对象存储根引入可验证、具备OS排他句柄及根身份的所有者证据，覆盖同metadata与不同profile共享store的竞争；无法证明的现有UUID锁继续停写。不能仅凭metadata guard可取得就删除对象锁，也不能以PID、时间或“没有窗口”推断失效。先核对2026-11-01既有批准并冻结兼容/恢复边界，只有超出既有授权的变化才重新审批；不建议在本轮报告直接改代码。

### P2：临时资源初始化失败被缓存，环境恢复后同一启动器的后续重试不会重新打开存储

**位置**：`D:/MC_start/OUCL-download-main/src/services/install/installer.ts:171`（`this.runtime ??= (...)()`），180–182行（清理局部worker后重抛并永久保留被拒Promise）。

**可复现条件**：一次 `resources()` 因可解除的占用或IO错误失败，例如另一受支持profile暂时独占同一对象根；随后对方正常关闭、锁确已正常释放。本启动器再次发起新的启动/安装请求，仍await同一个已reject的Promise，不再执行ObjectStore.open；只有重启启动器才有新的初始化机会。该条件与P1的无法证明旧锁不同，即便没有遗留锁仍可触发。

**实际依据**：本轮静态代码路径确定；失败分支关闭hash/native/installer workers但未清除runtime，且检索该字段没有失败重试重置。未运行新的双profile/注入复现，尚无该精确场景的真实EXE证据，故不把静态结论表述为本轮实测。

**影响**：用户在临时占用解除后重试仍持续失败，不能从恢复后的外部状态受益。UI的通用失败提示也不足以解释必须重开应用。

**最小整改建议**：只在同一次初始化失败已完成局部资源清理后，按Promise身份条件清除缓存，保留成功实例唯一性与并发请求合并；不得在任务仍持有资源时重置，也不得借此清理外国/旧锁。协调者安排后可新增精确局部场景：首次确定失败→占用者正常释放→同service第二次进入初始化并成功，另核对并发调用只启动一套资源。本轮未运行此场景。

## 可接纳、待补证、排除

| 集合 | 审查判断 |
| --- | --- |
| 资源索引别名及隐藏依赖双摘要 | 可接纳既有正常安装/共存范围。本轮未发现需新增整改的隔离算法缺陷：别名绑定官方ID+可信SHA1；旧/新唯一索引收据决定计划；ready缺失/歧义收据停写；新隐藏目录绑定client+原版文档摘要，旧实例保留原路径。安装物化及启动参数/复验使用同一计划。 |
| v11/v12完整回归与最终EXE共存 | 可接纳其精确历史层级：统一回归、正常重开、四菜单/exit0及旧/新索引/依赖并存；不需无变化重跑。v12预置Electron运行时，不属于新冷下载；构造资料和正式API重绑边界按原报告保留。 |
| metadata OwnerGuard | 可接纳已覆盖的排他/身份核验、legacy保留与专用子进程层级；不把它扩为所有资源租约的自动恢复保证。 |
| A最终EXE真实强制中断 | 继续DEFERRED，既有CUA派生进程归属拒绝未改变。本轮无终止尝试。另把P1/P2作为需要协调决策的产品问题，而不是以DEFERRED标签消除。 |
| 全部旧锁、断电/提交点、硬盘/世界/加载器矩阵 | 未全验，按当前清单保留。未知证据必须停写。 |
| 跨包C/E剩余边界与未批能力 | 非本次P-A审查结论；不扩大到C文件动作、D公开Java面板、E通用导入/安装或新认证/联机/后台。 |

## 建议给统一管理者的下一步

先判定P1的对象根租约修复是否作为恢复目标的下一最小增量，再安排P2精确局部验证；本聊天不自行实施或运行。若需要最终EXE补证，仅在CUA提供受支持的派生进程归属操作，或用户提供真实中断物证后，由唯一GUI控制者执行。没有新条件时不重试既有强杀拒绝，也不shell kill/删锁。

本轮已完成指定只读审查并停止，等待协调者派发整改。
