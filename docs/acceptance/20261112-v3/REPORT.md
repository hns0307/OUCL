# 第三阶段增量报告：拆分候选与只读产品入口

日期：2026-11-12（北京时间）。**去除Quilt别名的技术候选回归通过，固定包只读产品入口补验通过；最终合并及完整产品验收仍开放。**

## 本轮结果

- v2按hunk拆除未完成产品验收的Quilt别名，保留D准确Java/锁内复核及共享client修复。v2候选及失败现场保留。
- B新增13项故障/计时/容量检查通过。包括真实worker的缺计划、篡改、未来格式、跨根和确认摘要拒绝，以及main超时/pending槽/快照与游标预算；层级和未覆盖项见[B报告](B-BOUNDARIES.md)。
- v3冻结后完整检查651项：647通过、0失败、4跳过；类型、lint、构建、bootstrap34项、固定包worker4项及C组件四组验证通过。
- 实际Electron产品窗口首次使用原生选择器读取固定样本，取消正常；关闭重开后选一字节变体被拒绝。缺专用worker的复制构建不广告对应能力。三轮均正常退出0。

## 来源与拆分

`D:/MC_start/OUCL-acceptance-v3-20261112`以v2哈希复制，[冻结清单](FREEZE-MANIFEST.json)记录597文件、相对v2的10项变化：A/D拆分8文件，B新增测试/运行器2文件。结束再次核对零漂移。没有新增依赖、公共契约或持久格式，没有修改活跃产品源码。

[ADE拆分表](ADE-SPLIT.md)列每个hunk的删除/保留关系及51项定向结果。v3回到官方ID投影，同ID不同可信SHA1仍不能共存；检测冲突安全停写为needsRecovery，旧字节保持。此次没有修复Quilt功能缺口，也不支持把v2别名测试实例作为兼容迁移目标。D锁内复核、unknown阻断、提交许可与取消互锁保留。

## 统一检查证据

cwd为v3隔离副本，沿用现有依赖；完整测试获得工具批准的本地目录链接及回环夹具权限。

| 命令/入口 | 结果 |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | [退出0](evidence/typecheck.log) |
| `node node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts` | [退出0](evidence/lint.log) |
| `OUCL_TEST_ROOT=acceptance-results/full node scripts/test.mjs` | [651项647PASS/0FAIL/4SKIP](evidence/tests.log)，核心行98.95%/分支96.45%/函数99.26% |
| `OUCL_BUILD_ROOT=acceptance-results/product node scripts/build.mjs` | [通过](evidence/build.log)，[7个产物摘要](evidence/product-manifest.json) |
| `node docs/work-packages/P-E/run-fixed-tests.mjs` | [4PASS/0FAIL/0SKIP](evidence/fixed-pack.log) |
| `node docs/work-packages/P-C/acceptance-v2-component-probe.mjs` | [四组PASS](evidence/pc-component.log)，受控hooks，非真实React DOM |
| 建立.test-build后`node scripts/bootstrap-test.mjs` | [34PASS](evidence/bootstrap.log) |
| ADE定向检查 | [51PASS](evidence/ade-split/tests.log)，正式worker/锁/文件，游戏为替身 |
| B补证运行器 | [13PASS](evidence/b-targets/tests.log)，含5父级和8子测试；首次夹具失败日志保留 |

4跳过仍是符号链接权限、打开SQLite不可重命名、通用运行器未配置的两项专用worker；后两项由专用运行器另行通过，不改原跳过数。

## 实际产品窗口与不污染证据

使用[cua-driver技能](C:/Users/Administrator/.agents/skills/cua-driver/SKILL.md)，只操作本轮PID24520/39052新窗口；缺worker检查PID34004由harness读取实际公开握手后正常关闭。没有接管原五聊天窗口或游戏。

采用未打包的正式main/preload/renderer/worker与独立空profile。[harness](evidence/product-window.cjs)启动前在Electron默认session拦截HTTP/HTTPS并记blocked；原生选择器及包领域服务没有替换。目录读取因网络阻断显示错误。“cold/hot”只是日志标签，指空profile首次启动及同profile重开，不是最终EXE或运行时下载冷热验证。

- [首次日志](evidence/product-cold.jsonl)：实际握手广告19能力；renderer无Node、contextIsolation/sandbox=true、nodeIntegration=false。原生选择样本后显示MC/Forge/Java、FerriteCore及“当前不可安装”；再次打开原生选择器并取消，显示“未选择文件”。
- [重开日志](evidence/product-hot.jsonl)：相同profile能力保持，一字节变体显示不匹配提示。两轮均will-quit和exit0。
- [缺worker日志](evidence/product-missing.jsonl)：复制构建只省略fixed-pack.cjs，握手不广告packs.fixed-preview.v1，其他服务仍可启动，exit0。
- [UIA观察](evidence/native-observations.json)与产品DOM日志相互支持。首次后台关闭快捷键被驱动拒绝后按提示使用前台Alt+F4；没有强制终止进程。
- [检查前](evidence/protected-before.json)、[首次后](evidence/protected-after-cold.json)、[重开后](evidence/protected-after-hot.json)逐字段一致：metadata无JSON实例/包记录；tasks/requests/operations均空且行内容SHA256一致；两输入样本SHA256不变。不只是比较数量。Chromium缓存/日志不在不变承诺内；空profile证据不能外推为有内容玩家实例全目录不变。

## 当前清单与后续门槛

| 候选 | 已完成 | 未关闭的边界 |
| --- | --- | --- |
| A必要基础/引导器 | 本地回归、bootstrap | 真实EXE强制中断恢复仍DEFERRED，按依赖hunk选择 |
| B任务中心/目标查询 | 当前完整回归及故障/预算补证 | 双域1000计划全worker链、精确超限、同产品壳多实例活动选择和持久重开 |
| C只读影响预览 | UI整改及受控组件验证 | 同产品壳真实报告/窗口预览；文件启停/卸载排除 |
| D Java/现有锁复核 | 当前回归、真实storage/事务锁夹具 | 当前产物实际Java/Mod/游戏菜单与正常重开；公开有效Java面板排除 |
| E固定样本只读 | 本地技术及本轮离线产品入口 | 最终EXE冷热、真实选择器打开期间窗口销毁；通用导入/安装排除 |
| A Quilt别名 | 已从v3排除 | v2独立保留，后续另验，不混入候选提交 |

原main/mod_loaders仍在b87be9d，本轮不整体提交活跃树，不push/发布。既有隔离Git验收树状态已核对，只有交接文档未跟踪；候选转入及提交结果随后追加。候选提交不等于合并main或关闭产品缺项。

下一最小增量：在隔离Git树保存明确集合的候选提交，补统一产品壳B/C及D真实启动；选定集合通过后再做最终EXE。额度本轮复查五小时已用45%，按用户要求不以周额度作门槛。

## 候选提交追加

已在既有隔离`codex/acceptance-20261111`分支保存本地候选：`bc01f07487ca7e8d76f17115ea148efcafd748c2`（`feat: assemble scoped launcher acceptance candidate`），200文件变化。main和活跃mod_loaders保持原基线，未合并、未push。

[明确文件集合](CANDIDATE-FILES.json)为493个源/测试/脚本/必要工作包材料和验收文件（多数基线文件无差异）；它与完整冻结快照清单用途不同。首次暂存因历史P-A/tools旧dist被忽略返回非零，随后排除整个历史tools集合，仅在隔离索引撤回这些路径并重新暂存，成功提交；没有强制加入忽略产物。旧复制tools仍留在该隔离树未跟踪，不称工作树完全干净，不清理原活跃树。对应日志保留。

[提交对象逐文件比对](evidence/commit-content-check.json)：493路径无内容差异，91项只有Git CRLF→LF规范化。源码/测试/脚本/bootstrap的暂存差异检查通过；原始测试日志末尾空格和历史MD末尾空行保留，不为格式清理改写证据。候选提交包含本报告追加之前的版本；本次提交结果追加由后续验收文档提交同步。
