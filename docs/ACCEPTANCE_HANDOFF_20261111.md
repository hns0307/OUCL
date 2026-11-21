# OUCL 跨对话方案与技术验收交接

日期：2026-11-11。状态：本对话按用户要求暂停，交由新对话继续方案审查及技术验收。本文是进度快照，不是测试通过证明。

## 用户目标与当前停止点

此前用户要求“现在验收各个对话进度，并选取功能进行合并”；最新要求“暂停一下，为了避免上下文过长，将方案与技术验收交给新对话”。本对话停止实质验收和合并，只完成交接。新对话先完成方案与技术验收，输出明确的可合并清单及阻塞项；不把本次交接当作对新业务、新依赖或新契约的额外批准。

已经读取五个工作包对话、主要计划/报告和源码差异，但**尚未冻结源码、运行本次整合检查、提交功能或合并 main**。先前报告的测试数量均属各工作包历史结果，不能记作本次整合通过。

## 仓库和隔离工作树

- 活跃源目录：`D:\MC_start\OUCL`，分支 `mod_loaders`。五个工作包实际共用此目录，存在大量交织的未提交变更；不是五条可独立合并的分支。不要在这里 reset、清理、整体暂存或提交其他对话的在途工作。
- 独立验收工作树：`C:\Users\Administrator\.codex\worktrees\oucl-acceptance-20261111\OUCL`，分支 `codex/acceptance-20261111`，基线 `b87be9dc8d3640468dbb069d29e70b6af5712d7d`。已通过 create_worktree 创建并登记；目前只有本交接文档，没有复制候选功能。先前访问被工作区权限拒绝，当前已成为本对话可写根；Git共享元数据操作可能仍需命令权限提升，按工具实际结果处理。
- `D:\MC_start\OUCL-download-main` 检查时为干净 `main`，同为 `b87be9d`。曾尝试在该目录创建整合分支，被 Git 元数据权限拒绝，未切换分支。随后在上述独立工作树成功建立整合分支。
- 独立工作树的 TASK_PLAN/DECISIONS 仍是基线版本，**缺少源目录中11月的最新批准记录**。按规则先读其 TASK_PLAN/DECISIONS，再核对源目录最新版及工作包实际用户答复，不把旧基线的历史 PENDING 当成撤销批准。
- 旧EXE、`OUCL-Codex-Package.zip`、`OUCL.txt`、玩家目录和其他研究文档均保留。没有 push、远程创建或发布。

## 五个对话与当前验收判断

以下对话ID可用 wait_threads 获取紧凑状态；需要核对具体用户批准时再有针对性地 read_thread。不要把聊天活跃状态当作完成，也不要干预其窗口和测试进程。

| 包 | 对话ID | 已见证据和候选范围 | 仍开放的验收边界 |
| --- | --- | --- | --- |
| P-A 现有功能实机验收 | `01a1860b-c3e1-7351-878a-fb5a6874d784` | 新所有者 guard、Mod来源/声明修正、原版和Fabric实机及再次启动；相关bootstrap修复 | 真实强制终止EXE后的恢复未完整验收。Quilt同ID不同SHA1索引冲突修复正在开发，暂不纳入本次候选 |
| P-B 任务管理与观察闭环 | `01a1860b-d178-7463-a74b-435849852860` | 通用任务中心、分页、观察断连/重连、实例任务目标查询、严格公共契约和worker读取屏障；候选 | 仍在补游标逐出、到期、重复页、UUID大小写等边界。旧T1报告落后于代码，需按冻结源码重验 |
| P-C Mod日常维护 | `01a1860b-de4e-7b40-88bc-3872ae63f81a` | 单JAR启停影响的只读计算/展示、短期内存观察、严格IPC/preload/UI；候选只读范围 | 文件启停/卸载未交付。当前公共接线正在补验，旧报告仍写“未接线”；专属TSX静态渲染夹具从通用测试目录移出，需复查最新状态 |
| P-D Java与启动一致性 | `01a1860b-ea56-7d62-8812-41c4481b9095` | Java候选统一、精确版本绑定、既有gameDir锁内只读最终复核、提交许可与取消互锁、失联回执保守恢复；优先候选 | 真实Java8/17/21与正式事务夹具已有证据；当前源码的真实游戏重验尚需核对，不等于公开有效Java面板已交付 |
| P-E 首个整合包导入 | `01a1860b-f8e0-7271-ba19-5500990955ed` | 固定1355字节mrpack样本的独立worker只读预览、原生选择器、取消、重开后不匹配文件提示；候选 | 仅固定样本，不是通用mrpack导入或安装。最终EXE冷热、完整文件不污染物证及真实选择器销毁竞态仍未完成 |

本轮初步选择为 B、D、C只读、E固定只读，必要时带入其已验证的A基础修复。**选择尚未形成冻结后的最终合并批准清单**，不能仅凭模块名整体复制。

## 授权证据索引

先读源目录 `OUCL-Codex/docs/TASK_PLAN.md`、`OUCL-Codex/docs/DECISIONS.md`、根 `AGENTS.md`，再读相关工作包：

- A：DECISIONS 2026-11-01用户“授权并继续”批准安全所有者机制；2026-11-11用户“A”批准索引别名。后者已授权但实施尚未完成，和本次验收选择分开。
- B：`docs/work-packages/P-B/APPROVAL_T1.md`，用户在明确方案B询问后回复“继续”；只读目标查询、内部读取契约及实例面板，不包含新持久格式、依赖或写操作。契约 `contracts/T1/TASK_TARGETS_V1.md`。
- C：DECISIONS 2026-11-11及 `P-C/PREVIEW-CONTRACT-20261111.md`，用户“接入”批准短期内存只读预览、IPC/preload和界面；不授权文件变更。
- D：DECISIONS 2026-11-10用户“是”，范围见 `P-D/PLAN.md`、`REVIEW-20261110.md`、`IMPLEMENTATION-20261111.md`；无新公共IPC/存储/依赖，不接管旧锁。
- E：`P-E/E2-IMPLEMENTATION-20261111.md`记载用户“批准”固定样本 `packs:inspectFixed`、原生选择器和只读UI。需要汇总真实记录到整合文档，不能扩写成完整导入批准。

主要报告还包括 A `runs/20261105-owner-guard/REPORT.md`、`20261106-v16-vanilla/REPORT.md`、`20261110-v17-fabric/REPORT.md`、`20261111-quilt-index-conflict/REPORT.md`；B `validation/B1-20261106/REPORT.md`、`U07-20261106/REPORT.md`、`U08-20261105/REPORT.md`、`WINDOW-20261108/REPORT.md`、`T1-20261111/REPORT.md`；C `REPORT-20261111.md`；E `E2-REOPEN-20261111.md`。历史报告不覆盖其后代码变更。

## 冻结和差异拆分注意事项

源码仍被其他对话修改。先对选中文件进行稳定读取并记录SHA256，再复制到独立验收树；不得直接在活跃源目录回退/裁剪。仅复制必要源码、测试、构建脚本、契约及许可/样本材料；不批量复制evidence中的运行环境、私人资料、缓存或大型构建产物。

当前Quilt索引别名WIP至少涉及：

- `src/core/install/plan.ts` 的 `assetIndexAlias` / `aliasAssetViews`；`src/core/launch/plan.ts` 的 `assets.indexId`。这两文件当时差异均为该WIP；对应 `tests/install-plan.test.ts`、`tests/launch-plan.test.ts` 也是别名差异。
- `src/services/install/installer.ts` 混有D锁内复核与A别名逻辑。别名部分为导入、restoreInstallMetadata里的projection包装，以及安装时调用aliasAssetViews；文件还含另一项共享client.jar重复实例修复，不能整体回退。
- `src/services/launch/service.ts` 同时包含D提交许可/锁内复核和A从indexViews提取indexId并传给planOfflineLaunch；不能按文件全选/全删。
- `tests/installer.test.ts` 混有D的真实锁、变更/取消/失联回执测试和A别名断言、共享client重复实例测试。排除别名需针对hunk审阅、保留D测试并修正夹具，不能简单还原整文件。

上述是观察时的差异，接手后需要重新核对；其他对话可能已继续修改。若无法安全拆分，先验收独立模块或等待对应工作包收敛，不牺牲完整性强行合并。

## 后续技术验收建议

1. 使用紧凑线程快照核对最新进度和实际用户批准，建立“可合并/待补证/排除”表；报告写出证据层级，区分纯逻辑、真实worker、SQLite/文件锁、受控Electron、真实游戏、最终EXE。
2. 冻结候选代码及依赖关系，复查IPC输入/输出严格校验、sender/能力广告、超时取消/退出、持久恢复与无凭证泄漏；不新增业务以凑齐报告。
3. 使用仓库真实命令：typecheck=`node node_modules/typescript/bin/tsc --noEmit`；lint=`node node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts`；test=`node scripts/test.mjs`；build=`node scripts/build.mjs`。现有pnpm曾触发重建依赖，优先直接调用现有工具，不擅自安装。
4. `scripts/test.mjs`支持 `OUCL_TEST_ROOT`，build支持 `OUCL_BUILD_ROOT`；两者在各包改动内，冻结时一起审。通用测试运行器只编译.ts，不编译.tsx。P-C界面专属夹具另跑；不能为了夹具盲改共享测试脚本。
5. E真实worker需要 `OUCL_FIXED_PACK_WORKER`，通用测试中未设时两项会跳过。专属 `node docs/work-packages/P-E/run-fixed-tests.mjs` 会构建worker并跑4项，需要其固定样本及配套许可/说明。不能把跳过当通过。
6. Bootstrap有变动时跑 `node scripts/bootstrap-test.mjs`；其他必要运行时检查按相关模块实际脚本和风险选择。所有输出存到独立验收目录并保留失败；本次尚未运行这些命令。
7. 新对话先交付方案/技术验收结论和可合并列表，保留原用户选取功能本地合并的目标；本对话不再并行执行合并。没有必要恢复其他聊天暂停的任务、操作玩家窗口或发布版本。

额度规则沿用用户要求：先查get_usage_limits，剩余不足20%等待，工作中10%及以下先保存交接后等待；只能在实际确认窗口重置且额度足够后恢复。不要复跑已覆盖的无变化研究。
