# P-C：单 JAR 维护与依赖影响

日期：2026-10-29；状态：设计交付，产品变更 **PENDING**。观察基线 HEAD `b87be9dc8d3640468dbb069d29e70b6af5712d7d`，研究文档直接读取当前工作树，未假定已入 HEAD。

2026-11-10更新：用户在本聊天回复“开始”，已启动V2a纯计算底座。原文保留为提案历史；进度及新发现的modCommitId不兼容见[实施记录](IMPLEMENTATION-20261110.md)。§4.3复用modCommitId的候选停止采用，新的独立实例字段/启动证明修订仍PENDING，未实现启停。

## 1. 授权、交付和边界

现有工程处于 G2；本包本次授权仅在专属目录完成具体设计、证据和独立研究。新维护 IPC、记录格式与执行器尚未批准，不因既有新增安装授权而自动获准。本文不修改公共源码、TASK_PLAN、DECISIONS、依赖、分支、玩家实例或 EXE，也不提交其他聊天文件。

本次拟改文件仅本 PLAN.md 及 evidence.json。验证为源码定位、参考副本哈希核验、文档链接/字段核对；不运行覆盖 dist/.test-build 的产品构建。产品功能未实现、恢复未实测、游戏未验收。

顺序为 V2a 只读预览 → V2b 单个受管普通 JAR 启停及恢复 → V2c 多声明/别名/批量与未知本地文件 → V2d 卸载及恢复。更新、版本固定、config、世界、整包 overlay、GC 实现不在本包首增量。

## 2. 已核查事实

| 源码/材料 | 真实结论 | 设计影响 |
| --- | --- | --- |
| [ModPanel](../../../src/ui/ModPanel.tsx) | 注释与按钮均为只读列表/检查，历史报告不授权写入 | 新动作不能复用旧报告直接改文件；任务关联问题由 P-B 协调 |
| [inventory](../../../src/services/mods/inventory.ts) | fileId=SHA256(JSON.stringify({instanceId,filename}))；同名换内容 ID 不变，改为 .disabled 后变化 | fileId 仅扫描定位符，不是字节身份或长期句柄 |
| 同文件 modInventoryFingerprint | 指纹绑定实例、修订、按原始文件名排序的文件 ID/名称/状态/大小/SHA256/issues；扫描另检查时间戳与 dev/ino | 指纹不是文件所有权证明，也未包含持久来源归属和环境事实 |
| [transaction](../../../src/services/mods/transaction.ts) | 明确 Add-only；私有副本发布，instance.modCommitId 为提交点；回退保留字节；文件身份不同不移除外部替换 | 禁止把 files 数组解释成 rename/remove |
| [mod-transactions](../../../src/services/storage/mod-transactions.ts) | formatVersion=1，文件名必须 .jar；记录新文件三摘要/来源/identity，阶段 prepared/applying/committed/rolledBack/needsRecovery | 不覆盖 v1 解析器；另立维护域，旧事务继续原规则 |
| [local check](../../../src/core/mods/check.ts) | 同一物理 JAR 可贡献多个声明、provides、嵌套声明；禁用入口不贡献启用 provider | 变更单位为根 JAR，影响包括其全部 provider |
| [platform check](../../../src/core/mods/platform.ts) | 本地声明与平台来源是不同证据，未知不会自动通过 | 启用须共同检查，不从平台标签推断全部依赖 |
| [进程服务](../../../src/services/launch/process.ts)、transaction | gameDir 的 oucl.session.lock 是现有共同排他入口 | 延续同一许可；不能另建仅维护服务知道的锁 |
| [研究](../../IMPLEMENTATION_RESEARCH_20261029.md)、[观察报告](../../validation/RESEARCH-OBSERVATION-20261029/REPORT.md) | 锁外预检到 spawn 的窗口有受控模拟证据，不是游戏损坏实证 | P-D 的锁内最终复核是维护与启动组合验收依赖 |

工作树已有他人修改和未跟踪研究，均保留。源码事实的摘要见 evidence.json；它只证明本次读取的输入，不证明产品运行通过。

## 3. V2a：准确只读影响预览

输入只接受 rootId、instanceId、expectedRevision、当前 report 的 fileId 和动作 enable/disable；主进程重新扫描，不能信 renderer 的名称、摘要或路径。UI选物理文件，展开其所有 modId/provides/嵌套来源；同一 JAR 内不能单独禁用一个声明。

纯 core 将完整库存分别构造成 before/after 激活集合，运行既有本地及平台检查。禁用移除整根文件所有 provider；启用加入全部 provider。输出按根 JAR 列 directRequiredBy、transitiveRequiredBy、aliases、embeddedVia、beforeIssues、afterIssues、introducedIssues、resolvedIssues，保留范围/客户端环境的 unknown。反向链用 visited 防环，重复 provider 不任选一个；平台 project/version 约束与本地 modId 约束分列，不能按名称合并。

禁用：若引入必需依赖缺失/范围不满足则 blocked；可选依赖列提示。启用：重复 ID/别名、冲突、加载器/MC/Java 不符则 blocked。相关事实未知则 unknown，不能点确认。首版更保守：完整 before/after 检查均须可判定，已有不满足也阻止执行；以后允许修复已有坏状态须另定差异政策。预览本身可以返回 blocked/unknown，不伪装为可执行。

预览不改文件，不自动禁用依赖者、不下载依赖。指纹变化后必须重算，不能只让用户再次点旧确认。

## 4. V2b 最小可批准切片

仅支持一个 OUCL 已提交安装回执能证明归属的普通根 JAR，在同一实例 mods 中 `x.jar ↔ x.jar.disabled`。要求摘要、来源、安装提交链与当前入口匹配；曾禁用的文件由新的维护回执承接归属。单靠 Modrinth 哈希命中不算受管。首版仅单声明、无 provides/嵌套 provider；其他结构允许预览，执行返回 UNSUPPORTED_SHAPE，留 V2c 扩展。

只认可一个 `.jar.disabled` 后缀（大小写不敏感），不把 `.disabled.disabled`、`.jar.off`、`.bak` 当启停别名。目标名由主进程从已验证源名推导，不接受 renderer 自选。目标已有任何入口，即使同字节也冲突；Windows 大小写折叠冲突同样拒绝，不合并两个同内容文件。扫描中发现其他禁用别名可显示未知，不能自动改名纳管。

### 4.1 操作句柄与有效性

使用主进程生成 UUID entryHandle，存于不可变维护计划，不把 dev/ino 暴露给 UI。句柄仅在该计划有效，跨扫描不承诺稳定。私有 binding 精确包含：rootId、instanceId、gameDir 身份摘要、expectedRevision、instanceRecordDigest、inventoryFingerprint、entry fileId、源名、目标名、enabled、size、sha1/sha256/sha512、dev/ino、nlink、来源证明摘要、原归属回执 ID、环境事实摘要、plannerVersion。

计划 ID 为上述规范化内容及完整影响结果的 SHA256；数组显式排序，固定 key 顺序，规范化版本为1。文件摘要不是来源证明；dev/ino 不是内容证明。两者都复验。同字节原位替换、跨根同 UUID、同名不同字节、时间戳伪装必须失效。nlink≠1、零 ino、重解析点、目录或无法证明路径安全时阻止首版执行；不以跟随链接实现共享 Mod。

环境摘要使用实际 MC/loader/Java 测量及来源记录修订；与 P-D 约定同一事实格式后才接线，不在本包私自发明“Java 已验证”事实。确认时重采样比较，不把旧检查时间当可信保证。

### 4.2 候选公开契约（新增 mods-maintenance.v1，待批）

所有 envelope 沿既有 protocol/requestId/sender/schema 验证；只在真实装配后广告能力。

| 方法 | exact payload | 成功 data |
| --- | --- | --- |
| mods:maintenancePreview | {rootId,instanceId,expectedRevision,fileId,action} | {planRequestId,planId,entryHandle,state,impact,expiresAt} |
| mods:maintenanceConfirm | {planRequestId,planId,entryHandle} | {taskId} |
| mods:maintenanceState | {planRequestId} | {planId,state,taskId:null或UUID,result:null或回执摘要} |
| mods:maintenanceCancel | {planRequestId,planId} | {state} |

UUID/64位小写摘要、修订正安全整数、action 严格 enable/disable；未知字段拒绝；计划最多一个根 JAR、256库存文件、512公开影响项，截断则 unknown 而非 ready。名称仅展示，不用于确认。公开结果含准确 rootId/instanceId、beforeRevision/afterRevision、before/afterFingerprint、动作、状态、全部受影响声明、错误码，不含绝对路径/文件身份/URL。

预览调用受理预算3秒，返回既有持久任务身份；上表 preview 的完整 data 是任务结果，需相应共享结果解析器，不能让一次大扫描堵住IPC。confirm/state/cancel 应答预算3秒；超时只表示应答未知，以同 requestId 读回，绝不自动生成新写任务。计划有效期15分钟；已接纳任务不因到期中断。重复确认同一计划返回同 taskId；同 requestId 不同内容拒绝。旧根切换后仍须 rootId 精确匹配，不能对当前根重新解释。

任务订阅沿现有 subscribe/unsubscribe、revision/seq、跳号读回及sender销毁清理；窗口关闭不取消任务。只读预览及未开始执行可取消；到持久 applying 前检查取消，进入后 TOO_LATE，完成或 needsRecovery 后读回结果。接受请求前已取消的计划不得再确认。无需任务暂停或新通用控制动作。

错误候选：INVALID_ARGUMENT、ROOT_UNAVAILABLE、REVISION_CONFLICT、PLAN_EXPIRED、PLAN_MISMATCH、FILES_CHANGED、ENVIRONMENT_CHANGED、DEPENDENCY_BLOCKED、FACTS_UNKNOWN、UNMANAGED_FILE、UNSUPPORTED_SHAPE、TARGET_EXISTS、INSTANCE_BUSY、MODS_UNSAFE、DISK_FULL、PERMISSION_DENIED、TOO_LATE、CANCELLED、NEEDS_RECOVERY。映射既有错误分类/中文文案；系统堆栈不公开。没有可靠 owner 证明时不提供“清锁”。

### 4.3 新私有恢复格式（独立 mod-maint-* 域，待批）

不扩写 mod-txn v1。新 MaintenanceRecord formatVersion=1，exact keys：

```text
formatVersion, operationId, taskId, rootId, instanceId,
planRequestId, planId, binding, beforeInstanceDigest, afterInstanceDigest,
beforeRevision, afterRevision, beforeModCommitId, leaseToken,
phase, action, source, target, retained, receipt
```

binding 为4.1全部字段；action 仅 enable/disable。source/target 为 `{filename,enabled,size,sha1,sha256,sha512,identity}`，identity 为 `{dev,ino}`；retained 为 `{slot,digests,size,identity}`，slot 仅固定枚举 original，路径从 operationId 推导，不能记录任意路径。receipt 初始 null，完成时为 `{operationId,planId,afterRevision,afterFingerprint}`。beforeModCommitId 可 null，维护后复用 instance.modCommitId=operationId 作JSON提交点；解析/启动/原安装服务对该字段的语义兼容必须先核验，若不兼容则另提 instance schema，不能默改。归属回执链保留前驱，恢复不能只找最后一笔安装。

phase：prepared → retained → applying → committed；提交前可进入 rolledBack 或 needsRecovery，needsRecovery 仅在证据完整后收敛到 committed/rolledBack。版本未知、字段多余、非法阶段转换停写。immutable binding/source/target预期摘要不可重写；实际 identity 仅在对应建立阶段从null填入一次。record 使用既有版本化JSON/CAS/原子写和持久操作日志，新增worker白名单域但不新增SQLite表/运行库。大小上限512KiB，恢复列表需有界分页，不能扩大原确认1000上限来藏新历史。

### 4.4 执行与恢复

1. 接纳幂等任务，取得与启动共同的 gameDir 许可；读取会话，任何未退出会话/未知owner均拒绝。确认源/目标目录身份、库存、实例修订和环境重新成立。
2. 写 prepared（无实例目录改动）；复制源到同卷私有恢复目录，COPYFILE_EXCL、完整摘要复验、同步并落 retained。保留独立字节，不能把恢复副本硬链接到可写原件或共享对象。
3. 写 applying 后，复制恢复副本到目标 COPYFILE_EXCL；记录并核对目标身份/摘要。复核源身份/摘要后移走源到独占恢复槽，不覆盖；再次完整扫描验证目标集合及期望指纹。
4. CAS 提交实例 revision+1 和唯一 modCommitId，更新可重建索引，持久 committed/回执，再释放本人许可。应答丢失以提交身份和实例完整摘要判定，不重做文件动作。
5. 提交前失败：仅移走能证明本人创建且字节未变的目标；恢复源时原名必须不存在，COPYFILE_EXCL，完整复验。源/目标出现外部替换时保留所有材料，needsRecovery，禁止覆盖、删除外部入口或自动解锁。已提交则只向前补索引/回执，不因回执失败逆向撤销。

步骤3的“移走”必须是 Windows 验证过的无覆盖原语，Node rename 默认行为不足以作为 no-clobber 保证。实施前在本包独立目录验证可用原语及文件身份 TOCTOU；若现有依赖无法提供安全保证，首版对外部编辑竞态进入保守阻断，提出具体适配变更再批准，不能声称任意外部进程下原子安全。外部编辑不遵守 OUCL 锁，这是当前设计的明确剩余风险。

多次文件操作只对遵守同一锁的OUCL启动/写入不可见，不称跨文件系统原子事务。崩溃留下两入口时保留锁并阻断启动；恢复扫描须包含源/目标/恢复副本及实例提交证据。恢复接管旧owner须证明旧进程已结束；现有规则不能证明时停在诊断，不自动删锁。恢复前后均检查根目录/重解析点和身份。

恢复副本与日志默认不自动清除，不设“7天后自动删”。仅未来明确清理授权、终态回执和无恢复/回退引用时可回收；磁盘不足则写入前失败。磁盘flush不是断电持久保证，需真实进程中断验证；不把单测称断电验收。

## 5. 后续切片

| 切片 | 增加什么 | 前置/禁止 |
| --- | --- | --- |
| V2c-1 | 解除单声明限制，完整根 JAR 多Mod/provides/嵌套影响显示 | 别名替代provider、循环依赖、重复ID测试齐全；不拆JAR |
| V2c-2 | 批量启停 | 对最终集合一次求解、单计划单提交、全组回退；不能循环单文件API后称整批原子；上限/取消/日志数组需另冻结 |
| V2c-3 | 未知本地文件 | 推荐独立明确授权后仅禁用/保留恢复，不要求平台身份；启用未知声明仍阻止。另一选项维持全只读；不能把来源unknown强行变trusted |
| V2d | 卸载入口、受控恢复预览 | 新action及tombstone schema另批；先保留完整字节/声明/原名/来源/归属/依赖影响；确认后移出mods到恢复区，不删除共享对象/config/世界 |

V2d恢复是以当前库存生成的新计划，不重放旧revision；原名占用、依赖/环境变化时阻止或展示新的具体解决方案。禁用JAR卸载仍需归属证明，启用JAR卸载要评估反向依赖。恢复保留根与未来GC协调；P-C不实现更新/旧新版替换事务。

## 6. 拟改产品文件与并行依赖（批准后）

| 范围 | 候选文件 | 目的 |
| --- | --- | --- |
| V2a纯计算 | 新 core/mods/maintenance-impact.ts 及对应 tests | before/after、反向影响及unknown传播，无IO |
| 新契约 | 新 shared/contracts/mod-maintenance.ts，shared/locales/messages.ts | exact请求/结果/错误；handshake capability、bridge、preload、ipc注册需集中协调 |
| 私有计划/恢复 | 新 services/storage/mod-maintenance.ts、services/mods/maintenance-planner.ts、maintenance-transaction.ts | 独立格式/记录域、句柄、归属链、回执与恢复 |
| 复用装配 | storage worker protocol/client/host、main composition、实例commit兼容点 | 受控白名单、CAS，禁止借新增安装任意操作 |
| UI | ModPanel.tsx、新 MaintenanceConfirmation.tsx | 物理文件选择、全声明影响、二次确认及准确结果 |

具体修改路径须在实施时按真实目录再核对，不在共享目录抢改。P-B负责准确任务目标/观察；P-D负责锁内环境及revision最终复核。P-C可先完成独立纯计算，公共契约/锁/worker修改在三个包设计对齐后串行合入。无新增第三方依赖；如需Windows原语适配另做评估，不预批。

## 7. 验收清单（全部尚未执行）

| 类别 | 必测场景与可观察结论 |
| --- | --- |
| 句柄 | 同名换字节/同字节换身份/改名/跨根同UUID/库存加文件/修订或Java变化→旧计划拒绝 |
| 依赖 | required阻止禁用；optional仅提示；循环反向链终止；替代provider/别名/多声明/嵌套/重复ID不漏判；unknown不可确认 |
| 名称安全 | .jar.disabled往返；目标同字节也拒绝；大小写冲突/双disabled/其他别名/链接/硬链接/重解析点/零identity拒绝 |
| 启停 | 已提交受管单JAR禁用→重开列表准确→新计划启用；SHA256不变、实例修订单次增加，旧fileId不作新句柄 |
| 运行互锁 | 游戏在运行、启动已持锁、另一写事务、旧owner未知→不写；维护持锁时启动不可spawn；锁内复核见P-D |
| 故障恢复 | prepared/恢复复制中/retained/applying/目标出现/源移走/JSON提交/索引/回执各点真实子进程中断；重开不丢原字节、不覆盖外部文件、不双提交 |
| 外部改动 | 哈希后换源、目标竞争创建、回退原名被占、恢复材料被换→保留证据并needsRecovery，不伪报回退成功 |
| 资源/权限 | 磁盘不足、读写拒绝、JAR被打开占用、同步失败、CAS超时/应答丢失→确定结果或可诊断未决，无后台悬空writer |
| 产品 | 双实例切换/旧报告/关闭窗口/重连、重复确认/过晚取消；展示准确目标与整JAR影响 |

批准后的每增量先局部测试，再运行仓库实际typecheck/lint/test/build；输出独立到本包 evidence/，构建若仍覆盖共享dist则等待独占时段。Windows文件夹具在本包独立临时子目录运行，不接触玩家实例。正式EXE/真实加载器启停验证另建获准测试根，保留历史矩阵未通过项。

## 8. 审阅决策点

1. 推荐先批准 V2a+上述 V2b 专用契约/独立记录域及保守单声明受管边界；另一选项只批准V2a，只交付预览，启停继续PENDING。
2. 推荐保留原字节、默认不自动清理，过期计划需重算；另一选项先明确容量/保留期和手动清理规则再实施事务，不能静默删除恢复材料。
3. Windows无覆盖移走及owner恢复若不能用现有底座证明，保持该执行段BLOCKED并提交具体适配设计；不能以“rename通常可用”补足证据。

此处是可审阅提案，未记APPROVED。依据仓库AGENTS §G2“架构、IPC契约、存储格式……发生变化时，必须重新征得明确批准”，新契约/恢复格式实施等待用户批准；本次文档交付已完成，无需为读取证据再确认。

## 9. 参考与复用

直接阅读本地参考库README/manifest及KAMUCL modManagement/modTransaction，固定提交 `30874ab871c8ee00c1edab275bb3aeb25704330b`。其copyFile EXCL、不覆盖目标、运行目录占用检查和外部变更保留材料有启发，但内存try/catch回退不等于OUCL持久恢复。未复制实现、素材或依赖到产品。参考库根MIT仅覆盖原创部分，逐文件产品移植仍需许可复核；本文不作许可洁净结论。证据文件记录所读副本SHA256及manifest匹配结果。
