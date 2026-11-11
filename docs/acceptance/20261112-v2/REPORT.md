# 第二阶段增量报告：整改与统一技术回归

日期：2026-11-12（北京时间）。**技术回归通过，整体产品验收及本地合并仍开放。** 本报告替代v1的当前技术结论，保留v1全部失败记录。

## 给使用者的简要说明

已修好Mod影响预览过期后无法重新预览的问题，并补全冲突文件、严重程度、来源和实际版本的展示。此前三个单测失败是旧测试数据缺少索引收据，已补齐有效数据并增加拒绝异常收据的测试，没有降低生产安全检查。当前冻结版本640项中636通过、0失败、4项明确跳过，另有专用worker和组件验证通过。

这证明本轮源码在所列本地检查下可构建且回归通过；还不能证明最终EXE、真实游戏或所有工作包验收完成。

## 精确变动

相对v1只有6文件变化，均在`D:/MC_start/OUCL-acceptance-v2-20261112`，未回写活跃产品源码：

| 文件 | 目的 |
| --- | --- |
| src/ui/MaintenancePreviewPanel.tsx | PREVIEW_EXPIRED清除活动观察、允许新请求；TIMEOUT保留查询；展示已有安全问题字段 |
| src/shared/locales/messages.ts | 过期重试说明及内嵌深度文案 |
| tests/instance-folders.test.ts | 合成ready实例补齐旧路径可信索引收据，继续实际目录守卫测试 |
| tests/mod-java-facts.test.ts | context用例补有效收据；唯一旧/别名恢复、缺失/重复/错误收据停写负例 |
| tests/task-target-dual-capacity.test.ts | 真实SQLite两域各1000条完整读取、任一域1001拒绝、未请求域不受影响 |
| docs/work-packages/P-C/acceptance-v2-component-probe.mjs | 真实组件+受控hooks的过期恢复、完整安全展示验证 |

原计划、别名及D生产复核实现未因测试失败而放松或修改。595文件[冻结清单](FREEZE-MANIFEST.json)包含SHA256及6项差异；检查结束再次核对零漂移。v2并不是Git分支或已合并提交。

## 可复跑证据

cwd为v2隔离副本，复用现有依赖，没有安装新依赖。全部命令退出0；完整测试在工具批准权限下运行，本地夹具包含回环HTTP、真实SQLite/worker/目录锁及模拟游戏进程，不是公网或真实游戏测试。

| 命令 | 结果 |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | [通过](evidence/typecheck.log) |
| `node node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts` | [通过](evidence/lint.log) |
| `OUCL_TEST_ROOT=acceptance-results/full node scripts/test.mjs` | [640项/636通过/0失败/4跳过](evidence/tests.log)，核心行98.97%/分支96.39%/函数99.27% |
| `OUCL_BUILD_ROOT=acceptance-results/product node scripts/build.mjs` | [通过](evidence/build.log)，renderer/main/preload/普通worker/固定包worker |
| `node docs/work-packages/P-E/run-fixed-tests.mjs` | [真实专用worker 4通过/0失败/0跳过](evidence/fixed-pack.log) |
| `node docs/work-packages/P-C/acceptance-v2-component-probe.mjs` | [四组通过](evidence/pc-component.log)，非真实React DOM/Electron |
| 编译并运行task-target-dual-capacity.test.ts | [1通过/0失败](evidence/dual-capacity.log)，也进入640项全量回归 |
| 建立.test-build后`node scripts/bootstrap-test.mjs` | [34项通过](evidence/bootstrap.log) |

4项跳过仍为符号链接权限、打开SQLite库无法重命名，以及通用运行器未配置的两项固定包worker；后两项已由专用运行器实际通过，不改写原跳过数。v1首轮及权限重跑失败均保留。ADE整改聊天另跑24项真实worker/目录锁与恢复定向测试全通过，详[追加记录](../20261112-v1/ADE-REVIEW.md)；BC整改详[追加记录](../20261112-v1/BC-REVIEW.md)。

## 方案验收与可合并分层

| 包 | 方案/本地技术结论 | 最终合并状态 |
| --- | --- | --- |
| B任务中心/目标查询 | 已批准的只读范围与实现相符；当前统一检查及两域SQLite容量通过 | 条件候选：仍需真实worker全部缺计划/篡改与大小预算矩阵、统一产品壳活动选择和持久重开证据 |
| C只读影响预览 | 两项已确认UI问题修复并受控组件验证，当前技术检查通过 | 只读范围条件候选；真实产品窗口补证开放，实际启停/卸载明确排除 |
| D准确Java与现有锁复核 | 当前统一检查及正式storage/事务夹具通过；unknown仍拒绝、许可后失败仍保守恢复 | 条件候选：同一冻结产物的实际游戏入口、准确Java/Mod及重开待补证；公开有效Java面板排除 |
| E固定样本只读 | 固定样本、严格IPC/worker方案及技术检查通过 | 条件候选：最终EXE冷热/缺worker不广告/真实选择器销毁/完整不污染证据开放；通用导入和安装排除 |
| A必要基础 | 按具体依赖hunk候选，bootstrap当前检查通过 | 真正EXE强制中断恢复仍DEFERRED；不把全部A自动纳入 |
| A Quilt别名 | 已批准，当前完整回归及新旧收据恢复用例通过 | **暂不列最终可合并**：Quilt实机、新旧实例字节与虚拟资源的统一产品证据不足。v2含该实现用于组合测试，不能直接整包复制为选定提交 |

本轮形成的是有证据的技术候选清单，不是宣称每包完整通过；最终可合并集合仍需冻结具体hunk/依赖并过产品验收。所有候选共用main/preload/handshake/messages等文件，不能按文件夹整体合并。

## 下一次最小增量

1. 先以v2哈希为唯一代码来源，生成排除Quilt别名或另验其产品证据的明确hunk清单；不从活跃树整体复制。
2. 补B必需边界及同一产物的只读产品窗口/重开验证，再按D/A既有授权在独立实例验证真实启动；不接管原聊天窗口/进程。
3. 如生成最终候选提交，使用已登记隔离Git工作树并核对最新批准快照；先跑选定集合检查再本地合并，不push/发布，不提交活跃共享工作树。

这三项仍未完成；下一次自动接续应读取本报告，不能因已有绿色回归而重复无变化研究或直接宣称整体完成。原五聊天暂停状态保持；两个新审查聊天本阶段已返回。半小时额度检测继续有效，整体验收结束后删除自动任务。
