# 0.2.2 小EXE与按需运行时

> 0.3.0延续同级`OUCL.runtime`，并由外层引导程序向Electron传递实际EXE目录。首次没有既有游戏根记录时，应用在EXE同级建立并注册`OUCL.games`；已有用户自选根优先，不自动覆盖、迁移或删除。

批准：2026-10-25用户“按照你说的进行”，原文及范围见资料包DECISIONS末尾。Electron业务架构保留；独立Windows C#引导只负责运行环境准备与启动，不承接游戏业务。没有加入electron-builder、NuGet包或生产npm依赖。

## 分发与信任

- `pnpm package:exe`先构建现有应用，再用Windows自带.NET Framework编译器生成x64 GUI EXE。目标机器需要.NET Framework 4.7.2+，无需现代.NET SDK、Node或pnpm；仅发布EXE，不要求邻近文件。
- 应用代码、第三方声明及每文件SHA256随EXE嵌入。Electron版本45.0.0固定；官方ZIP地址及SHA256来自所装官方electron包的checksums.json，并固定进EXE。运行时不接受远程清单更改版本/摘要，不实现更新。
- 下载只用HTTPS，跳转仅放行GitHub及其发行资产域名，最多5跳、512MiB、请求/读取30秒超时。完整校验成功后才解压；拒绝越界、设备名、ADS、大小限制外条目、重复/大小写别名和符号链接。
- 0.2.2起缓存位于EXE所在目录的`OUCL.runtime`，以EXE真实位置确定，不依赖当前工作目录；`electron-<官方ZIP摘要>`存运行环境，`app-<内嵌文件清单摘要>`存应用。临时目录独立，验证后同卷rename发布。每次启动重新验证全部文件，并拒绝额外文件或重解析点。损坏缓存保留，重建到独立后缀目录；不会覆盖可能运行中的版本。不自动读取/迁移/删除0.2.1的LocalAppData缓存。
- 普通检查、内嵌应用准备和启动阶段通过隐藏窗口的ApplicationContext运行，不闪出引导窗口；只有确实需要下载或发生错误时才显示简洁窗口。下载中可取消，失败后可重试。同级目录不可写时提示移动EXE到可写文件夹，不静默回退到系统缓存、不申请管理员权限。
- 引导锁使用操作系统独占文件句柄，进程退出自动释放，不删除启动器元数据owner。失败可重试；本轮引导下载从头重试，不宣称支持Electron断点续传。取消后等待下载停止，清理仅限本次临时目录，沿途检查链接。
- 使用参数数组语义的Windows转义，无shell，移除Node环境注入。内置应用目录作为Electron启动参数；保持原有OUCL用户资料位置、实例、游戏路径和单实例行为。运行时含Chromium/Electron原许可证，应用含React/react-dom/scheduler/Zustand许可证。

## Java准备

- JavaRuntimeService仅在主进程由LaunchService调用，无新渲染IPC。先验证实例与依赖，再根据已批准版本元数据的javaMajor准备8/17/21；不自动扩大到16、25或加载器兼容矩阵。
- 优先实测已登记的匹配Java，包括手动选择项；其次检查JAVA_HOME/JDK_HOME、Program Files内Java/Adoptium/Microsoft与官方启动器runtime常见位置。搜索有界，不遍历全盘，不修改系统PATH或注册表。
- 缺少时读取固定Mojang java-runtime索引，分别选择jre-legacy/java-runtime-gamma/java-runtime-delta；manifest URL含其SHA1，实际响应摘要匹配后解析。只接受Windows普通目录/文件，拒绝链接、路径越界、大小写别名和文件/目录冲突。
- 文件通过既有DownloadCoordinator、续传库、HashPool和对象仓库下载，新增兼容来源类型`mojang-runtime`，不改变旧记录格式。每个文件按官方大小/SHA1验证，复制到独立暂存树，全部完成才rename至`<游戏数据根>/runtimes/java/<manifest-sha1>`；已有目标逐文件验证，损坏时保守拒绝，不原地修补。
- JVM实际运行检查版本/架构，匹配后复用现有launch-profiles JSON登记，再执行原有启动流程；取消/失败不登记未完成Java。正常重开优先使用已登记Java，无需再次读取下载索引。游戏运行时不替换JVM。
- Java准备复用启动任务的取消和错误通道；当前UI显示准备提示，没有Java文件级进度百分比。中断暂存树不用于执行，保留以待后续受控清理；可信对象与下载断点可复用。该限制不算自动GC或完整崩溃恢复已完成。

## 验证入口

`pnpm check`、`pnpm test:bootstrap`、`pnpm package:exe`、`pnpm smoke:exe`；执行测试编译后可运行`node scripts/verify-java-runtime.mjs 17 21 8`。0.2.2记录在[本次报告](validation/BOOTSTRAP-0.2.2/REPORT.md)，Java真实样本保留在[0.2.1报告](validation/BOOTSTRAP-0.2.1/REPORT.md)。ColdStart.cs仅为本地隔离缓存测试入口，Preview.cs仅为视觉布局测试，两者不进入交付EXE。不自动push或发布GitHub Release。

## 复制与删除

首次只需EXE，环境缺失时会自动下载。以后移动时同时复制EXE和同级OUCL.runtime即可复用环境；只复制EXE到新目录会重新下载。退出游戏和启动器后，可删除EXE及其同级OUCL.runtime来移除启动器程序和环境。账户/设置仍在原Roaming/OUCL，游戏与Java仍在自选游戏目录，均不随环境删除。0.2.1旧缓存若需清理，可在退出旧版后手动删除LocalAppData/OUCL/desktop-cache；新版不会自动删除它。
