# 原版下载界面参考与OUCL取舍

日期：2026-10-25。依据用户“下载界面可以参考MC_start文件夹里的其他启动器”的要求，仅只读查看本地源码；未运行参考启动器或其中脚本，未观察其实机窗口。以下证据说明声明的交互结构，不证明参考项目当前可下载或完成安装。没有复制源码、素材、图标、样式或测试夹具，也不引入其依赖。

当前范围仍为已批准阶段1A原版下载/启动。参考项目中的加载器、Mod、整合包及账户功能不进入本次实现；技术栈仍为OUCL既有React和受限preload。

## 本地来源与可借鉴交互

| 参考项目及具体来源 | 源码中可确认的结构 | OUCL采用方式 |
| --- | --- | --- |
| [KAMUCL MinecraftVersionPicker.vue](D:/MC_start/KAMUCL/src/renderer/src/components/MinecraftVersionPicker.vue:7) | 默认正式版；搜索版本号、分类、发布日期、已选状态；加载、失败重试、空结果状态；有combobox/listbox及键盘焦点相关结构 | 版本浏览默认正式版，显式切换快照/旧版；保留搜索与结果数，单独显示加载、网络失败和无匹配，不把它们混成空白 |
| [KAMUCL GameView.vue](D:/MC_start/KAMUCL/src/renderer/src/views/GameView.vue:1053)；[安装确认入口](D:/MC_start/KAMUCL/src/renderer/src/views/GameView.vue:1490) | 版本下载与已安装分区；版本行有发布时间与进度；失败实例有重试；安装弹窗最后确认并允许取消 | 浏览、安装确认、正在进行的任务、已安装实例形成连续路径。选择版本不立即下载；确认区保持主要操作始终可见 |
| [PCL PageDownloadInstall.xaml](<D:/MC_start/PCL/Plain Craft Launcher 2/Pages/PageDownload/PageDownloadInstall.xaml:63>)及[代码后置](<D:/MC_start/PCL/Plain Craft Launcher 2/Pages/PageDownload/PageDownloadInstall.xaml.vb:433>) | 列表进入选择页，显示Minecraft版本、可编辑实例名和验证提示；命名未通过时安装按钮禁用；源码分正式/预览/远古等类别 | 确认区突出当前MC版本、实例显示名与目录/隔离事实，名称校验紧邻输入；不照搬加载器选择面板 |
| [PCL PageSpeedLeft.xaml](<D:/MC_start/PCL/Plain Craft Launcher 2/Pages/PageSpeedLeft.xaml:48>) | 总进度、下载速度、剩余文件等摘要字段 | 任务卡优先显示阶段、实际字节进度与已完成/总制品数；线程数属于实现细节，不进入首版主要信息 |
| [PCL1 formDownloadLeft.xaml](<D:/MC_start/PCL1/Plain Craft Launcher/Pages/formDownloadLeft.xaml:5>)及[formDownloadRight.xaml.vb](<D:/MC_start/PCL1/Plain Craft Launcher/Pages/formDownloadRight.xaml.vb:170>) | 最新正式版/测试版入口；独立下载任务区；代码区别下载失败、等待重试等状态 | 提供正式版快速入口与持续可见任务区；“等待重试”“已取消”“失败”分别呈现，不能全部写成下载中 |
| [XMCL VersionInputMinecraft.vue](D:/MC_start/x-minecraft-launcher/xmcl-keystone-ui/src/components/VersionInputMinecraft.vue:10) | 默认正式版、开启额外版本后扩展；复用版本输入控件并传递刷新中/错误/刷新动作 | 筛选默认简洁，失败可刷新；只使用官方目录已验证事实，不允许任意版本文本绕过服务验证 |
| [XMCL HomeInstanceInstallDialog.vue](D:/MC_start/x-minecraft-launcher/xmcl-keystone-ui/src/views/HomeInstanceInstallDialog.vue:1) | 标题、确认内容与关闭入口分区；骨架加载、错误、无文件状态独立；安装摘要展示变更数量 | 借鉴确认摘要与状态分区，不采用其更新/加载器业务。安装计划尚未取得时显示准备中，不展示伪造大小或可立即启动 |
| [XMCL AppTaskDialogTaskItem.vue](D:/MC_start/x-minecraft-launcher/xmcl-keystone-ui/src/views/AppTaskDialogTaskItem.vue:45)与[AppTaskDialogTaskView.vue](D:/MC_start/x-minecraft-launcher/xmcl-keystone-ui/src/views/AppTaskDialogTaskView.vue:281) | 任务标题/阶段、当前与总大小、速度、预计剩余、进度条、成功/失败/取消标记及取消动作；总览区聚合任务统计 | 每个安装任务有稳定身份和状态，失败信息就近显示；真实服务有数据才显示速度/剩余时间。取消按钮始终可通过键盘访问，不依赖悬停 |

证据限制：PCL的`PageDownloadInstall.xaml.vb:16`存在按`RestrictMcDownload`显示下载不可用的条件分支；未求值当前配置，不能宣称其此刻可用。`PageSpeedRight.xaml`部分示例位于注释中，不将其当作运行能力。上述路径是本机阅读来源，不是OUCL运行时依赖或需要打包的文件。

## 可直接落实的1A页面流程

1. **浏览版本**：页面主标题“下载 Minecraft”，搜索框和正式版/快照/旧版筛选；每行显示版本、类型、发布时间及“查看并安装”。缓存列表明确标记缓存与更新时间。清单加载失败时保留已有列表，并提供刷新；空结果解释当前筛选。
2. **版本详情与安装确认**：选中版本后显示版本号、发布时间、所需Java主版本、实例显示名、已登记目标目录及隔离选项。服务生成可信安装计划后再显示需准备制品数与计划总量；计划总量不称为实际网络下载量，因为共享缓存可能减少传输。主要按钮“确认安装”，次要按钮“返回”。目录未登记、名称无效、元数据失败时给出具体可恢复原因。
3. **下载与安装任务**：确认后收到真实TaskAccepted再进入任务状态；卡片显示“准备元数据/下载文件/校验文件/准备实例”等实际阶段、字节进度、制品数和取消。切换页面不取消任务；界面重新打开后按任务ID查询当前快照，不依赖先前事件补出状态。完成下载仍显示后续安装阶段，实例提交与必要检查成功后才标“安装完成”。
4. **错误、取消、重试**：失败卡保留版本和实例名称，显示脱敏可理解原因及“重试”；校验错误不能写成网络成功。取消先显示“正在取消”，服务等待下载/写入收尾后显示“已取消”。重试经过服务幂等/恢复检查并复用已验证对象，界面不自行删缓存、改路径或抢占遗留owner。只有实际支持暂停/恢复的任务才暴露相应按钮。
5. **安装后启动**：已安装实例显示版本与Java就绪状态，并提供“启动”。未找到兼容Java时提示选择/管理Java；不能将下载完成按钮直接变成可启动，或用模拟状态冒充游戏已启动。真实进程启动和退出由主进程服务返回状态。

## 实现边界与验收

这些是依据已有服务与批准契约的UI取舍，不新增IPC、磁盘schema或第三方依赖。后续实现先核对`OUCL-Codex/docs/PROPOSAL_PHASE0.md`的任务契约，所有目录、网络、哈希、解压与进程操作留在主进程/worker。渲染界面仅消费已验证摘要、任务快照和状态事件；用户可见文案放`shared/locales/messages.ts`。

下载确认与任务应覆盖：键盘选择/返回、屏幕较窄时操作可见、切换页面后任务仍运行、重复点击不会重复安装、失败后可重试、取消等待收尾、缓存命中不虚构网络速度、下载完成后尚在物化时不提前成功。最终仍需从新Windows exe默认入口实测下载、安装、真实MC启动、退出重启；本次只读参考不构成该验收。
