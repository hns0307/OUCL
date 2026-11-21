# C-R4 r2有限审计：14项PASS

2026-11-14。实际执行本目录audit.cjs，退出0，audit.json的14项全PASS。仅解析既有日志/快照/文件SHA，不启动产品、GUI、IPC或Worker，不改变旧证据。五小时开始used14%、剩86%。

首轮c-inflight-close-v24/ATTEMPT.md保留NOT_EXERCISED：当时先30秒timeout，后关窗。本轮r2区别是第16行window-closed UTC03:15:42.653，第17行before-quit，第18行原Reader terminate .655，第19行真实worker exit1 .675，第22行app exit0 .704。距离worker-selected仅2141.485ms，早于30秒timeout；无GUI cancel IPC。child thread2真实keepalive-loaded、原mod-archive-result均在关窗之前。

因此通过的是原shutdown对**真实结果已产生但线程被keepalive保持存活**的观察任务abort/terminate/join。线程exit1是受控终止，不是自然扫描成功，也不是网络取消。没有测试壳直接terminate兜底。

重开模式没有worker-selected记录，代码以mode=close限定注入；旧previewId `25f11f77-0452-4600-9b60-4eb0bdba8cac`经原公开status返回PREVIEW_EXPIRED。新request=`665d3253-346a-4cbf-b5f4-ba99bb4f7f68`、preview=`75c5a185-9e32-40f1-8b3e-a82700c513aa`均不同，原status completed及随后blocked DOM一致，renderer无Node，第二进程正常exit0。截图由主协调观察，本审计未新增桌面操作。

close/reopen各七项产物SHA与固定manifest一致。state-v24-r2-before/closed/reopened-after三快照完整相同：六JAR、五任务。owner释放沿主协调记录，审计未控制进程/探锁。

本报告关闭C-R4这个生命周期注入代表子场景，不扩大为自然慢扫描、网络pending、强制结束恢复、全部异常时序或游戏兼容。核验脚本写本目录audit.json，输入物证原样保留。

## C-R6窗口展示后继：仅设计，尚未准备或执行

建议另建c-multideclaration-ui独占目录：复用v16合法多声明/嵌套JAR字节与精确hash→Modrinth响应；先确认v16实例记录是否具备正式安装任务（避免v4全局列表缺项），必要时沿v5-global正式InstallerService流程建新profile，绝不补假install状态。

拟文件：prepare.mjs（正式存储/Mod服务数据和响应映射、源SHA）、window.cjs（固定七产物、独立profile、仅白名单精确endpoint/hash的本地synthetic响应，其余拒绝）、verify-result.cjs及README。正式Modrinth client/worker/投影/renderer不替换；合成响应必须显式标注，不称公网来源。

需先审生产Electron net.request怎样在不修改domain/产物下消费本地响应：仅webRequest取消不足以提供合法平台响应，不能把预写公开report当实际平台链。若只能替换领域client或放行公网，则先停在设计，向主协调说明透明transport方案再决定，不偷偷绕过。

目标GUI证据有限：同一物理JAR多个声明与nested深度一起影响、平台project/version与本地modId分离、before/after及直接/间接依赖名称映射正确、合法已知事实与unknown边界如实展示、JAR/任务保持。主协调唯一启动/点击，本轮不新开窗口或生成这些后继文件。
