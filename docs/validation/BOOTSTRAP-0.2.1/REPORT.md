# 0.2.1 小EXE与按需Java验证

日期：2026-10-25。范围为用户明确批准的小EXE内置应用、首次下载Electron、按游戏要求自动准备Java。不扩展后续阶段，不标记完整1A历史缺项已关闭。

对应实现提交：479d0e9；验证证据与交接单独提交。

## 交付

- `release/OUCL-0.2.1.exe`，232448字节（227KiB），无旁置文件需求，不交付ZIP。原0.1.0/0.2.0便携目录保留。新EXE未签名，不含Java/MC，不自动更新、不发布远端。
- SHA256：`a2802e49c5c323d2586e3c910ec515e869d07fb4fb3130e61aa15c0cd4361d26`。Electron45.0.0官方ZIP摘要与内嵌应用清单摘要见package.json。
- Windows 10/11 x64及.NET Framework 4.7.2+；引导缓存为LocalAppData/OUCL/desktop-cache，原Roaming/OUCL资料与自选游戏根沿用。Java在游戏根runtimes/java内按manifest摘要发布。技术边界见../../BOOTSTRAP.md。

## 实际验证

| 命令/场景 | 结果/证据 |
| --- | --- |
| `pnpm check`（工作区TEMP、正常Windows权限） | typecheck/lint/test/build通过；262测试，260 PASS、0 FAIL、2原有软链接权限SKIP；core行/函数100%、分支99.07%。见check.log |
| `pnpm test:bootstrap` | 14 PASS；解压越界/设备名/ADS/大小写别名/反斜杠拒绝，缓存摘要与额外文件拒绝、参数转义。见bootstrap-tests.log |
| `pnpm audit --audit-level=high` | No known vulnerabilities found；audit.log |
| `pnpm audit:licenses` | 127包，reviewRequired=[]；新构建不增加npm/NuGet依赖，licenses.json/log；证据目录参数单独lint通过 |
| `pnpm package:exe` | 用系统编译器生成227KiB EXE；package.log/json |
| 全新隔离缓存，ColdStart测试入口 | 相同Launcher.cs和内嵌载荷实际从Electron官方下载、SHA256校验、解压与10能力/24方法连接，约24.8秒；smoke-isolated-first-download.json。仅该测试入口可注入工作区缓存根，不进入交付EXE |
| 最终EXE默认入口，已有Electron缓存 | 约1.83秒连接，24方法/10能力，renderer无Node，元数据落到独立测试profile，正常关窗释放owner；smoke-*.json及bootstrap-window.png。该项是最终EXE，冷启动项为前一候选应用载荷（仅UI文案/版本号不同），不混写为最终EXE空缓存实测 |
| `node scripts/verify-java-runtime.mjs 17 21 8` | 无系统Java候选下实际下载：Java17.0.15/Microsoft，403文件91160397字节；Java21.0.7/Microsoft，402文件99041788字节；Java1.8.0_51/Oracle，192文件150204599字节；每文件独立SHA1/大小检查，实际JVM属性检查通过。正常关闭重开后禁止访问下载接口，三版本均复用成功；official-java.json |
| 无预登记Java的启动任务集成 | 现有真实存储/对象fixture中注入Java准备器，确认所需major=17、收到取消信号、登记后按正常启动/会话流程完成；属于自动集成回归，不冒充真实MC菜单 |

## 失败及修正

- 受限环境下首次Node网络读返回ENOTFOUND；正常网络权限下官方响应成功。受限文件权限导致旧SQLite/rename测试失败；用工作区TEMP及正常权限复测通过，不改安全配置。首次pnpm包装入口曾等待供应链检查，已中止，随后正常权限按正式命令运行。
- 首次内部应用ZIP由旧.NET默认生成反斜杠名称，引导安全检查拒绝，尽管官方Electron已下载并验证。改为构建时显式使用斜杠名称；保留原测试产物于.test-build，后续隔离冷启动与最终默认入口通过。未放宽路径检查。
- 构建器曾遇到相对C#源路径和PowerShell ZIP程序集引用问题，已修正；系统脚本策略未修改。验证脚本lint缺少AbortController声明已改为globalThis访问，完整检查随后通过。
- 发现Vite旧配置保留历次assets，清理renderer输出后单文件由约1.09MiB降至227KiB；main/workers输出不受renderer清理影响。

## 保留限制

首次运行依赖可访问GitHub官方下载；失败可重试，无镜像默认源。Electron下载失败从头重试，Java下载仍复用已有可信断点与对象。GUI仅显示Java准备提示，尚无文件级百分比；中断Java暂存树保留、不执行，后续清理未实现。损坏已发布Java停止并报告恢复需求，不自动覆盖。

本轮没有再次验证真实MC主菜单/世界及全部Windows版本，也未将历史崩溃owner接管、Java16/25/加载器或全版本兼容标为通过。真实Java与启动集成回归不能替代MC全矩阵验收。未结束用户游戏进程，未push或发布GitHub Release。
