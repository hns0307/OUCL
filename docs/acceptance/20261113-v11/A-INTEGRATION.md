# v11 A索引别名与隐藏依赖双摘要最小整合

2026-11-13（Asia/Shanghai）。用户/主协调明确“继续”，本任务仅在非Git隔离副本`D:/MC_start/OUCL-acceptance-v11-20261113`实施已批准A路径隔离及对应测试；活跃`D:/MC_start/OUCL`只读来源，唯一写入为本文。未操作GUI/游戏、旧根/旧进程、未打包或提交。开工五小时已用22%，剩余78%；周额度不作门槛。

已先读最新TASK_PLAN、DECISIONS、AGENTS及`docs/acceptance/20261113-v10/REPORT.md`：2026-11-11批准官方索引ID+可信SHA1别名；2026-11-12批准隐藏依赖客户端JAR SHA1+官方版本元数据SHA1隔离。原A v21菜单/退出与638/639历史通过仅为来源证据，不记作v11通过。v3已合main的历史状态不等于本次新集合已冻结/验收。

## 输入、精确范围和保留项

v11原有`BASE-MANIFEST.json`含597文件，`BASE-OVERLAYS.json`明确两份最新TASK_PLAN/DECISIONS覆盖。新副本node_modules沿用协调方已有联接，未安装依赖。逐hunk比对活跃树与v11后，确认五个生产文件的全部差异均为本次A范围，才逐文件移入这五组已审差异；没有整体覆盖共享树或整个src/tests目录。

| 文件 | 本次A hunk |
| --- | --- |
| src/core/install/plan.ts:29、:36 | assetIndexAlias生成官方ID-可信SHA1，aliasAssetViews只转换索引/virtual路径，保持制品与信任证明 |
| src/core/launch/plan.ts | 内部assets.indexId可选值只允许原ID或可信别名，assets_index_name与game_assets一致 |
| src/services/install/instance-files.ts:17 | 别名计划下隐藏目录dep-客户端SHA1-对应jarVersionId官方元数据SHA1；旧计划继续dep-客户端SHA1，缺证明拒绝 |
| src/services/install/installer.ts:87、:373 | 恢复依据唯一匹配的索引收据选旧/新投影；ready缺收据或歧义阻断；新安装应用别名 |
| src/services/launch/service.ts:111 | 从已复验计划的唯一索引view提取indexId传纯启动计划，不取渲染任意路径 |

同时移入install-plan/launch-plan/installer三个测试文件中已审A差异；instance-folders仅移入A布局测试hunk并在本测试内补可信旧索引收据。保留v3的原隔离/共享目录与链接逃逸用例。mod-java-facts保留v3已有Java与旧路径恢复用例，新增唯一旧/新收据选择、缺失/歧义/重复/错误摘要阻断和证据输入不变断言。

识别到活跃`tests/fixtures/mod-ready-instance.ts`另有索引对象/收据补充，不整体带入共享夹具；使用局部测试收据事实，避免改变B/C或事务夹具。没有复制活跃树其他测试删除项。

**D保留**：准确Java候选/完整version、现有gameDir锁内finalize/recheck、unknown阻断、commitPermit与取消同队列、失联应答及许可后needsRecovery、shared client路径修复均保留。launch/service只增加上述索引选择hunk；process、Java selection/runtime、launch-inputs、Mod事务代码及测试没有变。

**B/C/E保留**：未改UI、公共IPC/契约、存储解析器/schema、依赖/锁文件；B目标查询/专项规模读取及acceptance-task-targets测试、C两项既有UI整改、E固定只读桥接/worker/界面均与v11输入字节一致。未从活跃P-C后继改动覆盖基线。新公共能力、文件启停/卸载、D公开Java面板、E通用导入未实现。

## 基线对比与指纹

机器可读证据位于v11 `acceptance-results/a-integration/`：

- `import-inputs.json`：八个直接移入文件的基线与只读源SHA256；`import.diff`记录移入时diff。
- `changes.json`：对597输入逐文件哈希，应用两份已批准overlay后，只有以下10个源/测试文件变化，unexpectedChanges=[]。其他585个基线文件和两份批准overlay均一致。
- `final.diff`：v3→最终v11十文件完整差异。新增验证输出和.test-build为空目录/测试临时材料不属于冻结产品代码，未伪装进597清单。

最终SHA256如下；各自完整baseline SHA256同时记录在changes.json，不仅记录文件名或短哈希。

| 修改文件 | 最终SHA256 |
| --- | --- |
| src/core/install/plan.ts | 6c3de9be7933ce270abf49a085d0ad984a9aa39be29ac6dbc2afc56b2dd3498f |
| src/core/launch/plan.ts | bf5aee6d782d262f6ea51ffbc4666de1bb6c7b874726e0547ba93b6d9ca328bd |
| src/services/install/installer.ts | 61cc82b9efd6ccf284fce40e6f90afeb44243762472eeb191721275f668578fe |
| src/services/install/instance-files.ts | dad4146247011dbeaced34311388a30a23f7b5697e60f69a2ed88a2758c66b36 |
| src/services/launch/service.ts | 1646843329cf4a1b555e0e5d1524074185a994d8a7542eebc05920083c15024a |
| tests/install-plan.test.ts | bc6d3efa7c3996df77a766f653600106cc567c0373f21e35c1f76d3e52a20037 |
| tests/installer.test.ts | 3791a39f6fb00086ce36f435430a4abbf1111f052b3893f67bd9de0157cdac18 |
| tests/instance-folders.test.ts | 11c41c30ef577264e1a156ef55b3f8e620e976ebed5af603d179774e82744ff1 |
| tests/launch-plan.test.ts | 4797c669a90ffafcdc1ca8efde0b0092f9f4078d75653c02740ce18d239f652c |
| tests/mod-java-facts.test.ts | d73ad0665d7726f3b3c0584eb997a7687e81cdd13216b07795ce8f1482508df7 |

## 实际验证、失败及修复状态

从v11根使用已有esbuild把src/tests全部编译至专属`acceptance-results/a-integration/compiled`；没有覆盖dist或公共编译产物。`compile.log`退出0。以下检查真实运行：

| 检查 | 结果与证据 |
| --- | --- |
| node node_modules/typescript/bin/tsc --noEmit | 退出0，typecheck.log |
| 局部ESLint（上述10文件） | 退出0，lint.log |
| 定向Node tests首轮 | 92项71通过/21失败/0跳过，tests.log；21项均Mod事务夹具mkdtemp要求的v11/.test-build父目录缺失，ENOENT，未执行到事务断言 |
| 同组重跑 | 92项92通过/0失败/0跳过，退出0，tests-r2.log |

重跑只在新v11补建空`.test-build`，没有改产品、跳过用例或删除失败证据。真实SQLite/文件链接用例沿用此前固定候选批准的未受限执行条件；TMP/TEMP指向专属tmp目录。测试命令为：

```text
node --test acceptance-results/a-integration/compiled/tests/install-plan.test.js acceptance-results/a-integration/compiled/tests/launch-plan.test.js acceptance-results/a-integration/compiled/tests/instance-folders.test.js acceptance-results/a-integration/compiled/tests/installer.test.js acceptance-results/a-integration/compiled/tests/mod-java-facts.test.js acceptance-results/a-integration/compiled/tests/game-process.test.js acceptance-results/a-integration/compiled/tests/mod-transaction.test.js acceptance-results/a-integration/compiled/tests/instance-records.test.js acceptance-results/a-integration/compiled/tests/loader-receipts.test.js
```

通过内容包括：同官方ID不同可信索引SHA1的别名/virtual投影、启动可信indexId与伪别名拒绝；正式安装及两实例共享client、Fabric/Quilt本地metadata安装与禁网重开；新隐藏目录对相同client不同metadata摘要分离、旧计划原路径及缺proof阻断；旧/新唯一索引收据恢复、不改输入、缺失/重复/歧义/错误摘要拒绝；外来共享内容不覆盖。布局双摘要差异用例是纯结构事实，不冒充两份真实上游元数据的新游戏安装。

D与安全回归包含正式worker/真实文件与SQLite下的启动/Mod事务双向争锁、修订/库存/native/账户变化拒绝、unknown拒绝、取消与失联许可、只读复验禁用物化/解压，以及事务真实进程三个提交点终止恢复。该最后项是夹具子进程，不是A真实EXE强制终止或其他聊天进程。本轮游戏spawn为测试替身，无公网、GUI或Minecraft执行。

## 仍待主协调的统一门槛

本任务完成最小hunk整合和定向验证，**不标v11全部技术/产品验收通过**。未跑全仓库统一check/build、未冻结新集合、未打包/提交/main整合，这些由主协调完成；不把v3的651项或A的643项改成本轮通过数量。

统一回归应特别覆盖其他调用restoreInstallMetadata的服务夹具，防止合成ready记录缺可信索引收据导致保守NEEDS_RECOVERY；应补事实而非放宽ready门禁或把用例跳过。若出现10文件以外新代码需求，先报告范围，不自动整体搬入活跃源。

后续产品共存验证必须用同一冻结v11产物，验证旧正式实例原索引/原隐藏路径不变，新Quilt别名/双摘要隐藏目录与旧原版/Fabric+FerriteCore共存、正常重开及自然退出。原A v21构造副本、只读复用旧Java/曾调整登记恢复日志的限制继续保留；不声称v11无需调整即可迁移任意中间实验包或自动处理旧锁。

旧索引采用唯一收据确定旧/新计划，新隐藏目录通过别名计划进入双摘要规则；本轮没有新增持久模式字段或迁移程序。历史“仅索引别名但隐藏目录仍旧格式”的中间实验候选不是本轮已证明兼容的旧正式实例集合，若协调方需导入应另核实实际收据/路径并保持安全阻断，不猜测或重写旧证明。

A真实EXE强制终止/未知旧锁接管、全部异常回执时序及完整历史方案仍未全部验收；本任务不触碰旧根、不清锁、不把测试替身或不同候选菜单拼接为通过。
