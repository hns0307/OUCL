# P-B 专项只读审查

日期：2026-11-14。范围：`task-targets.v1`、归属和游标、任务观察、worker 预算及规模证据。调度指定产品基线 `fab0ac873f34d8581bf065e14fa7a9aa93c0baa3`；只读候选 `D:/MC_start/OUCL-download-main` 在审查开始时 HEAD 为 `26483918cef993266d541e9aacc8249c4ad4c2d4`，结束核对时为 `2f7202cfb002d3de10bb4b6f95504661ba906198`。其间仅增加 v27 协作管理文档及索引；结束时 `git status --short` 无输出，`git diff fab0ac8 HEAD -- src tests scripts package.json pnpm-lock.yaml` 无差异。后继文档不是新产品构建。

已读活跃 `OUCL-Codex/docs/TASK_PLAN.md`、`DECISIONS.md`，候选 `docs/ACCEPTANCE_HANDOFF_20261111.md`、`docs/acceptance/20261114-v26/{REPORT.md,CURRENT-CHECKLIST.md,HANDOFF.md}`、`docs/work-packages/P-B/APPROVAL_T1.md` 和 T1 契约；核对候选源码与测试、v3 B-BOUNDARIES、v5 目标原始提取、v6 B-SCALE 原始结果及窗口提取、v11 完整日志和冻结记录。五小时窗口起始已用 44%，中途已用 59%，均未触及停止门槛；周额度不作为门槛。本轮未运行测试、GUI、游戏、选择器或网络，以下问题均为代码静态分析结合历史原始证据，不冒称本轮动态复现。

## 发现

### P2：第九个及以后的任务详情可能长期得不到自动观察

- 位置：`D:/MC_start/OUCL-download-main/src/ui/task-observer.ts:105`、`:107`、`:119`；实际任务中心在 `D:/MC_start/OUCL-download-main/src/ui/TaskCenter.tsx:17`、`:30` 默认同时挂载最多 20 张卡片。P-B 计划 `D:/MC_start/OUCL-download-main/docs/work-packages/P-B/PLAN.md:74` 写有八个并发详情及公平轮转。
- 触发条件：同一观察池中先后有至少九张持续活动且不被移除、隐藏、停止或重新排序的任务卡片。`tick()` 每次对按插入顺序的可用项先 `slice(0, 8)`，仅对这八项调度；前八个持续活动时第九项不会自动进入候选，等待时长没有上界。它保留 `unconfirmed`，不会收到自身自动订阅或健康确认；用户可以通过该卡片的显式重新查询将其移到队首，因此不是说完全无法手动恢复，也不声称会错误更改任务状态。
- 现有实际证据：`D:/MC_start/OUCL-download-main/tests/task-observer.test.ts:102` 历史断言 100 张卡片 10 秒仅接纳 8 个；`:125`–`:131` 明确第九项在 5 秒后仍为 unconfirmed，手动 `reconnect()` 后才 confirmed。`D:/MC_start/OUCL-download-main/docs/acceptance/20261113-v11/evidence/full/tests.log:595`、`:598` 记录这两个测试通过；它们证明短时限制和手动路径，不证明自动公平轮转。长期饥饿是本轮由固定 `slice` 推导，尚无本轮长时间实测。
- 最小建议：在保持最多 8 个详情、全局并发 2 和每 500ms 准入的约束下，给等待项可证明的轮换/公平准入，保留显式重连优先及退出时退订。若协调者安排验证，新增隔离 fake-timer 场景：前 8 个永不终态、至少第 9 个等待，验证无需人工操作也能在有限调度轮次内被确认，并验证上限及业务控制次数不变；不是本轮已运行。

### P2：worker 清点 SQL 接纳库存时不能逐条遵守 2 秒工作预算

- 位置：`D:/MC_start/OUCL-download-main/src/services/workers/mod-targets.ts:17`、`:25`；`D:/MC_start/OUCL-download-main/src/services/storage/tasks.ts:38`、`:44`–`:61`。已批准 T1 文档 `D:/MC_start/OUCL-download-main/docs/work-packages/P-B/contracts/T1/TASK_TARGETS_V1.md:133` 要求 worker 在每条记录之间检查 2000ms 工作预算，并明确不强杀共享 worker。
- 触发条件：请求域存在较多有效接纳记录，且 SQLite 查询/逐项 `get` 或反序列化期间跨过截止时间。例如两域各接近 1000 条且存储较慢：`readModTargetAdmissions` 同步遍历全部记录并逐项查询，调用者只在整个调用完成后检查时钟，中途没有预算回调。超限时不会错误返回成功，但超过预算的剩余库存工作仍会继续占用共享 storage worker；同时检查域的读取屏障及主进程 pending 槽须等原读取返回，其他排队工作可能延后。单次 OS/SQLite 调用本就不保证硬实时；此处指出的是多条记录之间也没有检查点，并非声称代码应中断单个系统调用。
- 现有实际证据：`D:/MC_start/OUCL-download-main/tests/acceptance-task-targets.test.ts:108`–`:118` 的历史时钟注入在进入库存遍历前触发第三次时钟检查，只证明该检查点 TIMEOUT 后 worker 仍可用；`D:/MC_start/OUCL-download-main/docs/acceptance/20261112-v6/evidence/b-scale/result.json` 记录本机真实双域 2000 条首读约 1604ms、重开后约 1483ms，不能证明慢库存期间逐条退出。本轮没有运行慢盘或注入测试，也没有观测到该场景实际超时。
- 最小建议：在可信内部库存遍历的每条记录之间传递并检查同一 deadline，确保超时不会被存储层包装成错误码 `STORAGE_IO`，且释放接纳屏障和 pending 槽时保持“不强杀 worker、不写任务”的语义。待协调者安排时可在独立夹具对库存遍历中间注入受控时钟，断言在下一记录前返回 TIMEOUT、保留原始接纳且 worker 与后续业务仍可用；本轮未运行。

## 证据判断

**可接纳的有限证据：** v3 真实 worker/SQLite 对 A 计划缺失、外改、未来格式、跨根及摘要冲突的拒绝，及受控 main 定时/容量测试；v5 的 `docs/acceptance/20261112-v5/evidence/b-final-proof.json` 显示 B 选中时同一 A 任务前后均 running、B 结果不含 A；v6 `docs/acceptance/20261112-v6/evidence/window-extraction.json` 包含正式任务中心四任务冷/正常重开观察；v6 `evidence/b-scale/result.json` 显示真实 StorageClient/worker/SQLite/JSON 双域各 1000 项、重开后 2000 项、20 页，以及第 1001 项的两种正式拒绝。规模数据为合成且未运行游戏，界面证据和规模链不是同一个端到端场景。

v11 原始 `docs/acceptance/20261113-v11/evidence/full/tests.log` 第 667–672 行为 655 项、651 通过、0 失败、4 跳过。先前 P-B 的 637 项受限外回归 5 失败中，两项安装超时在串行重跑通过，另外 `folder resolver uses the actual isolated game directory`、`folder resolver uses the actual shared game directory`、`Mod context requests the real metadata Java major and propagates measured facts without inference` 的同名测试在 v11 完整日志第 224、225、390 行均通过；这是同名测试和全量日志层级的可追溯后继，不等于逐字节相同输入或相同并发条件。不能把活跃共享树的旧失败直接当作冻结候选当前失败。

**待补证：** 上述两个明确的新条件；真实慢盘/调度时限及更广泛生命周期组合；正常产品壳重开及真实 worker 规模链虽各有证据，不能合称一个真实 GUI 2000 项端到端试验。1MiB/2MiB 在当前合法 exact DTO 中的保守上界和有效样本见 `docs/acceptance/20261112-v6/evidence/b-scale/byte-bounds.json`；没有合法阈值加一运行，不要求以非法 DTO 冒充。私有响应解析器未单独限制每 kind 1000，但现有真实 worker 库存入口已限制每域 1000；仅凭恶意伪造 worker 响应不能作为当前正常产品缺陷，本轮列为非阻塞防御性加固，不计新增问题。

**排除：** 本轮无产品实现、契约/存储/依赖变更，无全量复跑、无 GUI 或旧窗口操作，不对 C/D/E 或完整历史方案作新的通过结论。后续任何局部实验需由统一管理聊天安排；本报告不授权整改或扩项。
