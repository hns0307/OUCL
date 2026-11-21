# 第一阶段增量报告：冻结与首次技术验收

日期：2026-11-12（北京时间）。门禁G2，仅验收已批准增量；没有新增业务、依赖、公共契约或持久格式。整体结论：**暂不合并**。已完成来源核对、稳定快照、首次统一检查和整改分派。

## 简明结论

任务中心、Java启动复核、Mod只读预览和固定包只读预览已经有实现，不能视作五条独立分支。统一检查仍有3项失败；Mod预览界面另有2项确定问题，需要修复后再验收。没有提交功能或合并main，没有操作玩家窗口或发布版本。

## 版本与来源

- 活跃源：`D:/MC_start/OUCL`，`mod_loaders`，基线`b87be9dc8d3640468dbb069d29e70b6af5712d7d`；保留全部在途变更。
- v1稳定快照：`D:/MC_start/OUCL-acceptance-v1-20261112`，不是Git分支；`FREEZE-MANIFEST.json`记录1760文件的SHA256。逐文件复制前后及全体复制后再次核对源哈希一致。快照包含按目录遍历带入的A旧测试临时夹具，明确不属于待合并文件，v2已排除test-temp路径。
- 原交接的`codex/acceptance-20261111`工作树本轮未修改。使用D盘新隔离副本以遵守当前可写根；旧树没有本轮候选代码。
- 依赖通过目录连接复用现有node_modules，没有安装或重建；测试与构建只写隔离副本。目录连接和完整测试重跑获得工具权限批准。
- 已核对五聊天最新可读进度；A/B/C/D末轮有中断状态，E末轮已完成。聊天状态不能代替产品验收。

## 实际检查

下列命令均在v1快照执行，原始日志位于其`acceptance-results/`。

| 命令 | 结果 | 日志/限制 |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS，退出0 | typecheck.log |
| `node node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts` | PASS，退出0 | lint.log |
| `OUCL_BUILD_ROOT=acceptance-results/product node scripts/build.mjs` | PASS，退出0 | build.log；包含专用fixed-pack worker；不是EXE |
| `OUCL_TEST_ROOT=acceptance-results/full node scripts/test.mjs` | FAIL，638项608通过/26失败/4跳过 | tests.log；出现回环与链接权限错误，不将所有失败归因于环境 |
| 同上，独立full-unrestricted目录，工具批准权限后重跑 | FAIL，638项631通过/3失败/4跳过，退出1 | tests-unrestricted.log；剩余失败见下 |
| `node docs/work-packages/P-E/run-fixed-tests.mjs` | PASS，4通过/0失败/0跳过 | fixed-pack.log；真实worker及异常/取消边界 |
| `node docs/work-packages/P-C/preload-bridge-probe.mjs` | PASS，退出0 | pc-bridge.log；真实bridge/handler/jobs，内存IPC替身 |
| `node docs/work-packages/P-C/component-probe.mjs` | PASS，退出0 | pc-component.log；真实组件+替代hooks，非DOM/Electron |
| `node scripts/bootstrap-test.mjs` | 首轮FAIL；补建脚本要求的.test-build目录后PASS，34项 | bootstrap.log/bootstrap-rerun.log；未改脚本掩盖失败 |

4项通用测试跳过：本机文件符号链接权限、Windows打开SQLite库不能重命名、两项未配置fixed-pack专用worker。后两项由专用运行器另行实际通过；前两项仍保留跳过，不称通过。未运行本轮产品窗口、Minecraft或最终EXE验收。

## 缺陷与整改

1. 目录解析isolated/shared两项和Mod context Java事实一项均在恢复安装元数据时返回NEEDS_RECOVERY；权限重跑后仍失败，须查Quilt别名/旧收据及夹具关系。未归类为环境问题，也不通过跳过处理。
2. C预览查询或取消返回PREVIEW_EXPIRED后保留活动snapshot，界面仍显示运行且阻止新预览。
3. C影响列表未显示文件归属、严重程度、来源及实际版本等已有安全投影字段，难以定位冲突。

详见[BC审查](BC-REVIEW.md)、[ADE审查](ADE-REVIEW.md)，其中旧报告“C未接线”的描述已由最新源码和实际检查纠正；历史报告本身保留。

## 候选清单（不是最终可合并批准）

| 包 | 当前结论 | 合并前条件/排除范围 |
| --- | --- | --- |
| A必要基础 | 待补证并按hunk定界 | owner guard、Mod来源、共享client和bootstrap不能整体按包带入；真实强制终止恢复仍开放 |
| A Quilt别名 | 暂排除出最终可合并清单 | 已批准但仍WIP；3项当前失败需诊断，新旧索引/虚拟资源/重开产品证据不齐；不能整文件覆盖D |
| B任务中心/目标查询 | 候选，待补证 | 冻结完整检查尚未通过；极限页容量、真实worker异常和产品重开仍按契约核对 |
| C只读影响预览 | 待整改 | 修复上述2问题并复验；实际文件启停/卸载排除 |
| D Java/锁内复核 | 候选，待补证 | 保留必填finalize/permit/recheck与取消互锁；不称有效Java公开面板完成；本轮真实游戏未验 |
| E固定样本只读 | 候选，技术局部通过 | 只支持固定1355字节样本，不是通用导入或安装；最终EXE冷热及选择器销毁真实竞态开放 |

## 下一阶段安排

保留v1不改；整改副本`D:/MC_start/OUCL-acceptance-v2-20261112`以v1清单为基础，排除旧测试临时夹具，BASE-MANIFEST记录来源。BC聊天只改v2的预览UI/必要文案及专属夹具；ADE聊天只改必要A/D元数据恢复及对应测试，或安全拆除未通过的别名hunk。二者不改活跃共享源码，完成后由协调聊天记录差异并统一运行完整检查，形成v2报告。未解决项继续明确列待补证或排除，不擅自扩大业务。

审查聊天：BC `01a1cbcd-2062-7630-b618-a708b58a8741`；ADE `01a1cbcd-2f19-72c1-af8e-7bd60562e0dc`。用户已授权自行启动其他聊天及整改；没有恢复原五聊天暂停的实施任务。

额度：本轮启动时五小时已用0%，确认实际刷新；自动任务oucl-2改为每30分钟检查，只以五小时余量作门槛（<20%等待，工作中<=10%保存）。周额度按用户新要求不作工作门槛。整体方案验收完成前保留自动接续，只有重要变化或阶段交付通知。
