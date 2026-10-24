# 从 XMCL 结构细化 OUCL 的计划

日期：2026-10-24。状态：**G0 / DRAFT / PENDING**。用户授权本轮分析新增参考仓库、完善AGENTS及计划文档；没有授权业务实现、依赖安装或整体基线冻结。

来源：[XMCL结构分析](../../../x-minecraft-launcher/STRUCTURE_ANALYSIS.md)，本地提交`b64e90f69`。本轮检查源码职责和代表调用关系；不照抄实现。以下是OUCL独立设计，不能当作XMCL已经实现或OUCL已经验证的功能。

## 1. 提炼出的结构调整

| XMCL观察 | OUCL方案细化 | 保持的边界 |
| --- | --- | --- |
| Electron宿主与Node runtime分开 | main仅做窗口/平台生命周期及显式依赖装配；services不导入Electron | IO留services/adapters；core依旧无真实IO |
| API独立包、按领域服务实现 | shared/contracts按领域归档；services按实例/安装/共享仓库/下载/Java/会话分目录 | 首版仍可单package；不自动建立monorepo或发布公共SDK |
| UI视图以外有组合式应用逻辑 | React页面外增加ui/hooks和ui/state，集中请求/订阅/显示状态 | 不迁移Vue/Vuetify；不让Zustand成为第二个权威业务数据库 |
| 安装协调与传输器适配分开 | 纯InstallPlan → 安装编排 → DownloadCoordinator → Store → 实例物化 | 不写巨型安装服务；1A只做原版，加载器后续增量 |
| ResourceManager分开哈希、URI、快照、平台元数据 | ObjectIdentity、Provenance、PathProjection、InstanceReference分别建模 | 本地SHA256不替代官方哈希；URI/inode/mtime只做索引提示 |
| 重任务worker与状态回传 | services/workers执行哈希/解析/解压工作，任务取消/退出有统一回收 | core只产生计划；不能把worker变成任意代码执行接口 |
| 服务状态同步与引用释放 | IPC快照+seq事件+dispose；主进程权威，UI只派生显示状态 | 不采用任意service/method/commit透传；仍按domain:action白名单 |
| 文件链接与目录链接语义不同 | 集中LinkAdapter/Materializer，记录实际模式，按文件可变性选择 | 优先用户要求的文件软链接；玩家数据私有，回退不可假装等价 |
| 测试包按需安装 | unit/contract默认轻量；集成与Electron E2E单独依赖与运行入口 | 实际脚本待骨架批准后创建，不借用XMCL命令当OUCL验证结果 |

## 2. 细化后的目录候选

保留原提案的core/services/ipc/ui/shared逻辑层。这里细化其内部职责，不创建目录，不更换技术栈。

```text
src/
  main/
    bootstrap/                    # 显式装配、启动顺序、逆序释放
    platform/                     # Electron窗口、选择器、系统安全存储适配
  shared/
    contracts/                    # 版本化domain:action DTO/schema/错误/事件
    locales/messages.ts
  core/
    version/ path/ hash-policy/ task/ launch/
    install/                      # InstallPlan/依赖图/操作顺序的纯模型
    store/                        # 对象身份、引用/投影/回收候选的纯策略
  services/
    install/                      # 编排和事务，不亲自实现每个传输细节
    download/                     # 共享传输、续传、消费者生命周期
    store/                        # 对象提交、索引、引用与租约
    instance/                     # 实例操作、物化/更新、运行锁
    java/ session/ account/       # 1A只启用离线账户
    workers/                      # 有界工作队列、取消、崩溃重启和清理
    adapters/                     # fs/http/process/clock/sqlite/crypto/link
  ipc/                            # preload动作封装、schema/sender/归属校验
  ui/
    pages/ components/ hooks/ state/
```

`main/platform`实现services需要的平台端口；端口本身不反向导入main/Electron。服务依赖通过显式工厂/构造参数装配，暂不引入装饰器DI容器、插件市场、远程实验开关。先保证单应用可理解、可测试，出现真正独立复用/发布需求后才通过ADR讨论拆包。

## 3. 下载、安装与去重的责任划分

| 模块候选 | 输入 → 输出 | 独占责任与验证重点 |
| --- | --- | --- |
| core/install | 可信解析结果、平台、布局、已有对象事实 → InstallPlan | 确定文件集合、可信摘要、依赖和后处理；无IO，旧版与缺元数据单测 |
| InstallCoordinator | InstallPlan、实例任务 → 安装结果 | 持锁、阶段顺序、失败恢复和提交点；不吞异常、不重复各下载器算法 |
| DownloadCoordinator | 制品身份、来源、消费者 → 共享传输句柄 | 同一制品single-flight、消费者取消、重启恢复；不是简单用Promise永久缓存 |
| ObjectStore | 已验证staging文件、可信来源记录 → 不可变objectId | 官方摘要核对+本地SHA256、原子提交、损坏隔离、事务恢复 |
| InstanceMaterializer | 实例文件清单、objectId、可变性策略 → 受管入口及引用 | 软链接/目录junction/获准硬链接/私有副本；替换和删除均不改共享本体 |
| ResourceIndex | 对象、URI、文件快照、来源 → 查询结果 | 可重建加速索引，不能提升来源信任；旧inode/mtime记录不跳过必需哈希校验 |
| WorkerExecutor | 固定任务枚举及受管对象/临时文件引用 → 结果/进度 | 并发/CPU预算、消息schema、最大输入、取消和worker退出；拒绝任意路径/脚本 |
| StoreMaintenance | 实例引用、会话/任务租约、备份保留项 → 回收/修复计划 | 标记扫描、宽限期、执行前重查；锁顺序、索引丢失时保守保留 |

区分“文件本体去重”“网络传输去重”“同路径overlay覆盖”三件事。多个实例可以有不同文件名/文件列表却引用相同内容；相同文件名不意味着共享。下载完成后才发现内容相同，能省磁盘却不代表这次网络流量已经省掉。

### 引用模型候选（字段/表名均未冻结）

- ObjectIdentity：本地SHA256、size、固定对象相对路径、校验状态；内容本体在FS。
- Provenance：官方/加载器预期摘要与算法、来源标识、验证时间和信任级别；不能因本地内容相同就洗成可信来源。
- PathProjection：rootId、逻辑相对路径、objectId；相同逻辑路径/不同摘要冲突不可静默覆盖。
- InstanceReference：instanceId、逻辑相对路径、objectId、可变性、实际materializationMode、generation；与实例JSON的权威引用清单对应。
- TransferConsumer / Lease：传输身份、消费者任务、活动引用与恢复记录；取消一个消费者不取消其余消费者所需传输。
- FileSnapshot：卷/文件身份、mtime、size等失效提示；不是信任依据，更不能只以ino做跨卷身份。

延续原存储基线：实例JSON清单是引用的权威事实，SQLite索引可重建；任务/租约/事务记录提供跨重启恢复。上述资源索引可与任务数据库分表或独立库，具体schema、迁移、锁和备份仍须存储ADR评审，不能把候选名当成已批准格式。凭证库保持独立职责。

## 4. 生命周期与契约补充

- 建议启动顺序：运行环境/登记路径 → 设置与迁移恢复 → 数据库及store → worker/任务/下载 → 领域服务 → IPC与窗口。每个阶段可以报告失败；不是按数组顺序创建一批互相等待的全局单例。
- 依赖不满足就禁用受影响能力；修复/恢复前不暴露可写实例。退出时拒绝新任务，写可恢复快照，按策略等待或中止工作任务，逆序释放worker/数据库/订阅。
- 游戏生命周期使用提案§7的D-19候选策略：运行中关闭窗口隐藏，实际退出前停止游戏；异常重启先核实持久会话租约。不从XMCL推断OUCL已支持退出后继续运行并接管。
- UI失去连接后重新握手、取快照并按seq恢复；任务终态能查询，监听器有dispose，组件反复挂载不得累计订阅。
- 内部对象仓库和worker不直接向UI开放任意路径/SQL。未来如增加缓存检查/修复/回收界面，先补命名动作IPC的完整schema、错误、取消与归属校验，再审批；本轮不往已提案通道偷偷加通用`store:execute`之类接口。

## 5. 排期统一入口

原有细分任务表已合并到[阶段0提案§4、§8](PROPOSAL_PHASE0.md)，该文档是唯一排期来源。S-09/S-10先验证链接和恢复，A1-04同时建立对象存储与最小worker，A1-05共享传输，A1-07实例物化，A1-09会话管理；不再把下载所需的哈希执行器推迟到游戏启动阶段。

1A复用官方JAR、库、assets及Java。Mod/资源包用假文件验证通用机制，产品能力仍按后续阶段交付；完整自动GC、仓库迁移界面和硬链接优化后移，避免把基础职责拆分误变成首版必须完成的大型平台。
## 6. 相关决策与下一步

补充ADR-003（工程结构）、ADR-004（IPC）、ADR-005（存储）、ADR-013（验证）、ADR-014（共享对象）；新增候选ADR-015“安装编排、后台工作任务与显式生命周期”。这些仍是待确认方案，没有变更已有批准记录。

推荐下一最小技术验证是S-09：用两个临时实例和同一份假JAR演示链接/更新/删除/私有化与权限降级，不接真实网络、不触碰存档。该spike只在用户明确启动后执行；本轮已经完成其具体输入、产物与验收设计，不把分析请求当成实现授权。
