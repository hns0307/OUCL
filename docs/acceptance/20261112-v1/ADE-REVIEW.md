# P-A / P-D / P-E 授权与证据审查

2026-11-12（Asia/Shanghai）。范围：静态源码、批准记录、历史报告及日志审查；不是冻结候选的测试结果。本次只新建本文，未修改源码/公共文档、提交、操作GUI、运行测试或构建。主验收方负责冻结、拆分和实际整合验证。

开工额度：get_usage_limits 的 codex primary 为300分钟、usedPercent=3，剩余97%，reset时间戳1794438506；满足剩余不少于20%的门槛，周额度不作为门槛。共享分支mod_loaders存在大量交织未提交文件，HEAD仅代表基线，不能代表当前候选。规则入口：`AGENTS.md:3`、`:39`、`:85`；交接限制与整合状态：`docs/ACCEPTANCE_HANDOFF_20261111.md:9`、`:13`。

## 结论与建议选择

| 包/增量 | 授权 | 本次建议 | 必须保留的限制 |
| --- | --- | --- | --- |
| A必要基础：所有者guard、启动/Mod相关基础修正 | G2，有明确批准 | 按依赖和hunk选择，条件候选 | 不宣称A10真实产品强制中断恢复通过；不整体选择A全部改动 |
| A Quilt资源索引别名 | 已批准方案A；实现仍WIP | 暂排除本轮默认候选；无法安全拆分则暂缓相关混合文件 | 局部测试通过不替代完整回归、旧实例兼容及Quilt游戏实测 |
| D准确Java/锁内最终复核 | G2首片明确批准 | 优先条件候选 | 无新公开有效Java面板；保留unknown阻断与许可后needsRecovery语义 |
| E固定包只读预览v1 | 明确批准，已核对真实聊天答复 | 仅固定只读入口条件候选 | 不扩成通用mrpack、导入、下载、安装、包级事务 |

“条件候选”不是最终合并批准或测试通过。本次没有确认新的可复现源码缺陷；下列是已见失败、证据缺口和整合风险，分别给出处理条件。

## 授权核实

- A所有者机制：`OUCL-Codex/docs/DECISIONS.md:359`、`:361`，用户“授权并继续”，允许设计及实施安全接管，不允许删除无法证明归属的锁。新格式与旧UUID锁不能混同。
- A别名：同文件`:369`、`:371`，用户“A”，明确官方ID+可信SHA1独立投影、旧收据兼容、安装/启动/虚拟资源/恢复一致，不得覆盖旧索引或清除失败现场。授权存在，验收尚未完成是独立问题。
- D：同文件`:363`、`:365`，用户“是”，批准准确Java绑定、现有锁内最终复核、unknown阻止启动、许可后保守恢复；`:367`明确真实产品游戏尚未重验。`P-D/PLAN.md:98`公共有效值展示仍是独立后片。历史PLAN/REVIEW中的PENDING按后续真实批准解释，不能反向撤销批准。
- E：`docs/work-packages/P-E/E2-IMPLEMENTATION-20261111.md:3`记录用户“批准”。另通过read_thread核对聊天`01a1860b-f8e0-7271-ba19-5500990955ed`：用户消息`01a1c97d-022a-7133-b85b-7e8260705018`原文“批准”，对应上一轮对文件选择、packs:inspectFixed和固定样本界面的具体审批问题。不是依据泛指“继续”推断。整合方应把这一精确授权关系带入冻结清单，本文不改公共批准文档。

## 可操作问题与补证条件

### ADE-01：别名仍WIP，完整失败未被局部绿色覆盖（整合阻塞）

事实：`P-A/runs/20261111-quilt-index-conflict/REPORT.md:3`仍写实施与验收进行中，失败实例needsRecovery且无receipts；`:5`记录同ID=5不同官方SHA1碰撞。当前源码确有实现：`src/core/install/plan.ts:29`、`:36`，`src/core/launch/plan.ts:33`，`src/services/install/installer.ts:90`、`:373`，`src/services/launch/service.ts:111`。因此不是“尚未开始”，也不能称已交付。

现有`P-A/evidence/asset-alias-full.log:644`记录637项，`:646`为627通过、`:647`为6失败、`:649`为4跳过；失败位置包括`:205`、`:206`、`:371`、`:611`至`:613`。日志尾部有tmp目录mkdtemp ENOENT，故不能把这些失败直接归因为别名算法。`asset-alias-test-r2.log`尾部48通过/0失败仅覆盖局部测试，不能清除完整失败记录。本次未重跑。

动作：默认排除别名hunk及专属断言；若主验收方选择纳入，先冻结ID+SHA1格式/旧收据判定，补完整检查零失败、同ID不同摘要并存、同摘要复用、虚拟资源一致、旧原版/Fabric重开字节不变、外来/非法路径/失败恢复停写，以及独立根Quilt安装和实际菜单/退出证据。保存原失败现场。

### ADE-02：A/D混合文件不能按文件归属合并（整合阻塞）

`installer.ts:10`导入别名，`:90`至`:93`按收据恢复别名，`:373`新安装应用别名；`:410`起又有共享client.jar/既有实例处理，不应随别名整体回退。`launch/service.ts:111`至`:113`提取索引路径，同时该文件承担D最终复核装配。交接明确这些混合关系，见`ACCEPTANCE_HANDOFF_20261111.md`“冻结和差异拆分注意事项”。

动作：对installer、launch/service、installer测试做hunk级依赖清单。排除别名时同时调整纯计划/启动参数及对应夹具，保留D锁内只读复核、准确Java、提交许可与共享client修正。拆分后重编译并跑真实installer/Mod事务夹具；无法证明拆分完整则暂缓，不在活跃树裁剪。

### ADE-03：D服务证据充分但未覆盖当前产品入口（验收缺口）

`P-D/IMPLEMENTATION-20261111.md:17`为真实Java8/17/21属性探测；`:18`为21项真实存储/事务与模拟游戏争锁；`:31`为历史612项608通过/4跳过。`:25`明确实际产品Java/Mod/菜单与重开尚待验收，外部程序不遵守锁仍有窗口。旧A游戏菜单结果不能覆盖后来D变更。

源码与批准方向相符：`src/services/launch/process.ts:68`至`:80`在自有锁内探测同Java、比较完整version、finalize、commitPermit、recheck，再start；`:110`至`:117`等close释放。此为静态顺序核实，不是运行证明。

动作：冻结后跑真实storage+ModTransaction双向争锁、revision/库存/native变化spawn=0、unknown拒绝、取消先赢/许可先赢、许可应答丢失及许可后失败needsRecovery；再用同一产物在独立实例走公开产品入口，记录Java精确版本、代表实例/Mod、游戏菜单、退出、正常重开。大型库存启动耗时/可取消性保留为性能风险。排除公共effectiveJava接口、新共同租约和外部修改原子隔离承诺。

### ADE-04：A10不能用构造遗留标记或旧EXE菜单替代（可延期，但必须显式保留）

`P-A/runs/20261105-owner-guard/REPORT.md:3`、`:11`、`:17`、`:19`区分驱动拒绝强制终止、人工构造新格式残留与正常重开写入；这些不是实际EXE强制中断恢复。`P-A/runs/20261110-v17-fabric/REPORT.md:3`是真实Fabric热缓存菜单/退出0，但不是当前整合构建。

动作：A基础候选保留guard跨进程排斥/worker退出主进程仍持锁/未知旧锁停写测试；真实产品异常中断由主验收方单独安排或明确DEFERRED，不能把整个A标PASS。无需为补证删除旧锁或玩家数据。

### ADE-05：E最终包和完整不污染证据仍缺（发布/产品验收条件）

`P-E/E2-IMPLEMENTATION-20261111.md:17`至`:21`记录历史全量619通过/4跳过、专用worker4通过和独立Electron选择/取消；`E2-REOPEN-20261111.md:8`补一字节不同样本拒绝，`:15`显示requests/tasks仍0但operations从1到2；`:19`仍缺最终EXE冷热、选择器打开时销毁窗口真实竞态与完整文件不污染物证。不能称全程无网络或全部元数据不变。

动作：冻结后显式配置OUCL_FIXED_PACK_WORKER或运行专用4项测试，通用跳过不算通过；最终产物核实worker存在及缺失时不广告能力，再验证选择/取消/不匹配/重开。对实例和包相关文件建立前后内容哈希及目录清单，区分既有catalog读取造成的operations变化；真实销毁竞态若延期应单列风险。

静态边界：`src/shared/contracts/packs.ts:7`至`:13`为packs.fixed-preview.v1、contractVersion=1、单次inspectFixed；`:28`至`:41`严格结果校验。`src/services/packs/fixed-worker.ts:18`有16MiB读取上限、`:25`先验固定大小/SHA256再解析；因此拒绝变体不能证明通用恶意ZIP解析。`coordinator.ts:10`至`:30`保留选择器槽至真正结束、sender销毁abort并丢弃迟到结果；`fixed-reader.ts`等待worker退出后结算。原生选择器等待期无观察超时是既定方案，不能误报为漏取消。

### ADE-06：历史设计状态与后续批准分离（文档整合事项）

`P-E/E2-INTEGRATION-PROPOSAL-20261111.md:3`仍PENDING，`P-D/REVIEW-20261110.md:3`仍“实现待批准”；后续批准和实现记录已覆盖其时间状态。保留历史正文，在主验收清单用日期/契约版本指向后继记录即可，不需移动或覆盖历史MD。

## 依赖与冻结顺序

1. A必要基础按hunk先定界：owner-guard/records/main的生命周期，Mod来源/声明、共享client及bootstrap变化逐项标注用途；引导器变化需bootstrap实际检查，不能仅凭A菜单证据带入。
2. D使用既有gameDir锁，与Mod事务共享互斥；Java selection/runtime/profiles/java-facts/context、launch snapshot/inputs、process/service、相关测试及验证脚本须成组冻结。独立输出根的build/test脚本也要审，不拆掉必填finalize/permit/recheck调用。
3. A别名为独立可选组，与D共享installer/service/tests。先决定排除或纳入，再形成稳定文件哈希清单；不要用目录整体拷贝解决混合。
4. E固定预览可独立于A/D业务执行，依赖现有归档检查/普通文件守卫及worker构建；与B/C/D共享main、preload、handshake、App和messages，须核对组合后的能力广告和接线。样本、NOTICE、专属运行器随测试材料保留，不复制evidence运行环境。
5. 主验收树完成typecheck/lint/test/build，必要bootstrap与E专属worker检查，再进行统一产物的产品路径；所有历史绿色只作回归选例依据。

## 现有MD按包/契约版本索引

下列路径均相对仓库根；不移动、不改写历史文件。研究规格与已实现公共契约明确分开。

| 包/版本 | MD入口 | 用途/优先级 |
| --- | --- | --- |
| 全局/授权 | OUCL-Codex/docs/TASK_PLAN.md；DECISIONS.md；AGENTS.md；docs/ACCEPTANCE_HANDOFF_20261111.md | 当前批准优先；交接是快照，不是通过证明 |
| A/既有公共契约不扩展 | docs/work-packages/P-A/PLAN.md；MATRIX.md；READ_ONLY_AUDIT.md | 计划、矩阵、只读审计 |
| A/依赖及加载器历史 | P-A/runs/20261031-required-deps/REPORT.md、SAMPLE.md、PINNED-SAMPLE.md、INDIUM-SAMPLE.md、REESES-SAMPLE.md；runs/20261031-quilt/REPORT.md | 历史样本与运行证据，不覆盖新候选 |
| A/owner新格式，非公共IPC版本 | P-A/runs/20261101-owner-lock/REPORT.md、RECOVERY-SPIKE.md；runs/20261105-owner-guard/REPORT.md | spike→实现→恢复限制 |
| A/产品v16–v19 | P-A/runs/20261106-acceptance-review/REPORT.md；runs/20261106-v16-vanilla/REPORT.md；runs/20261110-v17-fabric/REPORT.md | 候选/时间分层；不得跨版本替代 |
| A/ID+SHA1别名方案A，WIP | P-A/runs/20261111-quilt-index-conflict/REPORT.md | 已批准变更与尚待验证列表；局部日志不是完成报告 |
| D/内部首片，无公共版本新增 | P-D/PLAN.md；REVIEW-20261110.md；IMPLEMENTATION-20261111.md | 后继修订/批准/实施优先，PLAN公共effectiveJava仍PENDING |
| E/E0研究 | P-E/PLAN.md；E0-REPORT-20261110.md；sample/NOTICE.md | 样本来源/许可/整体导入候选，非完整导入授权 |
| E/E1内部worker v1 | P-E/E1-PREVIEW-SPEC.md；E1-IMPLEMENTATION-20261111.md | 前者研究设计，后者内部固定worker实现；不把研究通用拒绝向量当公共支持 |
| E/E2公共packs.fixed-preview.v1 | P-E/E2-INTEGRATION-PROPOSAL-20261111.md；E2-PREPARATION-20261111.md；E2-IMPLEMENTATION-20261111.md；E2-REOPEN-20261111.md | 方案→准备→用户批准后的接线→重开补验；contractVersion=1 |

表中P-A/P-D/P-E简写前缀均为`docs/work-packages/`。产品源码契约以`src/shared/contracts/packs.ts:7`及实际冻结版本为准，不将E1研究计划字段视为已公开API。

## 本次验证记录

执行只读git status/rev-parse、rg、Get-Content、get_usage_limits、P-E聊天read_thread；直接检查日志中的测试总数和失败行。没有运行任何产品测试，因此没有“本次PASS”计数。仅本文为本任务产物；最终可合并清单、冻结哈希、当前整合检查及GUI证据由主验收方产生。

## 2026-11-12 v2定向整改追加（后续精确授权）

主验收方随后授权仅在`D:/MC_start/OUCL-acceptance-v2-20261112`修复必要A/D hunk和对应测试；不动活跃源码、v1、UI/messages/C包，不新增契约/依赖/schema。开工再次查额度：五小时已用14%，剩余86%，满足门槛。以下运行结果只覆盖v2定向测试，替代不了主验收完整检查。

### v1三个失败的定性

v1 `acceptance-results/tests-unrestricted.log`为638项631通过/3失败/4跳过；失败是instance-folders隔离/共享两项及mod-java-facts的Mod context一项，均在恢复元数据阶段失败。`src/services/install/installer.ts:91`–`:93`要求ready记录中必须存在唯一、可信摘要匹配的旧路径或别名索引收据，才能选择恢复投影。

v1 `tests/instance-folders.test.ts:18`构造phase/state=ready却receipts为空；`tests/fixtures/mod-ready-instance.ts:26`附近只给client.jar收据，mod-java-facts直接用该合成记录调用真实restoreInstallMetadata。这些夹具不代表实际完成的安装：真实安装在ready前逐项记录全部投影收据，现有installer真实worker用例也验证收据数与计划一致。故三项属于别名新增恢复证明要求暴露的旧夹具缺项，不是已证明的真实旧实例回归；不能为通过而允许ready缺收据或猜测路径。

### v2精确变更（仅两份测试）

- `tests/instance-folders.test.ts:19`：为目录解析合成ready记录添加摘要来自原assetIndexBody的`indexes/5.json`旧路径收据，使原隔离/共享及链接逃逸测试能继续运行到真正的目录守卫；无物化或游戏成功声明。
- `tests/mod-java-facts.test.ts:49`：仅在调用真实Mod context的用例中追加同样的旧路径索引收据，不改共享mod-ready-instance夹具，避免影响其他包的事务测试假设。
- `tests/mod-java-facts.test.ts:58`新增恢复正负例：唯一旧路径和唯一可信别名分别恢复正确投影，输入记录不被改写；缺索引收据、旧/新收据歧义、重复旧收据、错误artifact摘要、错误别名摘要均继续NEEDS_RECOVERY。没有跳过失败测试或放松生产检查。

生产源码未修改。installer、core/install/plan、core/launch/plan、launch/service、launch/process的SHA256与v1相同。本次因此不需要为三个夹具失败排除别名；原先对别名完整回归及真实产品的条件仍保留，不能据此宣布Quilt产品已验收。

### 实际验证与日志

输出专属目录：`D:/MC_start/OUCL-acceptance-v2-20261112/acceptance-results/ade-targeted/`。

1. 以现有esbuild编译src/tests到`compiled/`，未覆盖公共dist或.test-build；随后运行`node --test acceptance-results/ade-targeted/compiled/tests/instance-folders.test.js acceptance-results/ade-targeted/compiled/tests/mod-java-facts.test.js acceptance-results/ade-targeted/compiled/tests/installer.test.js`。
2. 首次受限环境运行失败，日志`tests.log`保留，含符号链接EPERM及关联目录/安装夹具失败；不记作通过。获准未受限运行后，将TMP/TEMP指向专属tmp目录，再跑同一命令，`tests-unrestricted.log`记录24项24通过/0失败/0跳过，退出码0。包含真实storage worker/安装事务、旧收据兼容、D锁内变化拒绝/取消/失联许可/只读复核；游戏进程仍为模拟，不代表真实Minecraft。
3. `node node_modules/typescript/bin/tsc --noEmit`退出码0，日志`typecheck.log`；`node node_modules/eslint/bin/eslint.js tests/instance-folders.test.ts tests/mod-java-facts.test.ts`退出码0，日志`lint.log`。

未运行v2全量测试/完整build/GUI/EXE，由主验收方统一执行；v1和活跃树源码均保留。
