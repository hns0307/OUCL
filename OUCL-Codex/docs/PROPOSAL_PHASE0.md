# OUCL 阶段 0：需求澄清与架构基线提案

编写日期：2026-10-24（Asia/Shanghai）。状态：**DRAFT / G0 / PENDING**。批准负责人：用户；暂无批准日期。

> 历史提案状态如上保留追溯。2026-10-24用户直接确认默认方案及阶段0工程启动，最新有效批准见DECISIONS末尾；[工程ADR](../../docs/adr/ADR-003-engineering-baseline.md)与[骨架验证](../../docs/validation/P0-08/REPORT.md)已经落地。下文“待确认/未执行”描述为提案编写时快照，不覆盖最新记录；设计方向批准不等于全部技术验收通过。

本文首次产物只有文档提案。下文的推荐、schema、任务和目录均未获基线批准；最新执行状态以[TASK_PLAN](TASK_PLAN.md)为准。2026-10-24另获用户指定授权执行[S-09](../../spikes/S-09/REPORT.md)，部分证据通过，文件软链接待补测；没有安装依赖或生成启动器业务代码。下文历史“本轮”描述指提案编写轮次，不代替最新执行记录。

> 当前修订入口：[计划审查与修订说明](DESIGN_REVIEW.md)。本文是阶段/IPC/排期的唯一当前草案；存储细节以STORAGE_LAYOUT.md为准，原始REQUIREMENTS.md保留作需求档案。所有新设计仍为PENDING。

## 0. 输入、仓库事实与参考设计

- 用户直接确认：项目位于当前工作区的 `OUCL/`；`KAMUCL/`、`PCL/`、`PCL1/` 可参考设计，不照抄源码。
- 实际 Git 根目录是 `OUCL/`，需求包在 `OUCL/OUCL-Codex/`。当前 `master` 尚无提交；需求包、压缩包及 `OUCL.txt` 均为已有未跟踪内容，原样保留。
- `OUCL/` 当前未发现应用 `package.json`、锁文件、构建配置或测试入口。本轮没有可运行的应用检查脚本。
- 本轮阅读项目 `AGENTS.md`、`REQUIREMENTS.md`、`DECISIONS.md`、`FIRST_TASK.md`；文档中的指令与方案作为项目约束/需求资料核对，不当成用户已经批准的决策。
- 首次任务按项目 G0 规则输出提案。建议将未来应用直接放在 Git 根 `OUCL/`，保留现有资料包；移动资料及调整根级协作规则须在骨架增量中单列，不在本轮执行。

### 0.1 参考设计的取舍与可追溯性

2026-10-24补充参考：用户新增XMCL并授权分析结构。已对其本地提交`b64e90f69`做代表源码链路静态核对，见[XMCL结构借鉴与OUCL计划细化](XMCL_ADAPTATION.md)；不复制其实现，也不把其运行能力当OUCL验证结果。下段“三个项目”指原有KAMUCL/PCL/PCL1，XMCL的证据方式另列。

参考材料是本地功能拆解文档。本轮未阅读、复制、移植这三个项目的实现源文件；材料自述的运行效果不等于 OUCL 的验证证据。

| 材料 | 阅读定位 | 借鉴的设计思想 | OUCL 独立设计及取舍 |
| --- | --- | --- | --- |
| [KAMUCL 功能树](../../../KAMUCL/docs/FEATURE_TREE.md) | 首页、游戏版本、资源管理、设置 | 启动入口聚焦实例；后台任务可见；失败可导出诊断 | 首版只显示首页、实例、任务、设置；后续能力按阶段启用 |
| [KAMUCL 功能拆解](../../../KAMUCL/docs/FEATURE_BREAKDOWN.md) | §1、§3、§4 | 分阶段启动准备、隔离目录唯一判定、迁移预览、取消等待收尾 | core 不承担 IO；独立的任务状态机和目录策略；不沿用其通用 IPC 暴露方式 |
| [PCL 功能拆解](../../../PCL/PCL源码功能拆解.md) | §4.1–4.7、§6.1–6.5、§12–13 | 可取消组合任务、进度聚合、设置元数据、日志脱敏 | 使用异步服务与事件；不移植轮询调度器、WPF 动画引擎或全局状态结构 |
| [PCL1 功能拆解](../../../PCL1/PCL1-功能实现拆解.md) | §2.5、§10.1–10.2 | 启动按钮状态、缓存优先、临时文件完成后替换、按需提权 | 按任务状态派生按钮；未知进度不伪造百分比；拒绝明文凭证、仅大小校验和忙等 |

后续每个实现增量记录“需求 → 独立设计 → 测试证据”；不从拆解文档转抄算法正文、代码片段、测试夹具或素材。第三方依赖和分发二进制另行检查许可证，用户允许参考设计不等于允许重新授权其代码。

## 1. 阻塞问题清单（全部待确认）

“阻塞”按受影响范围判定；未来功能缺少外部条件不阻止本轮提案。推荐值供用户裁决，不能自动生效。

| ID / 原因与影响 | 方案 A | 方案 B | 推荐默认值（待确认） | 是否阻塞开发 |
| --- | --- | --- | --- | --- |
| D-01 OS/架构：跨平台决定打包、路径、natives、Java 和 QA 成本 | Windows 10/11 x64；具体系统构建和 Electron 版本另定 | Windows/macOS/Linux 与 ARM64 同期 | A；Win10/11 分别验收，不承诺全部系统构建 | 阻塞基线/打包；不阻塞文档 |
| D-02 MC：“全版本”没有可复核验收上限 | 面向 client 清单设计广覆盖；分档发布已验证/候选/不支持 | 首版只覆盖用户指定社团常用版本，旧版后补 | A；1A 先验证 §2 样本，古早版独立兼容任务 | 阻塞支持承诺及版本解析验收 |
| D-03 Java：最低列 8/17/21，不能推断覆盖未来版本 | 检测/注册 8、17、21；未知要求显式拒绝并提示 | 首版仅手动添加 Java，自动下载后移 | A；按可信元数据和加载器约束交集选择；发行商待评估 | 阻塞 Java 安装服务及分发 |
| D-04 加载器：阶段一表述过宽 | 1A 原版、1B Fabric/Quilt、1C Forge/NeoForge、1D 修复 | 首版同时交付所有加载器和修复 | A；OptiFine 仅候选附加兼容项 | 阻塞范围冻结 |
| D-05 OAuth：缺少应用注册信息，设备码/PKCE 阶段冲突 | 阶段四 PKCE；本轮只规划风险验证 | 阶段 1A 纳入微软登录，并先提供真实外部条件 | A；公共客户端，无 client secret；注册参数和 MC 服务访问资格均待核实 | 阻塞真实 OAuth spike/阶段四；A 不阻塞 1A |
| D-06 联机：进程接口、许可、TUN 和签名未验证 | 优先验证 EasyTier 独立子进程 + 本机 RPC | 验证 Terracotta 的可用集成接口/二进制，或核实 terracotta-lib 的身份 | A 为研究优先级；未通过 spike 前不选定产品依赖 | 阻塞联机最终选型；不阻塞原版纯逻辑 |
| D-07 中继：无部署地址，不能承诺自动回退 | 可配置社团中继；默认空则禁用创建/加入房间 | 明确接受仅直连模式，失败即提示不可达，无中继承诺 | A；不读取工具默认公共节点、不硬编码公共中继 | 阻塞生产联机，非 1A |
| D-08 后台：没有部署、鉴权、审计定义 | 后台另立项；客户端先定义契约和 mock | 本项目扩展后台，先另审技术/运维方案 | A；mock 仅证明客户端契约，不证明生产交付 | 阻塞远程社团功能，非本地启动 |
| D-09 皮肤：上传托管存在服务和个人信息前提 | 后台/获准第三方托管；客户端预览和写配置 | 首次皮肤增量只做本地预览，不上传 | B 起步，远程托管后续单独批准 | 阻塞上传，非 1A |
| D-10 邮件：无发件服务和订阅规则 | 后台统一发送，客户端管理订阅 | 不启用邮件，只做启动器内公告 | B 起步；启用时选择 A，客户端不持 SMTP 凭据 | 阻塞邮件，非 1A |
| D-11 凭证：SQLite 不自动提供密文保护 | safeStorage 加密后存 SQLite 密文记录 | OS keychain 存秘密，SQLite 只存引用 | Windows 首选 A；加密不可用则不持久化、要求重新登录 | 阻塞账户持久化；1A 只有本地离线档案 |
| D-12 更新：缺少签名密钥、发布者和回滚设施 | 未就绪前禁用应用内安装更新；先签名验证 spike | 先就绪签名发布流水线，再对外启用更新 | A；准备好密钥后进入 B，不回退无签名更新 | 阻塞自动更新发布，非本地开发 |
| D-13 整合包歧义：导入/增量分发/全格式混用 | 另列 1E（候选）只做 Modrinth；其他格式评估后排期 | 阶段二先仅支持社团签名清单，格式导入另排 | A；CurseForge/HMCL/纯目录仍列候选，不擅自删除需求 | 阻塞导入范围，不阻塞 1A |
| D-14 编码授权歧义：基线批准后允许增量又禁止业务代码 | 基线只解锁骨架；用户明确启动一个业务增量 | 用户明确授权一个限定阶段，可按小步计划持续推进 | A；禁止把“批准基线”解释成全部开发授权 | 阻塞任何正式业务代码 |
| D-15 全版本例外：旧 natives/Java/x86 与 x64 目标冲突 | x64 优先，旧版兼容单独实验；未验证标候选 | 首版明确下限，例如 1.6.4，早期版本后移 | A；不能因隔离目录存在而宣称全版本兼容 | 阻塞全版本发布承诺，非架构文档 |
| D-16 阶段一基础体验与修复归属不清 | 1A 含本地设置/日志/基础主题；远程公告二期、修复界面 1D | 1A 同期加入远程公告及一键修复 | A；安装时必需哈希校验和缺文件提示仍属 1A | 阻塞 MVP 验收边界 |
| D-17 工程根位置：资料包比 Git 根深一层 | `OUCL/` 为应用根，保留 `OUCL-Codex/` 资料 | 在 `OUCL-Codex/` 内建立应用 | A；骨架前确认根级 AGENTS 与 docs 索引的整理方法 | 阻塞骨架路径，不阻塞本轮草案 |
| D-19 游戏生命周期 | 运行时关窗隐藏，实际退出先停止游戏 | 独立会话监督，退出后继续运行并支持接管 | A；降低首版进程/租约恢复复杂度 | 阻塞会话与退出契约，非文档 |
| D-20 离线身份 | 显示名与gameName分开，修改游戏名新建档案 | 游戏名直接作为唯一档案名，禁止改名 | A；游戏名允许集另验，保留稳定UUID | 阻塞账户契约，非其他纯逻辑 |
| D-18 工具/供应链基线：版本、schema/SQLite/测试库未定 | 基线先批准职责，依赖清单另行评审后建立骨架 | 在本轮就指定并审完全部工具与依赖 | A；没有批准版本、体积、维护、安全与许可前不安装 | 阻塞依赖安装；不阻塞提案 |

OAuth 的 `client_id` 是公共标识，不是秘密；仍需用户提供真实注册配置/管理权限。不得借用其他启动器的 client ID。没有实际游戏服务授权和有/无所有权账号验证，不宣称完整登录成功。

## 2. 假设与完整支持矩阵

术语统一：本提案“首版/MVP”仅指1A原版闭环；“阶段一”是1A–1D及候选1E的增量集合，不代表首版一次交付。安装过程中必需的摘要检查和失败重试属于1A；全盘完整性扫描/一键修复中心属于1D。微软账户归四期，1A只做离线档案；首版远程公告不作为验收项。

### 2.1 用于推导方案的假设（全部 PENDING）

| 假设 | 内容 | 不成立时的影响 |
| --- | --- | --- |
| A-01 | 首版指阶段 1A，可运行的 Windows x64 原版离线闭环 | 重新排期、修改验收矩阵 |
| A-02 | 延续 TypeScript strict / Electron / React / pnpm、Vite / esbuild / Zustand 暂定栈 | 重评进程边界与构建 ADR |
| A-03 | 用户数据来自明确登记的游戏根目录，不自动接管参考启动器目录 | 外部实例兼容/迁移另立任务 |
| A-04 | 无可用后台、中继、OAuth 注册资料和发布签名密钥 | 对应服务使用 mock 或禁用；生产能力 BLOCKED |
| A-05 | 网络、文件系统、进程和时钟都能由适配器替换 | 无法替换的模块先调整设计再实现 |
| A-06 | 整合包强制隔离；普通实例由全局默认值及实例覆盖决定 | 需同步改路径、IPC 与验收 |

“首版必须”以 A-01 为前提；本表没有一项代表已经实测支持。

| 能力 | 所属阶段 | 是否首版必须 | 依赖 | 验收标准（拟定） | 合规前提 |
| --- | --- | --- | --- | --- | --- |
| Windows 10 x64 / 11 x64（候选） | 0 / 1A | 是，待 D-01 | 固定 Electron/Node/打包版本，真实机器 | 两系统分别安装、启动、下载恢复、隔离验证 | 系统和运行时分发条件核对 |
| macOS / Linux / ARM64 | 后续 ADR | 否 | 各平台密钥库、natives、打包 | 各自单独测试，未测试前不宣称支持 | 平台签名/发行要求另审 |
| 原版 client 元数据：继承、rules、classpath、assets、natives | 1A | 是 | 可信元数据、纯逻辑测试、版本样本 | 缺父、循环继承、OS/action/features/client 规则、jar 回溯均有测试 | 合法获取资源；镜像不决定哈希 |
| 现代正式版样本：1.16.5 / 1.18.2 / 1.20.1 / 1.20.6 / 1.21.1（候选） | 1A | 是，样本待 D-02 | 实测合适 Java、GPU、natives | 每样本下载、启动到菜单、退出、重启，保留脱敏结果 | 不宣称这些是最新版本或完整列表 |
| 旧参数样本：1.6.4 / 1.12.2（候选） | 1A 兼容任务 | 待 D-02/15 | 旧参数解析、Java 8 候选、旧资源布局 | 使用可信清单构造夹具，再实机启动 | 不分发未授权历史文件 |
| 1.5.2 及更早、快照、特殊版本（候选） | 0 风险评估 / 后续兼容增量 | 否，待确认 | 独立参数/资源/natives适配；不能仅注入 appData 就算支持 | 各版本单列成功证据；无法运行列例外 | 未知元数据不执行未知代码 |
| Java 8 / 17 / 21：检测、手动注册、受管下载 | 1A | 是，待 D-03 | 发行商元数据/校验、解压安全、磁盘与架构检查 | 真正运行 java -version，匹配版本约束；取消/断网/损坏不登记 | 发行许可和下载源复核 |
| 元数据要求的其他 Java 主版本 | 后续兼容 | 否 | 新运行时评估 | 清晰提示不支持，不能静默改用 21 | 另审发行版本 |
| Fabric / Quilt | 1B | 否 | 原版闭环、可信加载器元数据 | 固定兼容样本安装启动，各自识别，不混为同一加载器 | 许可证及分发约束 |
| Forge / NeoForge | 1C | 否 | 安装器 spike、Java、隔离 staging | 每个版本系列独立通过；失败不污染已用实例 | 核对安装器/处理器与库的许可及信任来源 |
| OptiFine 附加兼容 | 后续候选 | 否 | 独立兼容方案 | 不并入基础加载器自动安装验收 | 下载与再分发许可另核 |
| 离线档案 | 1A | 是 | 本地 UUID/用户名策略、参数脱敏 | 重启身份稳定、切账号隔离、无购买验证伪装 | 仅单机或允许离线的服务器 |
| 微软 PKCE 正版账户 | 四期 | 否，待 D-05 | Azure/消费者账户、游戏服务资格、safeStorage | PKCE 回调与刷新；所有权和 profile 均验证；无所有权拒绝 | 平台条款与用户授权；无 secret |
| Authlib-Injector / 第三方认证 | 四期 | 否 | 提供商信息、可信 agent 制品 | 显示服务方与数据流；拒绝不可信可执行制品 | 用户知情、服务方条款 |
| 原版下载、任务进度、续传、重试、换源 | 1A | 是 | 可信清单、SQLite 元数据、网络适配器 | 200/206/416、ETag 变化、重启恢复、哈希不符、取消均覆盖 | 镜像不改变官方哈希 |
| 实例创建/复制/改名/删除/打开、隔离开关 | 1A | 是 | 路径策略、锁和恢复日志 | 隔离实例不串档；非隔离明确共享且按gameDir排他；共享库不被移动/删除；操作可恢复 | 删除先显示范围并确认，资料最小化 |
| 内存/JVM设置、启动、输出与退出码 | 1A | 是 | LaunchPlan、Java、游戏会话 | spawn 参数数组、无 shell；运行与退出状态可见 | 不在日志暴露令牌/路径 |
| 设置、脱敏日志导出、基础主题、任务中心 | 1A | 是 | 文案表、日志服务、IPC | 离线可用；主题可读、键盘可操作；导出预览 | 自动上报关闭；原始日志仅本地按需查看 |
| 完整性扫描与一键修复 | 1D | 否 | 可信清单与下载引擎 | 损坏定位、仅替换所需文件、修复可取消 | 不以镜像哈希重建信任 |
| 选定格式整合包导入/拖入 | 1E 候选，待 D-13 | 否 | 原版/对应加载器、格式适配、沙箱解压 | 首批 Modrinth 候选；overrides 安全合并、强制隔离、失败回滚 | 内容授权与下载平台限制 |
| CurseForge / HMCL / 纯 .minecraft 导入 | 后续候选 | 否 | 格式/API/依赖许可评估 | 各格式单独样本与异常清单，不声称全格式覆盖 | API访问与再分发许可 |
| 整合包签名清单增量分发 | 二期 | 否 | 另立后台、信任根、文件事务 | 签名/路径/压缩炸弹/空间/锁/回滚；运行中拒绝更新 | 内容授权和权限最小化 |
| 公告、活动、可选邮件 | 二期 | 否 | 后台 API / 邮件服务 | mock 契约测试与生产联调分开验收；缓存过期可见 | 同意、退订、删除；无附件分发 |
| 服务器列表与状态 | 二期 | 否 | SLPv1/v2、SRV、IPv6、网络限流 | MOTD 安全渲染、超时/包长限制、错误降级 | 仅状态查询，无连接代理 |
| 虚拟 LAN、房间码、虚拟 IP 直连 | 三期 | 否 | D-06/07、TUN/UAC spike、网络授权 | 两机授权网络入房/直连、退出清理；无中继不误报可回退 | 校园网书面许可、流量隐私说明 |
| 皮肤预览 / CustomSkinLoader / 远程托管 | 四期 | 否 | 本地渲染、获准服务与 Mod | 模型预览与配置；上传另验；离线兜底 | 上传同意、服务方与删除机制 |
| 成员绑定、报名签到 | 五期 | 否 | 后台鉴权与邀请码限流过期 | 绑定只用于社团权限，不改变游戏认证 | 不收学号/设备指纹；最小化身份信息 |
| 基础崩溃分析、主题完善 | 五期 | 否 | 脱敏日志、少量高频规则 | Java/内存/依赖/认证提示；原始日志可本地查看 | 不复刻完整规则库，不默认上传 |
| 签名更新/回滚、可选错误上报 | 0 spike / 五期产品化 | 否 | 签名密钥、发布设施、后台接收器 | 拒绝篡改/降级攻击；用户确认；错误恢复 | 上报默认关、同意后仅脱敏摘要 |

版本验收记录未来至少包含：来源与摘要、MC/加载器版本、Java完整版本和架构、OS构建、执行步骤、预期/实际结果、日志摘要、例外及日期。候选样本不等于兼容承诺；“全版本”是扩展目标，不是本轮已验证事实。

## 3. 客户端、后台与第三方服务边界

| 参与方 | 责任及接口依赖 | 安全/数据流 | 生产运行前提 |
| --- | --- | --- | --- |
| UI / preload | 展示档案/实例/任务，调用限定能力；不持令牌 | 本地 UI → 类型化 preload → 主进程；不暴露通用 invoke/on | 固定应用来源、CSP、contextIsolation/sandbox、Node禁用 |
| 客户端主进程与 worker | 网络、文件、Java、下载、进程、凭证、实例事务；worker 承接重任务 | UI 只拿不透明ID与脱敏结果；凭证仅在主进程使用 | 受管目录/文件锁、路径校验、安全可执行来源 |
| 社团后台（另立项） | 公告/活动/签名包索引、成员权限、报名、皮肤与邮件协调、上报接收 | HTTPS + 鉴权；签名私钥不进客户端；不接管 MC token | 部署域名、鉴权/限流/审计、删除与退订流程、签名运维 |
| Mojang / MC 制品服务 | 原版元数据、client/库/assets、正版服务 | 官方元数据确定目标摘要；镜像只传制品；不解析服务端清单 | 服务可用、来源及内容限制核对；离线使用已验证缓存 |
| Java / 加载器 / 资源平台 | 提供固定版本元数据与制品 | 可信来源 → 校验 → staging → 登记；第三方资源不直接执行 | 各自许可/API资格、安装器 spike、锁定版本 |
| Microsoft / Xbox / MC 认证 | 授权、token交换、所有权、profile | 系统浏览器 → loopback → 主进程；刷新令牌加密；不经过社团后台 | 有效应用注册、授权范围、真实游戏服务访问与测试账户 |
| 邮件/皮肤服务 | 后台发件、获准服务上传托管；客户端只消费 | SMTP 密钥仅后台；上传前同意，图片限大小和格式 | 服务商合同/规则、同意/删除/退订、安全域名 |
| 联机工具/社团中继 | 虚拟网卡与转发；客户端管理会话、配置地址 | 普通权限 UI → 主进程 → 限权子进程/RPC；驱动安装单独提权 | 许可/驱动签名、授权网络、中继运维与流量隐私 |

### 3.1 后台 API 草案（尚不实现）

| 接口 | 请求/响应摘要 | 验收与限制 |
| --- | --- | --- |
| `GET /api/v1/notices?cursor=...` | cursor（可选）；items `{id,title,bodyText,publishedAt,expiresAt}`、nextCursor、etag | 文本渲染；体积/分页上限；缓存过期可见 |
| `GET /api/v1/packs/{packId}/releases/{releaseId}` | 受限ID；签名 envelope `{schemaVersion,keyId,payload,signature}` | payload 的规范字节序列、过期/版本/撤销规则待 ADR；逐文件 path/size/hash/source |
| `GET /api/v1/events` / `POST /api/v1/events/{id}/registrations` | 活动列表；报名状态、幂等键 | 后台鉴权、限流、最少成员信息；不传游戏 token |
| `POST /api/v1/members/bind` | 邀请码、昵称；不透明 memberRef 与会话 | 邀请码过期/限流；不收学号/设备指纹 |
| `PUT /api/v1/notification-preferences` | 订阅开关、后台验证过的联系方式引用 | 明示同意、退订；客户端不发送 SMTP |
| `POST /api/v1/skins/upload-authorizations` | 大小、格式、摘要；短期上传授权和资源ID | 用户同意、大小限制、到期/删除；服务身份明确 |
| `POST /api/v1/error-reports` | consentVersion、脱敏摘要、客户端版本；reportId | 默认不调用；拒绝原始路径/token/全量游戏日志 |

后台共通错误 envelope：`{requestId,code,messageKey,retryAfterSeconds?}`；身份会话过期返回 401，权限不足403，限流429；不自动重试非幂等写。只对批准域名发送鉴权；跨域重定向剥离鉴权。开发 mock 与生产地址隔离；后台不可用时原版本地启动保持可用。具体认证机制、字段上限、签名格式与 API 版本仍待专门审批。

## 4. 风险 spike 与验收标准

本轮仅列计划。未来经授权放在 `OUCL/spikes/<编号>/`，各自 README 写来源/锁定版本、外部条件、复现步骤、脱敏结果和清理步骤；使用临时数据与假账号材料。不得被正式 src 导入，不使用玩家真实存档，不把 spike 结果直接标记为生产实现。

| ID / 主题 | 操作与外部依赖 | 成功判据 | 失败判据及后续 |
| --- | --- | --- | --- |
| S-01 Forge / NeoForge 安装器 | 固定两类安装器样本，在新 staging 根安装；记录 Java/制品来源/副作用；核验处理器依赖 | 能生成可解析 profile 和库，隔离启动；取消等子进程退出后清理；无目录越界 | GUI交互/无可用CLI/未知未校验处理器/写出根目录 → 停止该系列，记录人工安装或适配方案；不猜通用参数 |
| S-02 OAuth loopback + PKCE | 真实获准应用；先 mock，再系统浏览器/127.0.0.1 临时端口；仅接受注册允许的redirect；随机state/verifier | 一次性state、S256、错state/重放/超时拒绝；有所有权/无所有权和刷新均实测 | 未提供注册/服务资格 → BLOCKED；拿到 MSA token 不算完成 MC 登录 |
| S-03 EasyTier / Terracotta 与 TUN/UAC | 固定各自制品及许可证；两台授权机器；核实RPC鉴权、TUN驱动、公共节点默认、卸载 | 普通权限启动器；仅安装驱动提权；RPC仅回环且有会话鉴权/等价保护；两机IP直连；退出和卸载干净 | 不能禁用公共节点、未签驱动/许可不清/无安全RPC/无法清理 → 不集成；保留普通服务器直连 |
| S-04 签名更新 | 临时测试密钥与样包；测试 HTTPS/清单签名/包哈希/密钥轮换/版本约束/回滚 | 篡改、错key、过期、旧清单拒绝；中断可恢复；用户确认后切换、健康检查失败回滚 | 任何无签名安装通路或回滚运行未信任包 → 禁用产品更新 |
| S-05 清单信任链 | 从可用官方源采集固定样本；模拟镜像替换、重定向、哈希缺失、旧缓存 | 官方清单→version→assetIndex/文件的可用摘要均检查；来源记录可追溯；镜像不能覆盖expectedHash | 元数据缺可信摘要或链断裂 → 标不支持/人工评审，不以镜像摘要兜底；官方源不可读只报告未验证 |
| S-06a/b SQLite恢复 / 密文凭证 | 固定 Electron 版本和SQLite候选；Windows测试用户；仅假token；模拟提交中断、加密不可用、密文损坏 | 事务恢复；DB/WAL/SHM/备份/日志搜索不到假token明文；重启解密；异用户无法正常解密；不可用时拒绝持久化 | 明文落盘或失败回退明文 → 不通过；改OS keychain方案再审；不宣称防同用户恶意进程 |
| S-07 Windows路径与JSON/文件事务 | 测试中文/空格、保留名、大小写、junction、长路径、杀进程/磁盘满 | 规范根约束、staging原子提交、断电后旧/新版本至少一个有效，恢复不覆盖存档 | prefix绕过、跟随junction越界或混合状态不可恢复 → 阻塞实例操作 |
| S-09 受管链接与物化 | 两个临时实例、假制品、同/跨卷与受限权限 | 链接/复制模式明确，私有化/更新/删除不改另一实例 | 越界/共享对象被改 → 阻塞物化 |
| S-10 引用与恢复 | 假对象、临时DB、操作日志、会话租约和GC计划 | 各提交点中断恢复；索引丢失不误删；旧视图可解除 | 未知状态猜测提交/误删 → 阻塞存储 |
| S-08 旧版原版兼容 | 1.6.4/1.12.2，另测1.5.2候选；固定可信夹具、真实运行时 | 旧参数词法、资源布局、natives位数/排除、appData策略各有证据 | 仅参数可生成但实际不能启动 → 继续候选，不承诺全版本 |

S-06a只验证1A所需SQLite任务/操作日志的事务与损坏恢复；S-06b在四期前验证凭证，缺凭证平台测试不阻塞本地存储验证。S-06b验证的是“先用OS能力加密秘密，再把密文写SQLite”，不是给整个数据库自动加密。下载元数据不含token；账号/昵称作为本地必要档案，导出及日志仍脱敏。Windows safeStorage/DPAPI 不隔离同一登录用户下的恶意程序，见 §10 官方文档。

选型研究不等于安装授权。后续选定依赖前必须提交版本、用途、压缩/安装后体积实测、传递依赖、许可证、维护记录、安全公告和替代方案；本轮没有可报告的包体实测数据。SQLite 绑定候选需比较 Electron 内置运行时能力与原生绑定/worker 的 ABI、阻塞与打包成本。

## 5. 目录、模块、存储与安全草案

### 5.1 目录草案（仅文本，不创建）

内部职责以[XMCL借鉴方案§2](XMCL_ADAPTATION.md)进一步细化：增加安装计划/共享对象纯模型、services内的安装编排/store/worker/物化职责及main显式装配；保持React、core无真实IO和单应用候选，不复制XMCL的monorepo或通用方法派发框架。

```text
OUCL/                           # Git / 应用根，待 D-17
  OUCL-Codex/                   # 现有需求与本轮草案保留
  docs/
    adr/                        # 每份ADR含状态、备选、证据、批准记录
    contracts/                  # IPC、后台API、配置schema与迁移
    validation/                 # 支持矩阵、实机证据、复现步骤
  spikes/                       # 独立验证，不被正式源码引用
  src/
    core/                       # 纯逻辑：version/path/hash-policy/task/launch
    services/                   # IO编排：download/java/instance/auth/session/storage
    services/adapters/          # fs/http/process/clock/crypto/sqlite
    ipc/                        # handler、preload、sender/schema边界
    shared/                     # DTO、错误、schema定义、文案
      locales/messages.ts
    ui/                         # React页面/组件、Zustand显示状态
    main/                       # Electron启动、依赖装配、窗口生命周期
  tests/
    unit/                       # core：不加载Electron，不访问真实IO
    contract/                   # 请求/响应/事件、越权、兼容性
    integration/                # 临时目录、可控网络、子进程替身
    e2e/                        # 独立Electron与实机验收
  scripts/                      # 构建、发布、审计；批准后添加
```

依赖方向：`shared` 不依赖业务层；`core → shared`；`services → core/shared`；`ipc handler → services/shared`；`ui → shared + preload限定接口`；`main` 装配服务与 IPC。core 不导入 Electron、React、文件系统、网络、进程、系统时钟；计算需要的事实由参数注入。preload 不导入业务服务，不向页面传 Electron event。

`core → services → ipc → ui` 只表示职责分层，不按字面做循环导入。哈希流式计算、解压及磁盘空间探测在 services/adapters 或 worker；core 只比较输入摘要、生成校验与文件计划。目录纯计算也不能替代执行前的 realpath、junction/符号链接和根目录校验。

### 5.2 存储草案

2026-10-24用户补充要求：善用软链接，将实例的重复文件指向固定目录。详细布局与下载去重策略见[共享文件仓库与实例目录方案](STORAGE_LAYOUT.md)。这一方向已由用户明确提出；具体对象仓库、链接适配与回收schema仍是待实现草案。下表“实例私有”指独立命名空间与可写状态，允许其中只读制品的受管文件入口链接到共享对象。

| 数据 | 位置/形式（均由运行时解析，禁止机器绝对路径） | 一致性、恢复与版本 |
| --- | --- | --- |
| 全局设置/游戏根注册 | Electron userData 下版本化 JSON | schemaVersion；单写队列；同卷临时文件、flush、rename；Windows锁冲突有界重试；保留last-good |
| 实例元数据 | `versions/<id>/oucl.instance.json`，与上游 `<id>.json` 分开 | 不透明instanceId与目录/显示名分离；revision乐观锁；迁移先备份；未知新schema拒绝写入 |
| 下载任务 | userData 下 tasks.sqlite | 事务与恢复策略；仅元数据/索引，部分文件在fs；恢复前核对文件大小/ETag/摘要，不信DB即信文件 |
| 账号 | 1A离线档案使用版本化accounts.json；四期凭证迁移至独立accounts.sqlite（待D-11） | 1A无秘密；四期最少档案+密文+到期时间，迁移保留accountId；加密成功才写；WAL/备份同样不得含明文；删除策略含备份保留期限 |
| 缓存/共享对象 | 固定store中的按SHA256寻址对象，数据库仅索引；与源码仓库分开 | 可信来源校验后提交；相同制品合并传输；实例只读制品逐文件链接；可写文件保持私有 |
| 游戏资源 | `.minecraft/assets`、`libraries`可通过受管目录联接访问固定仓库路径视图；`launcher_profiles.json`留在本游戏根 | 根内共享，不复制/移动到实例；跨root同内容对象去重；删除实例不跟随链接删除共享内容 |
| 私有内容 | `versions/<id>/` 下 mods/config/saves/resourcepacks/shaderpacks/logs/crash-reports/options.txt/servers.dat/natives 等 | gameDir决定归属；screenshots同属gameDir；实例操作持锁；跨目录多文件操作有事务日志与恢复，不能假设一次rename包办 |

身份、隐藏继承记录与跨JSON/SQLite/文件系统提交协议详见[存储方案§1、§3.1](STORAGE_LAYOUT.md)。非隔离模式共用根玩家数据，不适用实例私有承诺；复制/删除不处理根存档，同gameDir排他运行。

隔离解析优先级建议：整合包强制隔离 → 实例显式覆盖 → 全局默认。整合包覆盖不得关闭隔离；启停普通实例隔离不隐式搬玩家文件，需要独立迁移计划和确认。全局默认建议开启，仍待确认。

路径和启动规则：隔离 `gameDir = versions/<id>`；非隔离回退游戏根；assetsDir始终根/assets，assetIndex取元数据id；classpath使用绝对路径，子jar缺失沿继承链找最近有jar祖先，禁止复制父jar；natives按实例生成，启动前在持锁和无运行会话时清理重建并遵守extract.exclude；Forge libraryDirectory固定根/libraries。1.13+与1.6–1.12分别适配arguments/minecraftArguments；1.5.x更早的appData与资源兼容先经S-08验证。隔离实例不能读取根mods/config/saves。

### 5.3 安全与用户界面基线（待批准）

- Electron：本地受信任应用来源；contextIsolation/sandbox开启、nodeIntegration关闭；CSP限制到本地资源；禁止任意导航/新窗口；外链主进程按协议/域名校验；远程公告不执行HTML脚本。[Electron安全建议](https://www.electronjs.org/docs/latest/tutorial/security)
- preload按动作暴露方法，不给任意通道、文件路径、URL或shell；schema在主进程重复校验；只受信任主frame可调用，sender销毁后撤销订阅及授权。
- 下载可信元数据与镜像传输分离；解压拒绝绝对路径、盘符、UNC、`..`、大小写碰撞、符号链接/junction逃逸、压缩炸弹；限制压缩/解压大小与条目数，拒绝未知可执行内容。
- 通过`spawn(executable,args,{shell:false})`等同类受控接口启动，参数使用数组，不拼shell命令；Java自定义参数禁止覆盖认证、classpath、gameDir等受管参数，并限制危险agent选项到另行批准能力。
- 本地日志分级结构化；token、用户名、UUID、路径、完整命令行默认脱敏；主进程持有秘密，渲染只拿账户摘要。游戏原始输出可能含敏感内容，只按需本地查看，导出默认脱敏且有预览。
- 更新/整合包签名校验独立于HTTPS和哈希；信任根由发行包携带，不从同一不可信清单临时下载；私钥不入仓库/客户端；回滚包也必须可信。
- 首版首页建议含当前实例/离线档案、主要启动按钮、最近任务与失败原因；实例页管理版本与隔离；任务中心展示阶段、字节进度、可取消状态；设置集中Java/内存/根目录/基础主题。无实例引导安装，未就绪禁止重复启动，未知总量用不定进度，不伪造速度/ETA。具体视觉稿后续独立评审。

## 6. 首批 core 纯逻辑模块

| 模块 | 职责与输入 → 输出 | 异常边界 | 必测样本 |
| --- | --- | --- | --- |
| version | 接受已验证的client文档映射、目标ID、OS/arch/features → ResolvedClientVersion、库/资源/原生库需求 | 缺父、循环、深度/大小超限、未知占位符、无client来源；不把服务端json当client；库合并按坐标/顺序规则，不通用深合并 | 三层继承、子库覆盖、父jar回溯、OS正则/架构、rules无匹配/顺序、features真假、旧参数、natives.exclude |
| path/isolation | 根路径模型、instanceId、隔离策略、继承jar候选 → GameLayout/迁移计划 | 保留名、分隔符、越界、冲突、整合包试图取消隔离；不做实际fs判断 | 中文空格、大小写、相似前缀、共享assets/libraries不迁移、两实例不串档、非隔离回退 |
| hash-policy | 可信摘要/大小、已计算摘要/大小、来源 → Verified/Mismatch/Untrusted | 算法不支持、摘要长度错、缺信任源、同大小内容不同；不读文件、不假装自己产生摘要 | 正确/错误SHA1与SHA256样本、size正确hash错、镜像篡改expectedHash、空文件、超安全整数 |
| task/scheduler | 任务图/并发预算、状态、事件、注入时间 → 新状态、待执行effects | 非法迁移、重复终态、依赖失败、取消完成竞态、过期attemptId；不启动网络/计时器 | queued→running→verifying→completed；pause/resume、cancel→清理完cancelled、重试退避、过期事件丢弃、恢复任务校验 |
| launch | ResolvedVersion、GameLayout、Java约束与探测结果、账号占位绑定、设置 → LaunchPlan `{executableRef,args,cwd,redactedPreview}` | 缺库/原生库、Java不匹配、内存范围错、未解析placeholder、参数冲突；不持久化实际token | 1.12.2旧参数、1.20.6新参数、含空格路径、Windows分隔符、不同gameDir、继承jar、natives、参数注入与预览脱敏 |

LaunchPlan使用敏感参数标记/占位值，主进程执行前临时绑定账户凭证，落日志仅用redactedPreview。离线档案的本地稳定UUID策略需随账户契约批准，不以用户名查询在线UUID，也不随网络变化改变身份。单元测试用独立编写夹具及来源明确的最小元数据，不复用参考启动器测试文件。

## 7. IPC 契约草案

### 7.1 共通schema与语义

以下为描述性schema，不是已生成的代码。所有对象严格拒绝未知字段；整型必须有限且在安全整数范围内；默认不接受null；ID字段为UUID或受控目录ID，不接受路径。候选边界数值需契约验收后冻结。

| 名称 | 精确字段/约束草案 |
| --- | --- |
| Request | `{contractVersion:1,requestId:UUID,payload:<通道schema>}`；有副作用的请求requestId幂等，内容不一致复用则拒绝 |
| Result<T> | `{contractVersion:1,requestId,ok:true,data:T}` 或 `{contractVersion:1,requestId,ok:false,error:AppError}`；拒绝堆栈与敏感details |
| AppError | `{category:system\|minecraft\|network\|biz\|validation\|auth\|permission\|disk\|cancelled,code:枚举,messageKey:受控文案键,retryable:boolean,traceId:UUID}` |
| RootRef / InstanceRef | rootId UUID；instanceId UUID；实际版本目录ID仅主进程映射；显示名1–80字符，MC版本ID来自已验证目录而非任意字符串路径 |
| TaskAccepted / TaskSnapshot | accepted `{taskId:UUID}`；snapshot `{taskId,kind,state,stage,revision,bytesDone,bytesTotal?,error?}`；state固定枚举，bytes非负安全整数，未知总量不填 |
| Page<T> | `{items:T[],nextCursor?:不透明字符串}`，limit 1–100，cursor长度≤512；不返回任意本地路径 |
| JavaRef | `{javaId:UUID,major:正整数,arch:x64\|x86\|arm64,source:system\|managed,available:boolean}`；仅x64作为首版目标 |
| AccountSummary | `{accountId:UUID,kind:offline\|microsoft\|yggdrasil,displayName:1–80字符,gameName?:字符串,ready:boolean}`；不含token、邮箱、原始UUID |
| Event | `{contractVersion:1,subscriptionId,seq:安全递增整数,taskId?,revision?,kind,payload:<对应事件schema>}`；不传Electron event |

通用错误：`validation.INVALID_ARGUMENT`、`validation.UNSUPPORTED_CONTRACT`、`permission.INVALID_SENDER`、`permission.OUT_OF_SCOPE`、`system.TIMEOUT`、`system.UNAVAILABLE`；下表补领域错误。表中timeout均指invoke等待/任务受理，不代表任意中止已运行IO。

### 7.2 首版候选通道（逐项待批准）

| 通道 | 请求payload schema | 成功data schema | 领域错误码 | 超时 / 取消 / 订阅 |
| --- | --- | --- | --- | --- |
| `app:handshake` | `{supportedVersions:[正整数]}` 长度1–4 | `{selectedVersion:1,capabilities:受控字符串[],sessionId:UUID}` | UNSUPPORTED_CONTRACT | 3s；无需任务/订阅 |
| `roots:list` | `{}` | `{items:[{rootId,label,available}]}`，label脱敏 | ROOT_UNAVAILABLE | 3s；无取消 |
| `roots:choose` | `{}` | `{selection:cancelled}` 或 `{selection:chosen,rootId,label}` | ROOT_OUT_OF_SCOPE、PERMISSION_DENIED | 原生选择器120s；用户可取消，不自动扫描别人的根目录 |
| `instances:list` | `{rootId,cursor?,limit}` | `Page<{instanceId,displayName,mcVersionId,isolation,state,revision}>` | ROOT_UNAVAILABLE | 5s；刷新替换旧request结果 |
| `instances:create` | `{rootId,mcVersionId,displayName,isolation:inherit\|on\|off}` | `TaskAccepted`，终态result `{instanceId}` | VERSION_UNSUPPORTED、NAME_CONFLICT、DISK_FULL | 3s受理；task取消/事件；先预留ID、验证完成才登记ready |
| `instances:copy` | `{instanceId,displayName,expectedRevision:正整数}` | `TaskAccepted`，result `{instanceId}` | INSTANCE_BUSY、DEPENDENT_INSTANCE、REVISION_CONFLICT、DISK_FULL | 3s受理；task取消，staging不覆盖源 |
| `instances:rename` | `{instanceId,displayName,expectedRevision}` | `{instanceId,displayName,revision}` | INSTANCE_BUSY、REVISION_CONFLICT | 5s；此操作只改显示名，磁盘目录改名另拟事务契约 |
| `instances:planRemoval` | `{instanceId,expectedRevision}` | `{planId:UUID,instanceId,summary:{privateFiles:非负整数,sharedFilesPreserved:true},expiresAt:ISO时间}` | INSTANCE_BUSY、DEPENDENT_INSTANCE | 5s；取消即丢弃plan |
| `instances:remove` | `{planId,confirmed:true}` | `TaskAccepted`，result `{removed:true,recoveryRef:UUID}` | PLAN_EXPIRED、INSTANCE_BUSY、REVISION_CONFLICT、DEPENDENT_INSTANCE | 3s受理；提交前可取消；先进受管回收区，实际永久删除为后续维护能力，首版保留回收区 |
| `instances:openDirectory` | `{instanceId}` | `{opened:true}` | INSTANCE_NOT_FOUND、PERMISSION_DENIED | 5s；仅打开登记目录，不接受URI/任意路径 |
| `instances:planIsolation` | `{instanceId,mode:on\|off,expectedRevision}` | `{planId,willMigrate:false,conflicts:受控摘要[],forced:boolean}` | INSTANCE_BUSY、ISOLATION_REQUIRED | 5s；仅预览，不隐式迁移；整合包禁止off |
| `instances:applyIsolation` | `{planId,confirmed:true}` | `{instanceId,isolation,revision}` | PLAN_EXPIRED、REVISION_CONFLICT、ISOLATION_REQUIRED | 5s；原子元数据写，无文件迁移 |
| `versions:catalog` | `{cursor?,limit,channel:release\|snapshot\|old}` | `{page:Page<{mcVersionId,type,releaseTime,status:verified\|candidate\|unsupported}>,fetchedAt:ISO时间,cached:boolean}` | CATALOG_UNAVAILABLE、UNTRUSTED_MANIFEST | 15s；允许用已验证缓存并返回缓存时间；无任务 |
| `java:detect` | `{rootId?}` | `TaskAccepted`，result `{items:JavaRef[]}` | JAVA_SCAN_FAILED、PERMISSION_DENIED | 3s受理；task取消；按限定探测位置异步执行 |
| `java:choose` | `{}` | `{selection:cancelled}` 或 `{selection:chosen,java:JavaRef}` | JAVA_INVALID、JAVA_ARCH_UNSUPPORTED | 120s选择器+10s探测；用户可取消；主进程实测，不信文件名 |
| `java:install` | `{major:8\|17\|21,arch:x64}` | `TaskAccepted`，result `{java:JavaRef}` | RUNTIME_UNAVAILABLE、HASH_MISMATCH、DISK_FULL | 3s受理；task取消/事件；来源由批准发行商策略决定 |
| `accounts:list` | `{}` | `{items:AccountSummary[]}` | STORAGE_UNAVAILABLE | 3s；无取消/订阅 |
| `accounts:createOffline` | `{displayName:1–80字符,gameName:非空字符串≤80字符}`；gameName实际允许集和兼容上限在D-20冻结 | `{account:AccountSummary}` | ACCOUNT_NAME_INVALID、ACCOUNT_CONFLICT | 3s；无任务；不代表正版认证 |
| `game:launch` | `{instanceId,accountId,expectedRevision}` | `TaskAccepted`，result `{sessionId:UUID}` | INSTANCE_BUSY、JAVA_INCOMPATIBLE、DEPENDENCY_MISSING、AUTH_REQUIRED | 3s受理；准备阶段task可取消；spawn成功后使用game:stop |
| `game:stop` | `{sessionId,mode:graceful\|force,confirmed:boolean}` | `TaskAccepted`，result `{sessionId,stopped:true,exitCode?:整数}` | SESSION_NOT_OWNED、CONFIRMATION_REQUIRED、STOP_UNSUPPORTED | 3s受理；graceful最多等10s后报告需强停确认，不自动强杀；独立订阅任务 |
| `tasks:list` | `{cursor?,limit,state?:受控状态枚举}` | `Page<TaskSnapshot>` | TASK_STORE_UNAVAILABLE | 3s；只列当前窗口有权恢复的任务；重载后用于重新订阅 |
| `tasks:get` | `{taskId}` | `TaskSnapshot`及终态`result?`（按kind判别联合） | TASK_NOT_FOUND、TASK_NOT_OWNED | 3s；无取消 |
| `tasks:control` | `{taskId,action:pause\|resume\|cancel}` | `{taskId,accepted:true,state}` | TASK_NOT_OWNED、INVALID_TASK_STATE、CANCEL_TOO_LATE | 3s；取消只是请求，等最终cancelled；非下载任务可拒绝pause |
| `tasks:subscribe` | `{taskId,afterSeq?:非负整数}` | `{subscriptionId:UUID,snapshot:TaskSnapshot,seq:非负整数}` | TASK_NOT_OWNED、CURSOR_EXPIRED | 3s；原子取快照并订阅；返回seq之后推送event |
| `events:unsubscribe` | `{subscriptionId:UUID}` | `{removed:boolean}`，重复调用安全 | SUBSCRIPTION_NOT_OWNED | 3s；卸载组件主动调用、窗口销毁自动清理 |
| `settings:get` | `{}` | `{revision,rootId?,javaId?,memoryMiB:整数,isolationDefault:boolean,theme:system\|light\|dark}` | CONFIG_CORRUPT | 3s；仅白名单，无任意JSON透传 |
| `settings:update` | `{expectedRevision,patch:{rootId?,javaId?,memoryMiB?:512–65536整数,isolationDefault?,theme?}}`，至少一项 | 同settings:get | REVISION_CONFLICT、MEMORY_OUT_OF_RANGE、ROOT_UNAVAILABLE | 5s；还需按实际物理内存/Java能力验证，非仅范围通过 |
| `logs:read` | `{sessionId,cursor?,limit:1–200}` | `Page<{time,level,messageKey,text:脱敏文本}>` | SESSION_NOT_OWNED、LOG_UNAVAILABLE | 5s；每页总大小限制，无原始路径与堆栈 |
| `logs:export` | `{sessionId,redact:true}` | `{selection:cancelled}` 或 `TaskAccepted`，result `{exported:true}` | EXPORT_DENIED、DISK_FULL | 120s保存选择器；写出受理后task可取消；导出前预览 |

表内缩写错误统一按AppError分类，如HASH_MISMATCH属于network或minecraft的固定映射，INSTANCE_BUSY属于biz，DISK_FULL属于disk，最终映射表需在契约冻结时逐项列齐。失败的异步任务通过TaskSnapshot.error返回，invoke已受理不等于成功。

离线档案分开UI显示名displayName、游戏名gameName与稳定accountId。游戏UUID创建时按冻结策略生成并持久化；显示名修改不改变gameName/UUID，修改gameName创建新档案，保留旧档案及身份。80字符只是传输保护上限，不是兼容承诺；具体游戏名字符/长度需D-20测试冻结，不能将任意显示昵称直接注入游戏参数。

### 7.3 时序、安全与兼容策略

补充会话契约（草案）：SessionSnapshot为{sessionId,instanceId,state:running|stopping|exited|unknown,revision,startedAt,exitCode?}，不暴露PID或路径。sessions:list {cursor?,limit}返回Page<SessionSnapshot>，sessions:get {sessionId}返回快照，sessions:subscribe {sessionId,afterSeq?}返回{subscriptionId,snapshot,seq}，事件kind为session:changed、payload为SessionSnapshot。均3s响应、按应用档案授权，错误包括SESSION_NOT_FOUND/SESSION_NOT_OWNED/CURSOR_EXPIRED，取消订阅统一用events:unsubscribe；只读操作不改变游戏进程。game:launch任务完成仅表示进程已启动，不代表游戏已到菜单；后续退出由会话状态跟踪。

首版退出策略（D-19待决）：游戏运行时关闭窗口隐藏应用；真正退出必须先请求停止游戏，graceful失败不自动强杀，用户未确认则保留主进程与租约。异常重启对持久化会话核实进程身份，不能只凭PID判断或终止；无法核实则标unknown并保留租约、禁止关联实例的删除/更新/GC，待人工恢复。首次实现不承诺“退出启动器后游戏继续运行且仍能完整接管”。

1. UI只用批准的方法。主进程每次检查`webContents`身份、主frame、完整应用origin、请求schema、对象归属与根目录登记；只检查URL字符串前缀不合格。路径选择与文件打开都由主进程处理；授权绑定窗口会话，不接受renderer指定可执行文件。
2. 对长任务：受理后返回taskId。网络请求建议连接15s/无进展30s，有界重试并尊重Retry-After；整个安装可长于30s，UI展示真实状态。取消通过AbortController传播，所有写入/子进程收尾后才置cancelled；提交点后返回CANCEL_TOO_LATE而非假取消。
3. invoke超时表示结果未知，不表示任务停止。有副作用请求先按同一requestId重试恢复既有受理结果；主进程持久化幂等映射到任务记录，避免超时重试制造第二个实例。异常重启后将in-flight写入标为需恢复，不盲目重放。
4. `tasks:subscribe`原子登记监听并返回snapshot/seq。preload先装事件接收器并进行有界缓冲（最多256条或1MiB，超限重新取快照），收到响应后按subscriptionId交付；进度可合并到最多10次/秒；seq按每个订阅实际发送的事件递增，内部revision允许跳号；终态持久可查询。seq断档或CURSOR_EXPIRED则重新取snapshot；终态保留可查询。
5. preload封装订阅方法返回本地dispose函数，内部调用events:unsubscribe；关闭窗口自动清理。取消订阅不取消任务。窗口重载后通过任务清单恢复策略重新授权订阅，不向其他窗口广播凭证/日志。
6. 兼容：handshake协商整数major；不支持返回UNSUPPORTED_CONTRACT并停用相关能力。major内只允许已定义的可选能力，strict schema不接受未知新字段；新增字段需能力协商或升级major，两端及preload同步升级，并保留一版迁移测试。
7. 共享传输的pause/cancel作用于当前消费者：暂停保留需求与恢复记录，取消解除该消费者；只要有一个active消费者底层传输继续，全部paused才暂停底层，全部解除才取消。实例任务不能借tasks:control直接控制别人的共享传输。任务归属绑定应用档案，窗口session只用于调用授权；重载重新授权，不能因webContents销毁丢失持久任务。
8. 未来的`auth:*`、`packs:*`、`network:*`、`updates:*`不在本批白名单，不注册空壳假成功。各阶段先补完整契约再审批。本轮没有实现任何通道。

## 8. 阶段 0 / 1A 可执行任务拆解

执行跟踪见[任务安排与阶段验收表](TASK_PLAN.md)：沿用本节编号，将A1-04拆为a–d子任务，并列出后续阶段工作包、当前状态与证据模板。本提案仍负责设计依赖；任务表不构成开工或验收通过记录。

每行是一个工作包，实施时再拆成可验证增量；例如A1-04依次做持久化/恢复、对象仓库、执行器和IPC边界，分别验收；只有“本轮文档”已经执行，其余都是计划。对架构/IPC/存储/安全/第三方/联机变更继续按项目规则重新审批。

### 8.1 阶段 0

| 顺序 / 任务 | 产物 | 前置审批及依赖 | 验证方法 |
| --- | --- | --- | --- |
| P0-01 资料与现状核对（本轮） | 本提案、参考取舍、待决记录 | 用户给定工作区；读取现有资料 | Git/文件清单、文档结构和链接核对；无应用测试可跑 |
| P0-02 裁决范围及原文冲突 | 用户实际批准记录、矩阵修订 | 用户按主题批次裁决D-01–20 | 引用用户原文/日期，无沉默默认批准 |
| P0-03 依赖与spike执行方案评审 | 固定工具/库候选、体积/许可/维护/安全清单 | 用户明确允许预先准备/spike；D-18；不先安装大包 | 检查上游版本与许可证、包体测量计划、可替代性 |
| P0-04 基础风险验证 | S-05/06a/07/09/10报告；S-08按首版旧版范围条件执行 | P0-03；所选SQLite运行时/临时卷可用 | 临时目录/假token/受控网络；逐项成功失败证据 |
| P0-05 外部集成风险验证 | S-01/02/03/04/06b分阶段验证报告 | 对应依赖、OAuth应用、授权网络、测试密钥；缺项标BLOCKED | 真实环境录证；外部条件不足不伪造通过 |
| P0-06 契约与ADR收敛 | 冻结候选目录、IPC、存储、安全、联机/阶段范围 | P0-02/03/04的本地证据；P0-05仅对应拟冻结能力，联机延期仍须D-06明确裁决 | 契约字段/状态/取消竞态/兼容性评审 |
| P0-07 G0基线审批 | 明确的APPROVED记录及剩余例外 | 用户明确批准六类基线；D-06需有可接受的选型证据或明确批准延期策略 | 逐项检查批准出处，不把推荐值写成结论 |
| P0-08 G1构建骨架 | 根级规则整理、空目录/类型/空IPC、构建/测试基础设施 | G0通过、D-17/18、骨架范围明确批准 | 先定义实际脚本，再执行类型检查/lint/空契约测试/构建；不实现业务 |

若希望原版1A先行而联机最终选型仍待spike，用户可明确裁决“冻结联机边界、阶段三前再做最终产品选型”；这是对当前G0六项要求的显式调整，必须记录，不能自行当成已经满足。

### 8.2 阶段 1A（仅规划，需 G1 业务授权）

本节统一吸收XMCL参考后的排期，不再维护平行任务表。S-09验证受管链接/复制回退；S-10验证对象索引/引用/恢复与回收安全策略，两者属于P0-04。1A只发布最小闭环，完整自动GC、仓库迁移界面、硬链接优化后移；首版保守保留无引用对象，不能宣称已经自动释放空间。

| 顺序 / 任务 | 产物 | 前置审批与依赖 | 测试/手动验收 |
| --- | --- | --- | --- |
| A1-01 纯版本解析 | 继承/rules/库/资源/natives计划与错误码 | G0+明确启动该业务增量；D-02/15 | 无IO单测：循环/缺父/库覆盖/OS规则/features/新旧参数 |
| A1-02 路径与隔离纯策略 | GameLayout、jar回溯、隔离优先级与文件计划 | A1-01、批准路径/存储schema | Windows边界夹具；断言共享目录不进入实例迁移/删除列表 |
| A1-03 哈希策略与任务状态 | 摘要比较、调度状态机、进度/取消模型 | 批准任务schema和错误映射 | 内容同大小不同hash、并发预算、取消竞态、旧attempt、重复终态 |
| A1-04 存储及IPC基础能力 | JSON/任务SQLite/操作恢复日志、ObjectStore及可重建索引、最小有界worker、sender校验与选择目录 | S-06a/07/09/10、已批依赖和契约 | 临时目录损坏恢复/磁盘满；SQL事务；非法sender/未知字段拒绝 |
| A1-05 原版目录与下载闭环 | catalog、core/install纯计划、共享传输消费者、并发/续传/重试/换源 | A1-01–04、S-05、真实来源可用 | 本地可控HTTP：200/206/416/ETag变化/429/断网/哈希错/取消；重启恢复 |
| A1-06 Java服务 | 发现/选择/探测/安全下载注册 | D-03、发行依赖审批、A1-05 | 假探测器单测；实测8/17/21候选；架构错/包损坏/取消不登记 |
| A1-07 实例事务 | InstanceMaterializer、创建/复制/改显示名/删除预览与可恢复删除/open/isolation；不含自动GC | A1-02/04/05；删除与迁移契约明确 | 两实例并发、依赖祖先保护、运行锁、中文路径、失败回滚、共享资源保留 |
| A1-08 离线档案与LaunchPlan | 稳定离线身份、JVM/MC参数数组与脱敏预览 | 账户字段/UUID/参数策略已批，A1-01/02/06/07 | 重启身份稳定；内存/Java不匹配拒绝；含空格路径；认证参数不出日志 |
| A1-09 游戏会话 | 复用A1-04执行器准备natives、会话快照/事件、进程拉起/停止、退出与异常重启租约 | A1-08、S-07/08可用范围 | 子进程替身；真实候选原版到菜单/退出；重复启动、准备取消、停止确认 |
| A1-10 最小UI及本地体验 | 首页/实例/任务/设置、日志预览/导出、基础主题 | 已批IPC、A1-04–09；视觉方案按小步评审 | 键盘导航、错误/取消/空状态、禁重复启动、切页退订/重载恢复、有界事件缓冲、显示链接或副本模式、长任务界面可交互 |
| A1-11 交付验收 | 固定支持矩阵、手动复现证据、已知例外、打包产物 | 前述已过且用户授权打包发布范围 | 实际脚本的typecheck/lint/unit/contract/integration/build、依赖/许可审计；Win10/11分别复验 |

覆盖率阈值提案：core行/分支各≥85%，不是已配置门禁；关键安全及状态边界必须具名单用例，不能只追覆盖数字。每个增量只跑适用检查，最终闭环再跑完整实际脚本。后台/OAuth/联机未就绪不伪装成功，不阻止获准的本地1A范围。

## 9. ADR 清单（按优先级，全部 Proposed / PENDING）

本轮用登记表表达 ADR 草案，尚未创建已冻结 ADR 文件；每项批准负责人均为用户，无批准时间。

| ADR | 待决事项/关联决策 | 选项 | 推荐（待确认） | 影响范围 / 批准负责人 |
| --- | --- | --- | --- | --- |
| ADR-001 | 门禁/阶段/源文歧义，D-04/05/13/14/16 | 基线后逐增量明确启动；或阶段级限定授权 | 逐增量授权；1A离线、四期PKCE、导入另排 | 全项目范围 / 用户 |
| ADR-002 | 平台、MC/Java支持，D-01/02/03/15 | 广覆盖架构+验证分档；或固定版本白名单 | Windows x64、样本驱动、有例外的广覆盖设计 | 解析/运行时/打包/QA / 用户 |
| ADR-003 | 栈、工程根与依赖，D-17/18 | Git根应用；或资料包内应用；栈维持或替换 | Git根应用、维持暂定TS/Electron/React栈，依赖另审 | 构建、目录、协作规则 / 用户 |
| ADR-004 | 分层与IPC | 动作白名单+schema；或通用invoke自行分散校验 | §5/7强边界、任务/订阅与major协商 | main/preload/ui/core / 用户 |
| ADR-005 | 实例与事务存储 | JSON+任务SQLite+FS缓存；或统一数据库 | §5混合存储；原子提交与恢复；资料不挪动 | 配置、实例、下载、迁移 / 用户 |
| ADR-006 | 信任源、解压与签名 | 官方摘要锚定+镜像传输；或信任镜像元数据 | 官方锚定；缺可靠摘要显式不支持；签名独立校验 | 下载/运行时/包/更新 / 用户 |
| ADR-007 | 凭证持久化，D-11 | safeStorage密文SQLite；或OS keychain+引用 | Windows先测safeStorage；失败不明文回退 | auth/storage/备份与日志 / 用户 |
| ADR-008 | 联机集成，D-06/07 | EasyTier子进程RPC；或Terracotta可验证接口 | 先验证EasyTier，备选Terracotta；无结果不锁依赖 | 三期、许可、TUN/UAC、清理与隐私 / 用户 |
| ADR-009 | 后台与个人信息边界，D-08/09/10 | 独立后台；或项目内后台另审 | 独立API，默认本地皮肤/应用内公告，邮件后启 | 二/四/五期与生产运维 / 用户 |
| ADR-010 | 微软认证，D-05 | 四期PKCE；或1A设备码/PKCE | 四期PKCE、系统浏览器和loopback验证，无secret | 身份、所有权、刷新与UI / 用户 |
| ADR-011 | 更新信任与密钥，D-12 | 完备签名流水线后启用；或先禁用更新 | 先spike、未就绪禁用安装、用户确认更新 | 发布、密钥轮换、回滚 / 用户 |
| ADR-012 | 导入格式/事务，D-13 | 选定Modrinth增量；或二期仅社团清单 | 候选1E Modrinth，其余格式单列验收 | 格式适配、资源权限、staging / 用户 |
| ADR-013 | 测试与可观测 | 分层可替换IO+真实平台闭环；或以手测为主 | 单元/契约/集成/实机，脱敏与拒绝路径测试 | 工程门禁、CI、覆盖率 / 用户 |
| ADR-014 | 共享对象、软链接与下载去重，用户明确提出方向 | 按内容共享+独立实例链接；或全部复制的兼容模式 | 优先受管软链接；Windows目录junction，写入前物化私有副本；细节见STORAGE_LAYOUT.md | store/下载/实例/回收/迁移与链接安全 / 用户；方向已确认，细节待核验 |
| ADR-015 | 安装编排、后台工作任务与显式生命周期 | 分层安装计划/协调/传输/物化；或单一领域大服务 | 拆职责、显式装配、worker有界与可回收；XMCL_ADAPTATION.md记录边界 | core/services/main/任务取消与依赖顺序 / 用户；PENDING |

## 10. 外部依据与证据限制

查阅日期：2026-10-24。仅引用上游官方文档/仓库；具体版本锁定与制品审计仍待spike，在线文档不等于安装成功证据。

| 依据 | 本提案使用范围 |
| --- | --- |
| [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) | 隔离、sandbox、CSP、sender验证和受限桥接的基线；具体安全实现仍待测试 |
| [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) | OS密钥保护；Windows同用户进程不在隔离保证内；当前文档建议异步API，实际按锁定版本核验可用接口 |
| [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) | 授权码+PKCE的协议基础；不据此推断MC/Xbox服务访问已获准 |
| [EasyTier上游](https://github.com/EasyTier/EasyTier) | 候选工具身份；不据此承诺RPC、驱动签名或全平台可用 |
| [Terracotta上游](https://github.com/burningtnt/Terracotta) | 上游自述基于EasyTier，AGPL-3.0-or-later且列出特定未修改二进制/IPC使用例外；实际库与分发制品适用条款仍需逐项核实 |
| [NeoForge client installation](https://docs.neoforged.net/user/docs/client/) | 上游安装器存在客户端安装流程；不是所有系列支持同一无头CLI的证据 |
| [Adoptium archive installation](https://adoptium.net/installation/archives) | Temurin归档提供SHA-256与GPG校验信息，可作为Java供应候选；未选定依赖/版本 |

官方MC清单端点 `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` 本轮浏览工具未能读取，**没有获取实时清单或验证版本制品**。提案中的版本都是候选样本。Terracotta主仓的名称/许可信息不证明需求所写“Terracotta-lib”是同一可用接口，S-03必须核实，不能套用猜测的库名/版本。

## 11. 本轮结果与批准边界

### 本轮已确认的事实

1. 实际Git根为 `OUCL/`，尚无提交；现有资料保留，本轮仅新增提案、追加待确认记录。
2. 用户允许参考另外三个启动器设计，明确禁止照抄源码；本轮只阅读其功能设计/拆解资料。
3. 当前输入包含阶段/认证/导入/全版本/编码门禁歧义，没有用户批准记录。
4. 本轮未建应用、未执行spike、未安装依赖，未跑或虚构构建/类型检查/lint/业务测试。

### 用户仍需决定的项目

- D-01–20按审查说明§3归组选择方案或修改；尤其确定“首版=1A”、版本样本/旧版例外、微软登录/导入阶段与编码授权边界。
- 六类基线：架构职责、目录根、IPC、存储、安全、联机选型。可以分项审阅，但未批准项不得标完成；联机延期也需用户明确调整门禁范围。
- 后续是否先授权P0-03及指定spike；真实OAuth/校园网/签名条件可在相关阶段提供，不能捏造。

### 当前门禁 G0 / PENDING

所有推荐值与ADR均待确认。本文不是最终架构，也不是开工授权；完成文档后停止，不自动推进实现。

### 批准后允许做什么 / 仍禁止做什么

| 条件 | 允许 | 仍禁止 |
| --- | --- | --- |
| 当前G0，只完成本轮文档 | 阅读、比较设计、维护本轮提案/待决记录 | 正式业务代码、安装大依赖、宣称已获批准 |
| 用户明确授权预先准备或指定spike | 限定范围的spikes、验证/骨架材料；不进入正式业务路径 | 将spike当产品实现、借机扩大第三方依赖或外部操作 |
| 六类基线实际批准、进入G1 | 按批准目录/契约建立共享类型、构建、测试骨架 | 未获明确启动的业务实现；自动开始全部阶段 |
| 用户明确启动某一业务增量、进入G2 | 该增量简短计划、实施、适用验证与文档同步 | 超范围功能；未经再审批更改架构/IPC/存储/合规/依赖/联机选型 |

暂停依据：现有项目 [AGENTS.md](../../AGENTS.md) §2 G0要求“禁止正式业务实现代码”；[FIRST_TASK.md](../prompts/FIRST_TASK.md) 要求“完成以上内容后停止，等待用户逐项确认与批准”。这是项目已有明确门禁，不是将附件推荐方案当成用户授权。
