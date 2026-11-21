# A1-08实际安装编排

新增实例持久索引/记录、原始元数据固定、稳定安装/consumer身份、InstallerService实际编排与受管目录/natives/最终JSON提交。契约见[INSTANCE_INSTALLATION](../../contracts/INSTANCE_INSTALLATION.md)，无新依赖、无SQLite schema变更。

`pnpm check`退出0：221项219 PASS / 0 FAIL / 2既有环境SKIP，类型/lint/build通过，见[final-check.log](final-check.log)；check.log仅为接线前的初次208项记录。新增11实例worker/parser测试、4完整服务测试、9公开契约/handler测试、11适配器测试和四能力握手回归；core行/函数100%、分支98.98%，不是IO/UI整体覆盖率。受限运行存在SQLite/目录链接权限失败并遗留两个测试子进程，确认身份后结束并保留[失败日志](restricted-check.log)，没有改系统权限或降低Electron安全。

完整服务测试用实际StorageClient/ObjectStore/HashPool/HttpTransfer/FileViewService/NativeExtractor，网络/上游内容为可控fixture，证明：原始元数据持久→实际文件传输/哈希→根视图junction/文件复制→私有natives→本地实例JSON→ready及task completed；第二实例复用4份已下载制品且无新增传输，两实例客户端入口/私有natives分开；关闭服务/数据库后新服务重开仍有2个ready实例。另验证重复请求与改payload拒绝、同名不覆盖、取消未ready、使用新请求重试同名、完成后取消太晚。fixture JAR/DLL为非可执行测试字节，没有运行游戏。

`pnpm test:workers-runtime`退出0，正式Electron45/Node24.22打包worker验证实例JSON/index写入及关闭重开；未完成reserved记录保持未完成，没有因文件存在提升ready。既有对象、下载、解压、哈希和投影验证继续通过，见[electron-runtime.json](electron-runtime.json)。该测试没有从普通应用界面调用安装流程。

main/preload已经连接真实InstallerService；下载UI提供100项分页版本列表、页内搜索、安装确认、隔离选择、实际任务阶段/校验字节、取消及实例列表。任务订阅、游标归属、超时重试、导航退订和退出收尾均走固定白名单；窗口仍为contextIsolation/sandbox开启、renderer无Node。

`node scripts/install-window.mjs`实际Electron窗口验证见[installer-window.json](installer-window.json)：使用真实dist/main、preload、renderer和服务，预登记临时根目录，DOM点击安装两次，2 ready/2 completed；首次4次制品请求，第二次0新增；核对磁盘客户端、私有native及manifest，页面重载仍保留任务/实例。网络响应为非可执行fixture，未运行MC。截图[installer-window.png](installer-window.png)已目视检查；Windows截图初次因隐藏窗口无surface失败，调整透明非激活surface后通过，未把截图失败误报为业务失败。

`pnpm smoke`使用真实官方目录并选择1.20.1，验证未选根不能安装、四能力与十方法白名单、弹窗拒绝，见[smoke.json](smoke.json)、[catalog.png](catalog.png)。首次暴露握手仍限制最多两能力，已修正为四能力并添加回归。系统native选择器仅渲染未操作，预登记不冒充native选择E2E；两个窗口测试均不是新便携包。

负面服务测试暴露终态任务先于needsRecovery索引持久化的时序问题，现先持久实例失败/恢复状态再提交任务终态。未知共享入口保持原字节且needsRecovery，不覆盖外来文件。

未完成：实际官方游戏整批安装、Java注册与离线档案、启动计划/排他会话/真实游戏进程、新exe下载/启动实测，以及完整崩溃接管/投影恢复。当前没有宣称最终exe或阶段1A完成；目标继续进行中。
