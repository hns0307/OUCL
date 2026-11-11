# v3 Quilt别名hunk排除与A/D保留验证

2026-11-12，Asia/Shanghai。执行范围来自主验收方第三阶段精确授权：仅在`D:/MC_start/OUCL-acceptance-v3-20261112`拆除尚未产品验收的资源索引别名，保留D准确Java/锁内复核、共享client修复及其他功能；不提交、不操作GUI。v1/v2与活跃树产品源码未修改。活跃树仅新建本文。开工五小时额度已用25%，剩余75%；周额度不作为门槛。

v3以主验收提供的v2 SHA256副本/BASE-MANIFEST为输入；v2完整检查640项636通过/0失败/4跳过是主验收上报的冻结证据，不记为本次v3通过。已先读取最新TASK_PLAN/DECISIONS；方案A授权没有被撤销，本次只是明确排除于该候选。

## 实施前列出的精确hunk

| 文件 | 拆除或调整 | 必须保留 |
| --- | --- | --- |
| src/core/install/plan.ts | assetIndexAlias、aliasAssetViews两函数 | 原官方ID投影、摘要/路径规则 |
| src/core/launch/plan.ts | 别名导入、assets.indexId可选参数、别名覆盖与校验 | 原assetIndex.id优先于legacy assets的绑定及虚拟目录规则 |
| src/services/install/installer.ts | 别名导入、restoreInstallMetadata中projection包装、三条包装return、新安装aliasAssetViews调用 | verifyPreparedLaunch、inspectLaunchMods、mod事务证明、native事实、共享client路径判断 |
| src/services/launch/service.ts | indexViews/indexId提取四行、assets参数包装 | 准确Java版本、fresh/verify、unknown阻断、锁内复核、commitPermit、取消/失联应答队列 |
| tests/install-plan.test.ts | 别名导入及同ID分隔别名专属测试 | 原安装计划用例 |
| tests/launch-plan.test.ts | 专属别名参数/虚拟目录用例 | 原参数、资产ID优先序及native私有目录用例 |
| tests/installer.test.ts | 别名收据断言改官方ID；冲突路径改fixture.json | 两实例共享client、Fabric/Quilt离线重开、D真实锁与取消/许可测试 |
| tests/mod-java-facts.test.ts | v2别名恢复专属正负例改旧官方ID恢复与输入不变测试 | 原Java选择/取消/未知与真实Mod context用例 |

没有整文件还原混合的installer或launch/service；以`b87be9d`只读diff作为职责参考，按hunk编辑。`tests/instance-folders.test.ts`未变，v2补充的旧索引收据仍保留，原隔离/共享与链接逃逸用例未删除。未改UI/messages/C包，未改BC新增acceptance-task-targets测试，未新增契约/schema/依赖。

## 最终行为和安全边界

- 安装和恢复均重建官方ID路径`indexes/<id>.json`，启动参数及virtual目录重新使用同一官方ID；没有别名覆盖入口。对src/tests执行rg，assetIndexAlias、aliasAssetViews、assets.indexId、indexViews均无残留。
- D最终复核仍在现有gameDir锁内执行：`src/services/launch/process.ts:68`至`:80`的同Java精确版本比较、finalize、commitPermit、recheck、start未修改；`launch/service.ts`只删除别名材料，保留fresh/verify与提交许可队列。
- `src/services/install/installer.ts`共享client修复仍使用instanceGameLayout比较实际jar路径，只跳过真正不同路径的旧client；不是退回只看assets/libraries的旧逻辑。
- restoreInstallMetadata移除了别名路径选择所专有的收据歧义门禁，回到原官方ID重建语义；这不是取消启动文件安全验证，D仍通过verifyLaunchInputs进行正式复核。不会迁移或改写任何实例/收据。

**明确保留的已知限制：Quilt与原版/Fabric若给出相同官方索引ID、不同可信SHA1，仍映射同一个共享索引路径，不能共存安装；校验发现已有不同字节时安全停写并保留needsRecovery，而不是覆盖旧索引。此次排除没有修复该功能缺口，也没有证明Quilt实机验收通过。**

v2/其他别名候选生成的实例不属于v3的兼容迁移目标；不得把v3用于这些测试根后宣称别名实例可恢复。保留v2候选和现场，后续单独收敛别名产品验收，不自动改回旧收据或清理失败实例。

## 定向测试和证据

本次输出均在v3 `acceptance-results/ade-split/`。使用现有esbuild编译src/tests到`compiled/`，未写公共dist/.test-build；再以未受限执行（沿用v2真实SQLite/文件链接条件），TMP/TEMP设为专属`tmp/`：

```text
node --test acceptance-results/ade-split/compiled/tests/install-plan.test.js acceptance-results/ade-split/compiled/tests/launch-plan.test.js acceptance-results/ade-split/compiled/tests/installer.test.js acceptance-results/ade-split/compiled/tests/instance-folders.test.js acceptance-results/ade-split/compiled/tests/mod-java-facts.test.js acceptance-results/ade-split/compiled/tests/game-process.test.js
```

`tests.log`：**51项51通过/0失败/0跳过，退出码0**。包含原版及Fabric/Quilt本地metadata+真实storage worker安装/重开、共享client、D真实锁/文件变化/取消/失联提交许可/只读复核，以及目录与Java用例。游戏子进程仍是替身，不是实际Minecraft菜单证明。

原冲突用例调整为`tests/installer.test.ts`的`same index ID with different bytes is preserved and stops safely rather than becoming ready`：为官方ID路径预置另一份合法索引JSON，明确其SHA1不同于本次可信metadata；实际安装结果任务和实例均needsRecovery，store投影与活动目录既有索引字节不变。该用例证明不同字节的保守停写，不冒充完整双实例上游Quilt复现或真实游戏验证。

`node node_modules/typescript/bin/tsc --noEmit`退出码0（`typecheck.log`）。局部lint覆盖本次8个修改文件，退出码0（`lint.log`）。`hashes.json`记录这8个文件的v2/v3摘要，另核对process、Java selection/runtime、launch-inputs、instance-folders/game-process/mod-transaction测试均与v2字节一致。

未运行v3完整检查、build、GUI、EXE或公网；主验收方统一冻结及执行。本次曾有两次编辑脚本因本机默认文本编码/已处理片段报错，后逐文件检查最终v2/v3差异并完成定向验证，没有把中间状态记为通过。
