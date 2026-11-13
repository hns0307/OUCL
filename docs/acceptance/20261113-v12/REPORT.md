# 增量报告 v12：候选 EXE 三实例共存

已在独立 v11 资料上，用同一最终候选 EXE 实际启动旧原版、旧 Fabric/FerriteCore、新 Quilt；四次进入主菜单并由游戏内 Quit Game 自然退出 0，包含启动器正常关闭重开后的第二次 Quilt。两次启动器均正常退出 0。此阶段不修改产品源码。

## 精确对象与证据

代码候选 `fab0ac873f34d8581bf065e14fa7a9aa93c0baa3`；前置完整检查为 v11 的 655 项、651 PASS / 0 FAIL / 4 既有 SKIP，类型、lint、构建通过。未重复执行无变化的完整检查。

EXE：`D:/MC_start/OUCL-acceptance-v11-20261113/release/OUCL-0.3.0-acceptance-20261113-v11.exe`，406528 字节，SHA256 `3d9a0ebaf289a9552933c97033ffbd6a069e0a0258e3ea8322cc2a5ceb6efce6`。appHash `d863502b24972f98dc62e578794ea5e881bea5033e86efd5074ee4d20a63bb5d`。实际提取七产物与冻结 product-manifest 逐项一致。仅预置已验证的 Electron 运行时，本轮不是新的冷下载。

使用 v11 已准备的普通文件副本，profile/games/Java 均位于该副本 game-data/isolated 内，未操作原聊天窗口或旧根。主协调 CUA 是唯一 GUI 控制者，账户实际选择 `A v11 coexistence · OUCLAV11`。后台组合框写值/选项点击未改变应用选择，不计成功；前台语义选项及随后 UI 确认有效。游戏画布无菜单可访问树，因此先保存并查看新截图，再点击 Quit Game。

| 实例 | 本次新 sessionId | 启动 UTC | 实际结果 |
| --- | --- | --- | --- |
| 旧原版 | 020285b6-f734-4f21-9d83-7ec3e047f8cb | 06:08:33.728 | 1.20.1 主菜单，自然退出 0 |
| 旧 Fabric | 01623877-4a24-40c8-8a72-fbda60448f4e | 06:10:04.767 | Fabric 主菜单，FerriteCore 6.0.1 日志，自然退出 0 |
| 新 Quilt | f6ac6e8c-6616-499c-b682-c8b8395e7553 | 06:11:49.594 | Quilt Loader 0.29.2 主菜单，自然退出 0 |
| 重开后 Quilt | 7b0d3e60-7ad3-44c1-afe4-9a6e74a9ca11 | 见原始审计 | 同 EXE/同 profile 正常重开后菜单，自然退出 0 |

第一次启动器由 bootstrap PID28932 派生 PID39788，窗口2360684；三游戏 PID24036/30260/25680。第二次 bootstrap PID22940 派生 PID20620，窗口8388908；Quilt PID12732。正常 GUI Alt+F4 后，直接持有进程句柄的只读等待分别记录 UTC06:13:42.101、06:17:00.219 exitCode0。游戏 PID 均通过自有启动器父子关系确认。

`node acceptance-results/game-data/verify-product-coexistence.mjs` 实际退出 0，结果 [v12-result.json](evidence/game/v12-result.json) 为 PASS，48 项检查。它读取正式持久会话与真实任务接纳、两索引、旧/新依赖 JAR、白名单日志和包内七产物；不从日志猜测主菜单。主菜单由本聊天逐张查看的四张截图独立支持。

旧索引 `indexes/5.json` SHA1 `ada52cc672270e8dc69e912b2ba0ea9c141ed664`；新别名索引 SHA1 `2b3aa959237269caa09ac97fc3f7eae651315696`。旧 dep-client 路径与新 dep-client-metadata 路径并存、摘要保持；owner 标记在正常退出后不存在。详细审计及截图见 evidence/game。原历史 session 不冒充本次结果。

## 当前选择与边界

| 清单 | 本轮结论 |
| --- | --- |
| 可本地合并 | v3 已选 A 基础、B只读任务归属、C只读预览、D内部启动一致性、E固定样本只读；加上 v11 精确十文件的已批准索引/隐藏依赖隔离。统一检查及同最终 EXE 代表共存通过 |
| 待补证 | A 真正强制中断后的最终 EXE 恢复；未知旧锁、全部异常/断电时序；C延迟回执后组件过期恢复；E全部 native 回调/worker 销毁组合；全世界/硬盘/加载器矩阵。不能标完整历史方案全部通过 |
| 排除 | 共享活跃树交织未提交内容、旧 tools/缓存/私人游戏资料、大体积复制清单、二进制入Git；C文件动作、D公开Java面板、E通用导入安装，以及认证/联机/后台等未批准能力 |

五个原聊天均以紧凑快照重新核对，游标未变化，未恢复其任务。A来源的菜单证据与本次独立菜单分开；B/C/D/E历史限制由后继统一证据补齐的精确部分才更新。

C独立延迟回执场景已用原 v3 七产物启动（其 C 源/产物与 v11 未变），PID38980/window723700。真实 completed 回执于 UTC06:19:33.952 被测试壳暂存，原 preload 自然 TIMEOUT、组件保留旧身份及查询/取消入口。将保持真实900500ms后再人工查询；当前不预记通过。它不影响本轮 A 共存结论。

本地整合及交付复制的实际提交/分支结果在后继追加记录。没有 push/发布；活跃 mod_loaders 不切换、不整体暂存、不提交。
