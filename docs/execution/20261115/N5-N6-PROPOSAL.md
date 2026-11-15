# N5 在线工具隔离与 N6 社团分发：待审查方案

日期：2026-11-15（Asia/Shanghai）。基线 main `05309ed7`；本轮执行依据为 [交接文档](../../EXECUTION_HANDOFF_20261115.md)。本文件只交付设计，不修改生产代码、公共接口、存储格式、依赖或批准记录。N5/N6 均为 **PROPOSAL / BLOCKED_FOR_IMPLEMENTATION**，以下默认值须明确批准后才能实施。

## 1. 真实能力与缺口

| 真实代码 | 已有能力 | 不能据此推定的能力 |
| --- | --- | --- |
| `src/main/index.ts` 的 `createWindow` / `trustedSender` | 本地主窗口 preload；严格文档/主 frame/session 身份；禁导航、新窗口及 webview；默认 session 权限全拒绝 | 没有远程工具视图、工具 session、工具白名单或工具 IPC |
| `src/ui/index.html` | `connect-src 'none'`，本地脚本、样式，图片仅 self/data | 不允许为嵌入网站放宽主窗口 CSP |
| `src/ipc/preload.ts` 的 `bridge` | 固定 `window.oucl` 能力集合 | 不能把这个 preload 复用给远程页面，也没有通用 invoke/任意 URL 入口 |
| `src/core/distribution/manifest.ts` | 严格信封解析、规范 payload 字节、`DistributionSource`、纯 `distributionDiff` | 解析不等于验签；diff 不等于执行许可；没有产品 HTTP 分发源 |
| `tests/fixtures/distribution-source.ts` 的 `distributionTestSource` | 注入内存信封和临时公钥的真实 Ed25519 验签 | 测试适配器不进产品；临时密钥不是社团信任根 |
| `src/services/mods/preparation.ts` / `transaction.ts` | `ModInstallPreparation.prepare`、`ModTransactionService.commit/recover`，计划绑定、独占、复验与新增 Mod 提交 | `ModTransactionService` 明确 **add-only**；不支持通用 replace/remove、配置覆盖或社团包事务 |
| `src/core/packs/fixed-preview.ts` / `src/shared/contracts/packs.ts` | 固定 SHA-256、1355 字节样本及严格只读公开预览 | 不是通用 mrpack 导入/安装器，不是签名远程分发入口 |

`docs/contracts/MOD_TRANSACTION.md` 部分历史段落仍称“尚未接公共确认”；当前实际装配以 `src/main/index.ts`、`docs/contracts/MOD_PUBLIC_INSTALL.md` 和交付记录为准。其恢复不变量仍可参考，不能按历史文字误判当前 Mod 安装没有接线。

## 2. N5：一个受控在线工具视图

### 2.1 决策与输入条件

| 决策 | A（推荐） | B | 影响与当前状态 |
| --- | --- | --- | --- |
| 第一批形态 | 同一主窗口中的单个独立 `WebContentsView`，按下表隔离 | 暂只提供固定、经审核的外部浏览器入口，嵌入延期 | A 有内嵌体验但新增主进程能力；B 不交付内嵌，仍需审核外链策略。两者均未实施 |
| 数据与登录 | 每次打开创建独立非 `persist:` 分区，不承诺保留登录；首个站点不依赖登录、上传或下载 | 后续另批专用持久分区和站点登录方案 | 推荐 A，避免首版引入凭证持久化；不能因此宣称匿名、无跟踪或站点可离线 |
| 站点选择 | 用户给出一个工具 URL/用途，核对许可、所需资源来源和网络行为后批准固定记录 | 无明确站点时仅验收本地合成 HTTPS 页面，产品入口保持禁用 | 推荐先确定真实站点；当前站点、许可和依赖来源 **未提供**，不得猜测支持 |

本节 API 名称核对自当前已有 Electron 45 类型 `node_modules/electron/electron.d.ts`（`WebContentsView`、`WebContents.close`、导航事件、permission handler）；没有联网研究、启动网站或进行实际视图验证。

### 2.2 主进程与渲染分工

拟由主进程 `OnlineToolService`（候选名称，尚未创建）拥有固定工具记录、session、view、生命周期和受控状态；React 只显示本地标题/来源、加载状态、返回/重试/关闭按钮。**远程网页不承载本地导航和确认控件**。首版同时最多一个 view，工具数固定，不能运行用户提供的 JS、插件包、任意网址或 Electron 参数。

工具记录拟含固定 `toolId`、显示名文案键、入口 URL、精确主文档 origin、资源 origin 清单和版本。此为主进程审查配置，不是可写用户持久格式。入口只接受 HTTPS、无 userinfo、固定端口/路径；不接受 file/data/javascript、自定义协议、回环/局域网地址和未审查跳转。资源来源须区分主文档和子资源，不能把 CDN 允许项自动变成可导航网站。

主进程使用专用 `session.fromPartition` 创建内存分区，创建 `WebContentsView` 时显式传入该 session；**不设置 preload**，`contextIsolation:true`、`sandbox:true`、`nodeIntegration:false`、`webSecurity:true`、`allowRunningInsecureContent:false`、`webviewTag:false`。不复用默认 session、应用 profile 或主窗口 WebContents。`sessions` 的受信窗口表不登记远程 WebContents，`trustedSender` 仍按现有本地文档规则拒绝其全部业务请求；新增工具 handler 也只能由本地主窗口调用。

### 2.3 必须一起实现的策略

| 边界 | 推荐具体行为 | 验证要求 |
| --- | --- | --- |
| 初次加载/重试 | 仅主进程从固定 toolId 取得入口，统一审查后 `loadURL`；事件监听不能替代这次显式检查 | renderer 伪造 URL、工具 ID、未来字段均拒绝；重试不能扩大来源 |
| 导航与 frame | `will-navigate`、`will-frame-navigate`、`will-redirect` 按精确策略检查；新窗口一律 deny；禁止 webview 附着 | 同源允许；跨源、HTTP 降级、file、非主 frame 导航、重定向链分别测试。`about:blank` 等内部过渡仅可按实际类型专项处理，不全局放行 |
| 子资源/后台请求 | 专用 session 的 `webRequest` 同时约束请求来源/协议；未知来源阻断，包括未列出的 WebSocket/worker 请求；不放松主 CSP | 测试 CDN 资源与主导航权限分开、跳转后仍审查、被拒绝请求有受控原因；动态资源清单不足就标站点不兼容 |
| 权限与本地设备 | 同时配置 `setPermissionRequestHandler`、`setPermissionCheckHandler`、`setDevicePermissionHandler` 拒绝；屏幕捕获、证书选择、设备选择和文件选择入口专项拒绝，不假定 permission handler 包办所有入口 | 摄像头/麦克风、剪贴板读写、通知、USB/串口、屏幕捕获、文件上传、全屏/指针锁均须验证不可越权；缺少可靠拦截就不接入需要该能力的站点 |
| TLS/认证 | 不安装忽略证书回调，不响应客户端证书/HTTP 认证挑战，不共享应用 Cookie，不注入用户凭证 | 证书错误、401/证书选择均安全失败，不变更 `createDesktopFetch` 的信任或主窗口网络策略 |
| 下载与外链 | 专用 session `will-download` 立即阻止，取消已开始项；不弹另存为，不转业务下载器；弹窗及外部协议默认拒绝 | 点击链接、响应 attachment、blob 下载、弹窗下载分别验证；未来允许导出或外开 URL 需另批策略 |
| 布局与焦点 | view 仅占本地工具内容矩形；主进程约束到内容区，保留本地来源/关闭条；离开工具页立刻移除并关闭；弹本地对话框前先移除 | 720px 窄窗、窗口缩放、侧栏变化、键盘切页与关闭均不遮挡本地确认；renderer 不能用任意矩形覆盖导航 |
| 生命周期 | 打开/关闭和 load 请求有代次；页切换、文档 reload、窗口 destroyed、进程退出、renderer crash 统一收尾。detach 后调用 `view.webContents.close({waitForBeforeUnload:false})` 并观察 destroyed；不得仅 removeChildView 留后台运行 | 远程 beforeunload 不能阻止关闭；旧 load/error 回调不能更新新工具；真实销毁后再释放引用，错误/超时如实保留 |
| 数据清理 | 关闭后对专用 session 有界清理 storage/cache，不宣称存在“销毁 Session”API；清理失败报告受控状态，下次使用新分区 | 不触碰主应用或其他分区；下一次打开没有旧 Cookie/服务 worker；检查无遗留 view/WebContents 和任务 |

文件上传拦截、子 frame 和 worker 网络覆盖必须在所选 Electron 版本按实际可用入口验证，不能只配三项权限回调就声称权限隔离完整；这属于实施准入条件。

### 2.4 待批公共契约与文件边界

主界面要控制主进程 view，因此需要**新增公共 IPC**。本方案暂不给生产通道/schema；批准第一批策略后再提交精确 `tools` 契约：打开（仅固定 toolId）、状态、重试、关闭、受控布局/可见性、订阅/退订。所有请求必须延续 contractVersion/requestId、主 frame/sender、精确 schema、稳定幂等身份、代次、超时和关闭回执语义；结果只返回工具身份、受控阶段/错误、修订，不能返回 session、WebContents、原始 URL/HTML/路径或通用执行句柄。打开超时不能隐式重开；状态查询恢复原请求；关闭结果未知不能宣称后台已结束。

拟修改边界为 `src/main` 独立 view/service 装配、专用 `src/shared/contracts`/`src/ipc` 契约、React 工具页和文案、纯来源策略/生命周期测试。主窗口现有 CSP、安全参数、应用 preload、业务 handler 不向远程页扩权。候选名称和文件边界不等于已批准 schema。

**N5 当前阻塞：**首个站点和允许来源尚未确定；新增 view/session 权限设计及公共契约未获具体批准。可批准上述 A 方向并先做合成站点安全验证，也可选 B 延期嵌入。审批应分别包含站点记录和精确公共契约，不以“执行 N5”代替字段/权限审核。

## 3. N6：内容所有权与签名分发

### 3.1 已有契约能证明什么

`parseDistributionManifest` 拒绝未知字段/未来格式；目标固定 MC/Java major/加载器/版本；最多 256 操作、每文件 1 GiB，区域仅 mods/resourcepacks/config；路径复用 `installRelativePath`，大小写重复和父子冲突拒绝。`canonicalDistributionPayload` 对验证后对象固定键序列化。`parseDistributionEnvelope` 只检查 Ed25519/keyId/base64 结构。

`distributionDiff` 最多接受 4096 个观察；add 遇现有同名或父子重叠报 EXISTS；replace/remove 同时核对 managedId 和旧 SHA-256，分别报 UNMANAGED/CHANGED；任一冲突使 changes 整体为空。keep 不执行，清单遗漏不删除本地文件。该纯函数不读取磁盘、不检查签名、会话、真实来源、JAR 或租约；给它伪造观察即可产生伪预览，所以 renderer 不能提供权威 observation。

### 3.2 所有权模型草案（不是持久 schema）

| 类别 | 来源证据 | 更新规则 | 不允许的推断 |
| --- | --- | --- | --- |
| 包管理 | 明确安装收据绑定来源/包身份/版本、受管记录 ID 和安装时摘要 | 同包后续版本只有当前内容仍匹配记录时可提出 replace/remove | 相同路径/Mod ID/摘要不能自动建立包所有权 |
| 用户添加 | 玩家通过普通 Mod 安装等真实操作添加；保留原操作/来源证据 | 社团包只可报告冲突或保留；不能自动收编/升级/删除 | 普通 Mod 事务记录不等于属于某个社团包 |
| 本地发现 | 只读扫描看到的未受管文件，无可靠安装收据 | 展示已发现/未知，keep；需要显式另批收编流程才改变归属 | 平台识别成功、文件名像官方包，均不构成受管身份 |
| 用户覆盖 | 包原文件在当前磁盘已修改、替换或失去可靠身份 | 保留玩家改动，报告 CHANGED/身份冲突，整笔更新停止 | 配置目录属于包不等于所有配置可覆写；未知覆盖不能自动备份后强行替换 |

路径和实际文件身份是观察，所有权来自已批准持久收据；二者必须独立。多包碰同一路径视作冲突，首版不做优先级合并、共享所有权、三方配置合并或“以最新版本为准”。同内容可复用可信对象存储，但不共享可写玩家文件，也不把对象证明等同包管理收据。

### 3.3 分两片批准，避免把纯预览直接接执行

| 决策 | A（推荐） | B | 需要明确批准 |
| --- | --- | --- | --- |
| 首片产品边界 | 先做签名源校验、可信扫描和只读差异展示；所有权不足时 unknown/冲突，无确认安装按钮 | 一次设计并实现完整下载/包事务/恢复 | 推荐 A；仍需真实来源、公钥、只读 IPC 和收据读取规格，当前未实现 |
| 收据与归属 | 新增独立版本化包管理收据，引用原实例/操作证明，旧实例不迁移、不自动收编 | 直接扩展实例 JSON 和所有普通 Mod 记录 | 推荐 A；减少旧数据改写，但具体格式/原子提交关联/worker 命令必须单独审查 |
| 配置更新 | 首版已有 config 一律保留并报冲突，只有不存在的配置可按批准事务新增 | 批准后支持确证受管配置的 replace/remove 与恢复 | 推荐先 A；B 扩大破坏性操作，不得套用 add-only Mod 事务 |

建议流程：固定来源选择 → 请求精确包 ID/版本 → 有界下载信封 → 严格解析/规范字节验签 → 校验目标环境 → 主进程在租约与实例修订下读取收据/真实文件 → 纯 diff → 展示未知项/冲突和明确变化 → 玩家确认（仅后续执行片批准后）→ 重复验证与暂存 → 一次受控提交 → 可恢复收据/任务结果。不能把上一次预览、缓存签名、仅 revision 相同当作确认时仍有效。

### 3.4 可信源、公钥与重放策略草案

1. 第一版一个明确批准的 HTTPS 源、一个精确源 ID、公钥 SPKI/指纹与 keyId；artifactId 在该源的固定解析规则中映射，renderer 不提交下载 URL。重定向重新校验来源，禁止跳到任意地址；清单/制品有独立字节与耗时预算。签名验证后仍校验文件大小和摘要、来源证明、JAR 声明/依赖与许可证。
2. 信任根通过已审查发布或用户明确受控配置建立。不能信任清单随附新公钥，也不能把 TLS、keyId 相同、测试公钥或本地生成摘要当信任替代。私钥不进入客户端/仓库。
3. 轮换首版推荐随受审发布更新 pinned key 集合；旧/新 key 明确生效范围与撤销规则，不自动联网下载 key。备选是离线根签名的有版本轮换元数据，需新增独立信任协议/存储审批。撤销后历史已安装文件不自动删除，后续解析停写并提示。
4. 当前 formatVersion 1 没有过期、发行序号或防回滚字段，`packageVersion` 仅是受控字符串，不能假定 SemVer 单调。精确请求/签名绑定可防包替换，**不能证明防重放/防降级**。只读首片可展示精确版本并拒绝自动更新承诺；真实更新前须批准单调发布元数据或等价机制、已见版本/撤销状态持久化与恢复。不能偷偷为现有签名 payload 加字段。

### 3.5 执行与恢复的专门门禁

真实执行需要独立批准包事务 schema、journal/任务幂等、确认协议、目录/会话租约、实例 CAS 与收据提交点；不能将 `PreparedModInstall` 伪装成通用文件准备。新增 Mod 可复用现有可信下载/JAR 复验基础，但包归属提交和 resourcepacks/config 仍需专门绑定与恢复。

replace/remove 需要原文件身份及实际摘要复测，并先保留可证明的原始字节和日志，再变更；不能覆盖未知同名目标、沿链接逃逸、处理 saves 或递归清空目录。提交前取消只撤销本次拥有且未外部修改的文件；提交后拒绝取消；JSON/收据回执丢失按唯一操作身份与完整摘要辨别，不按文件存在、PID、时间猜测。无法证明的状态进入 needsRecovery，保留现场及外部修改；恢复不能把可重建索引当权威日志。具体提交算法、跨域提交点和故障矩阵尚未定义/批准，本文件不声称已经具备安全通用恢复。

## 4. 后续实施准入与验收

| 片段 | 实施前输入/批准 | 实施后的最低有界验收 |
| --- | --- | --- |
| N5 合成视图验证 | 上述容器/权限/生命周期方向和隔离 spike 范围 | 本地合成 HTTPS 的导航、frame、权限、下载、beforeunload、reload/crash、销毁和跨代次回调；无业务 bridge；主窗口安全参数不变 |
| N5 真实工具 | 一个站点/许可/精确来源记录，精确工具 IPC schema | 真实站点资源兼容、离线错误、窄窗/焦点/关闭；不支持登录/上传等如实显示，不提高权限修复兼容性 |
| N6 只读预览 | 来源、公钥策略、只读 IPC、可信观察与收据读取规格 | 篡改/错 key/错包/错版本/撤销拒绝；未知文件/用户覆盖/多包冲突无变化；来源/实例切换迟到拒绝；无写入与执行入口 |
| N6 执行 | 独立版本 schema、防重放/降级、事务/恢复、执行 IPC 及信任材料审批 | 新增/替换/删除各自预检与取消边界；外部改动、链接竞争、回执丢失/重开、未知日志停写；逐片局部测试后完整回归；真实游戏/EXE证据另记 |

当前只完成源码与已安装类型的只读盘点、方案编写和文档路径检查，**未运行上述验收，也未实现 N5/N6**。本轮既有 25 FAIL、已取消强杀/公网取消补证及历史有限验收保持原记录，不借本方案重新开启或改记通过。
