# P-D：有效 Java 与锁内最终启动复核

日期：2026-10-29；2026-11-10首片已批准并实施，验证和未完成项见 [IMPLEMENTATION-20261111.md](IMPLEMENTATION-20261111.md)。以下保留历史方案及审批时状态。2026-11-10续审修订优先见 [REVIEW-20261110.md](REVIEW-20261110.md)，尤其提交许可后失败必须保留 needsRecovery，不可称普通失败。产品基线：研究报告标记 b87be9d；本文件以当前工作树直接读取结果为准。仅本目录新增文档；不修改公共源码、TASK_PLAN、DECISIONS、依赖、分支或玩家数据。

## 1. 授权与本包边界

仓库既有业务处于 G2；本次分聊授权仅限本包具体设计、证据核对及独立研究。以下内部接口/装配变化尚待明确批准，不把既有1A授权或本次分聊解释为批准新架构。无新第三方依赖；首片无新增持久格式、无实例 Java 覆盖、无公开 IPC。有效值 UI 如需新字段，另以本文件第8节冻结契约后批准。

目标：检查依据的精确 Java 与实际启动候选可追溯；启动持有现有 gameDir 租约后重新核对实例、安装输入、激活库存和最终 Java，失败不 spawn、不偷锁。P-A 的真实游戏矩阵、P-B任务投影、P-C Mod维护、P-E整包不在本包实施范围。

## 2. 已有证据，无需重复制造同一复现

- [REPORT §9/§10](../../validation/RESEARCH-OBSERVATION-20261029/REPORT.md)：真实选择器/JavaProbe配模拟child，优先A17.0.1需2500ms，B17.0.13需5ms；检查2秒预算读到B，runtime默认8秒读到A。合成 `>=17.0.10` 得到 satisfied / unsatisfied。无真实Java、网络、磁盘登记或游戏。
- [Java原始结果](../../validation/RESEARCH-OBSERVATION-20261029/java-selection-result.json)：metadataReads=0、downloads=0、模拟registrations=1；所有模拟探测已结束。不能称某真实Mod兼容故障。
- [R02原始结果](../../validation/RESEARCH-OBSERVATION-20261029/launch-revision-result.json)：真实LaunchService/GameProcessService、真实文件租约，模拟存储/预检/Java/child；expectedRevision1预检后变2，模拟spawn1次，close后锁释放。没有真实ModTransaction提交或游戏。
- 当前代码仍对应这些原因：`mods/java-facts.ts`独立排序已登记候选、2秒probe；`java/runtime.ts`另行发现/下载、默认8秒probe，并调用会再次probe且设置selectedJavaId的registerJava；`launch/process.ts`再probe，但仅比较major/architecture，之后才open(wx)目录锁。多次probe不是同一份准确环境承诺。

本包不把“统一超时”或“再加锁外readInstance”当修复。时间预算可以统一，但必须绑定候选并以最终实测版本评估约束。

## 3. 精确改动地图（待批准后按片执行）

| 文件 | 拟变更与目的 |
| --- | --- |
| `src/services/java/effective-environment.ts`（新） | 主进程短生命周期选择事实服务；只读resolveRegistered、显式prepareForLaunch、绑定验证；无IO进入core |
| `src/services/java/runtime.ts` | 复用候选优先序与测量结果，返回运行准备事实；保留发现/官方下载边界；不让检查隐式下载或登记 |
| `src/services/mods/java-facts.ts` | 适配同一只读选择器，返回测量事实；兼容原read返回值的过渡不作为最终接口 |
| `src/services/mods/context.ts` | 增加内部明确环境输入路径，锁内复核传入最终Java事实，禁止重新运行另一套Java选择 |
| `src/services/mods/inventory.ts` | scan新增内部environment绑定选项或单独scanBound入口；继续双读context/目录/逐JAR摘要，保留256/4096/8MiB上限与未知判断 |
| `src/services/launch/service.ts` | 先准备环境，捕获授权revision/布局/库存基线；装配最终复核闭包；失败保留现有任务错误路径 |
| `src/services/launch/process.ts` | 在唯一一次现有锁取得后调用受信finalize；用返回的最终plan/runtime同步start；保留token核验释放及close拥有权 |
| `src/services/install/installer.ts`、`install/launch-inputs.ts` | 提供明确的锁内只读复验入口；不在该入口下载/修复/重新取gameDir锁；复用可信摘要验证，不绕过安装器证明 |
| `src/services/launch/profiles.ts` | 内部listSnapshot返回现有记录revision；为受控登记传入signal并等待probe close；不新增持久字段 |
| `src/main/index.ts` | 显式装配同一有效环境服务与最终复核；不得把renderer回调传入process服务 |
| `tests/java-runtime.test.ts`、`mod-java-facts.test.ts`、`game-process.test.ts`、`installer.test.ts` | 覆盖选择绑定、锁内修订/文件变化、取消、失败释放；新增测试文件只在范围需要时建立 |

这里列出的新文件/签名是候选设计，不宣称已存在或已经实现。源码路径相对仓库根，证据链接相对本文件。

## 4. 有效环境模型与选择语义

内部瞬态 `EffectiveJavaFact`：javaId、executable（主进程私有）、major、version、vendor、architecture、来源registered/discovered/official、profileRevision、selectionKey、实测时间。selectionKey绑定候选顺序及偏好，不以时间戳或保存banner充当测量。可执行文件常规身份/摘要变化视为失效；Java完整目录不可凭单个exe摘要认定不可变。

候选策略保持现有已选兼容Java优先、其他已登记候选按稳定顺序；不改成最高patch，不新增实例覆盖。共同probe预算建议8000ms/候选，仍遵守现有候选数量上限；2秒只能作为UI等待阈值，超时后显示未确认，不能切到B后声称它就是将启动的A。所有调用可取消并等待探测子进程close；总时长不承诺为8秒，候选多时显示准确等待并允许取消。

建议内部接口（类型定义在主进程services，无路径进入shared）：

- `resolveRegistered(major, signal): Promise<EffectiveJavaFact | null>`：只读、无发现/下载/登记；无事实返回null，不复用历史version。
- `prepareForLaunch(major, consumerId, signal): Promise<EffectiveJavaFact>`：允许既有发现/官方下载/登记；登记完成后重新取得profileRevision，明确这可能改变全局selectedJavaId（现有行为），不能把变化前快照继续当有效。
- `revalidate(fact, signal): Promise<EffectiveJavaFact>`：只探测同一executable，不重新选择；版本/架构/身份变化即失效，不自动换B。失败后由玩家发起新尝试，原任务不换授权目标。

读取检查必须把版本与候选身份作为一组；同一候选顺序相同但两次测量结果不同，也不得把上次satisfied套到新版本。原Mod计划/报告持久格式本片不扩展：历史结果仅代表当时观察，启动重新本地复核，不承诺长期有效。平台事实缺失仍unknown；锁内不为补平台事实联网。

profiles并发：准备前后读现有envelope revision，忽略本任务登记前的旧revision，以登记完成后快照作为基线。最终复核开始和结束均核对该revision及selectedJavaId；用户主动切换则REVISION_CONFLICT。未引入profile共同锁时，结束读到同步spawn间仍可能有外部/其他异步提交；启动使用已经绑定的确切候选，语义定义为本次启动快照，不宣称实时全局偏好线性一致。若要求偏好提交与spawn绝对互斥，需要另批profile读写租约。

## 5. R02最小方案：现有锁拥有者内最终复核

推荐A：GameProcessService继续唯一拥有gameDir锁。内部launch options增加必须的 `finalize(runtime, signal): Promise<FinalLaunchInputs>`；FinalLaunchInputs含最终LaunchPlan及绑定的Java事实。通过独立方法/必填类型让生产启动不能漏传；迁移直接调用的验证脚本和测试，不留下默认空回调。callback只能由主进程装配，不是IPC/renderer传函数。

过程：

1. LaunchService按请求expectedRevision读取ready实例、根及账户，做现有prepareLaunch和Java准备；形成锁外基线（rootId、revision、规范gameDir、安装元数据摘要、激活/禁用JAR库存指纹、Java选择事实、配置/账户快照）。锁外基线是变化检测输入，不是最终授权。
2. GameProcessService完成候选初测与目录守卫，对基线gameDir只open(wx)一次，写token/sync/close。已有锁直接INSTANCE_BUSY；不排队等待/按年龄删除。
3. 在原try/release保护区内执行finalize：重读root/instance，核对ready、请求revision及modCommitId/元数据摘要；重新派生布局与已锁目录必须一致。revision变化直接REVISION_CONFLICT，不静默改用新revision。
4. 锁内只读重验安装器来源、classpath、assets、native等既有启动输入。现有prepareLaunch的reopen路径是否写入临时证明需逐调用核查，不能未经核查直接把整个方法当只读finalize；需修复时退出本次启动，另任务处理，不在锁内安装。
5. 只探测绑定Java同一路径，取得最终完整version；使用明确注入的这一事实构造ModEnvironment（Minecraft/loader/language同样从本次复验取得），重新扫描真实库存并比较基线fingerprint。禁止scanBound调用旧java-facts再次选择另一个Java。
6. 用当前激活集合运行现有本地约束比较器；unsatisfied或unknown均不给本次启动绿灯。未知归因沿现有错误集合映射JAVA_INCOMPATIBLE或DEPENDENCY_MISSING/LAUNCH_FAILED，详细原因暂限脱敏内部证据；若需新增公开原因码须另批。此保守门禁可能使含未知声明实例无法启动，批准时需明确接受此行为，不能悄悄将unknown改成satisfied。
7. 复核末尾再次确认root/instance/profile快照及目录身份；由本次复验材料重建plan，检查cwd等于持锁目录，检查取消。finalize返回后进程服务立即同步start，中间不再await任务存储/网络；使用同一最终runtime.executable、精确版本与plan。
8. child创建后接管现有会话close观察；spawn事件为提交边界，close后才核验token并释放。保存session失败不得把真实进程当未启动并提前释放。

`FinalLaunchInputs`不含锁token；callback不能release/claim，不能调用GameProcessService.launch递归。Installer fileTail只串行其自身文件工作，不是跨Mod事务锁。锁顺序为gameDir → 有界只读worker/存储查询；准备任务不持有fileTail再等待gameDir；锁内复验不得等待一个需要同锁才能完成的Mod任务。实现前必须审计所有调用方，否则此项阻塞实施。

真实外部编辑不遵守OUCL租约：双读与摘要能拒绝观察到的变化，但不能承诺最后检查至OS打开JAR/Java之间的恶意修改原子隔离。要完全隔绝需要不可变运行快照/OS文件句柄策略，属于额外存储与架构提案，本片不暗含此承诺。

## 6. 取消、失败和释放表

| 边界 | 必需行为 |
| --- | --- |
| 排队/下载/Java准备中取消 | 持久取消后abort；等待自有连接/worker/probe close；尚未取得gameDir锁，无release |
| 取得锁前取消 | 不claim；若open已成功则进入同一owned清理路径 |
| token写入/sync失败 | 关闭句柄；不能证明token属于自己则保留现场NEEDS_RECOVERY，不能unlink空/外来锁 |
| finalize取消、revision/摘要变化、磁盘/worker失败 | 等待在途自有只读工作退出，再按目录守卫+token释放；spawn=0；释放失败优先NEEDS_RECOVERY |
| finalize中SCAN_BUSY | 不共享错误的其他扫描结果；本次受控失败并释放，不无限等待 |
| start同步抛错 | 释放本次token；映射LAUNCH_FAILED，释放失败NEEDS_RECOVERY |
| child已创建但尚未spawn收到取消 | 不以abort先删锁；继续等spawn/error与真实close，按提交边界决定CANCEL_TOO_LATE/失败；必要停止必须遵守既有明确确认规则 |
| child error / close | error后仍等close；close后释放；不能仅因PID不存在猜测退出 |
| spawn后持久化失败/应用关闭 | 保留活会话拥有权，不提前release；任务进入需恢复语义，应用按现有保活规则处理 |
| 外来token/链接替换/进程退出未知 | 不删锁、不按时长接管，NEEDS_RECOVERY并保留证据 |

现有LaunchService在processes.launch之前先发verified、进入committing，应在实施时核对取消状态机：不能把长时间finalize放在不可取消committing里。候选将长复核留在可取消阶段，finalize结束后以受控提交许可完成持久verified再start，并再次核对取消/快照；该持久等待期间仍持锁，之后需再做末尾校验。不能仅移动事件而破坏现有状态机；这是首片必验项，未通过不得宣称取消闭环。

## 7. 与共同租约方案的比较

A（推荐）：现有GameProcessService锁内finalize，ModTransaction已使用同名锁；不改租约文件格式，不重复claim，触及启动装配与只读验证拆分。代价是回调生命周期和提交事件需精确测试。

B：抽取GameDirLease为共同服务，LaunchService持有并把同一拥有权转移给会话；Mod/安装/恢复统一使用。可系统表达锁层级，但涉及多域恢复、token所有权、交接失败、跨实例共享gameDir和关机，改动更大。若选B，GameProcessService必须提供接受已拥有租约的入口，不能再open(wx)；交接前后都只能一个释放责任方。

本包不为A预先重构B；A的最终验收必须与真实ModTransaction争用同一个gameDir锁，不能只靠内存队列证明互斥。

## 8. 公共有效值展示：独立后片，PENDING

首片可仅修内部正确性，沿用现有Java列表，不新增UI“当前有效”承诺。完整产品后片建议只读 `profiles:effectiveJava`（候选名），请求instanceId+expectedRevision，响应严格判别 `measured | unavailable | stale`；measured仅给javaId、major、完整version、architecture、来源枚举、observedAt与实例revision，不给路径、vendor原文、锁token或任意原因文本。版本字符串沿现有受限parser；所有对象exact且限制长度。

sender/root/UUID/schema校验沿原adapter；只读调用不发现/下载/登记、不创建安装任务；取消仅取消观察/探测，等待child close；请求超时不能遗留无人拥有probe。不得直接复用现有3秒invoke期限发起最多128×8秒扫描：后片需冻结可取消异步查询/有界单候选策略及迟到应答清理，超时展示unavailable而不写selectedJavaId。未完成该契约前不增加此通道或广告能力。展示“本次测量”而非永久保证，启动仍重新复核。

不新增缓存JSON/历史报告字段；若要将环境快照绑定Mod持久计划，另提版本化schema、迁移、过期和重开策略，不以可选字段绕审批。

## 9. 验证矩阵与证据分层

| 层级 | 用例与断言 | 不能替代 |
| --- | --- | --- |
| 选择器+模拟child | 原2秒/8秒场景保留；同major不同patch；单候选失效不换候选沿用判断；取消等待close；登记二次probe差异；profile切换拒绝/明确快照 | 真实JVM |
| 真实两服务+真实锁/模拟仓库 | R02 revision1→2必须spawn0且自有锁释放；同revision换JAR摘要拒绝；锁定目录与新布局不同拒绝；finalize缺失不可调用生产入口 | 正式存储事务 |
| 正式storage worker+ModTransaction | 暂停点插入合法Mod提交，启动锁前提交→冲突；启动已锁→Mod写入拒绝且文件/修订不变；Mod先锁→启动INSTANCE_BUSY；非隔离不同实例同gameDir同样互斥 | 游戏可玩 |
| 真实Java/独立根 | Java8/17/21完整版本输出、选择失效、自动准备登记、重开；精确版本与约束比较证据；不依赖外网完成已有缓存读取 | Mod已实际加载 |
| 产品/游戏（与P-A协调） | 正式IPC入口、取消/重开；代表原版及四加载器实际菜单/Mod/退出证据 | 全矩阵验收 |

故障注入：锁写/sync失败、外来token、finalize worker异常、取消与verified交错、start抛错、error延迟close、spawn后session写失败；断言无未退出探测子进程、无外来锁删除、无错误completed。额外外部编辑用例只声称检测到的窗口，不声称OS原子隔离。

实施批准后先局部测试，再实际typecheck/lint/test/build；共享工作目录不得直接运行会覆盖dist/.test-build的脚本。先与其他包约定独立checkout或为本包配置输出到 `docs/work-packages/P-D/evidence/`，确认后才跑。当前交付仅文档和输入哈希核查，不宣称pnpm check已运行。

## 10. 待批准的具体决策与下一最小片

D1推荐A锁内finalize及只读验证拆分，替代为B共同租约；两者均需内部架构批准。D2推荐共享测量策略/同候选绑定，替代为仅在最终实际Java上重新评估（能守启动防线，但检查解释仍不一致）。D3推荐启动遇本地运行约束unknown时阻止并解释，替代为明确风险确认策略（须另冻结确认契约，不能默认放行）。公共有效值通道、持久环境快照暂不批准/不实施。

下一最小片：取得D1/D2/D3明确批准后，先实现内部绑定与锁内复核及服务级负例，再补真实storage/ModTransaction互斥；公共有效值展示独立审批。不能以本文件交付将R02或Java差异标为已修复。

### 10.1 提交许可的冻结顺序（补充第6节）

为避免把“核对状态机”留作实施时猜测，A采用两阶段内部握手：process.launch的finalize在锁内完成耗时复核后，调用LaunchService提供的 `commitPermit(signal)`；该方法通过现有job.changes串行队列检查最新Execution，若已接受cancel则拒绝，若仍可提交才发送verified并等待其持久化。cancel与permit必须共享同一队列裁决，不能先check后另行排队留下空隙。permit成功后取消返回CANCEL_TOO_LATE；这表示本次启动已进入受控提交，不表示spawn已经成功。

permit等待期间仍持gameDir锁。permit返回后再次读取root/instance/profile并核对与复核材料一致，检查目录身份及已扫描文件stamp；若变化则不spawn，任务从committing按现有failed/cleaned路径失败（须以真实状态机测试证明这些转移合法）。不能在permit后切换候选/重新下载/重新规划。末尾校验失败可安全放弃启动，不能因为取消太晚就硬启动。最后的只读校验之后同步start；其外部编辑限制沿第5节保留。

process.launch选项因此实际含两个主进程必填能力：finalize与commitPermit。前者只产出验证结果，后者只裁决并持久化提交；两者都不接触租约所有权。prepare阶段移除当前过早的verified事件，transferred可保留在环境准备完成位置。若现有task machine不能表达此序列，则停止实现并提交确切状态机增量审批，不新增隐藏终态。


