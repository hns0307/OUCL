# v31：五包审查整改统一回归

本对话统一回收 A–E 审查并管理验收。本轮选择 8 项最小整改（A01/A02、B01/B02、C01/C02、D01/D02），D03 保留为既有历史快照限制；未新增业务批准。31 个文件含 13 个生产源码、17 个测试/夹具和 1 个对象租约内部契约，代码提交 `0c2a889ccea544d3294136a80c74ac8a5e6f348f`。此前 main 为 `096dd22e402ef6af58e49b7cdb89a1b4fdcdb07e`，产品源为 fab0ac8；本地整合实际结果见后继 INTEGRATION.md。未 push 或发布。

## 本次增量

| 归类 | 项目 | 实际结果与限制 |
| --- | --- | --- |
| 可合并 | A01 对象所有者租约 | 依据 11 月 1 日已批安全租约范围，Windows 对象域增加独立 SQLite OS 租约及身份绑定；旧 UUID、未知或损坏证据继续停写。metadata OwnerGuard 不变。真实服务子进程自行异常退出及受控边界通过；不是最终 EXE 强制终止验证 |
| 可合并 | A02 初始化失败缓存 | 等待所有清理后按 Promise 身份清除失败缓存；并发共享、清理失败保守阻断、close 交错有回归 |
| 可合并 | B01 观察公平性 | 7 稳定加 1 轮询；同原始 bridge 的未知远端订阅最多保留 8 次额度，耗尽改为有界查询。只约束观察池组，不承诺所有独立消费者的总订阅数或持续实时事件 |
| 可合并 | B02 逐记录预算 | 将既有 deadline 检查传入库存 SQL 前后及逐记录处理，保持原 TIMEOUT。真实 worker/SQLite 受控时钟验证在第 3 条后停止、同 worker 可继续工作、数据不变；单次同步 SQL 不能硬中断 |
| 可合并 | C01/C02 展示与旧错误 | 分别显示声明模组、依赖 ID、平台项目和固定版本；成功终态清旧观察错误。组件及真实 Electron 受控窗口取得证据 |
| 可合并 | D01 提交不确定恢复 | 已登记且无本服务活动 job/owned 的 committing 任务经 CAS 收敛 needsRecovery；初始化最近 32 条、约 2 秒检查点软预算，首次错误停止，其他按单项查询恢复。错误链以 AggregateError/cause 保留。依赖正式单一 LaunchService 装配；不是任意双服务安全证明或真实存储故障验收 |
| 可合并 | D02 恢复提示 | needsRecovery 优先于普通失败和重试；当前组件阻止普通启动。不声称跨重开持久互锁 |
| 已说明限制 | D03 Java 历史快照 | 原计划允许检查报告为历史测量，启动时对实际选用的准确 Java 再检；不新增持久报告绑定或公开 Java 面板 |
| 待补证 | 产品与网络 | 修复后完整 EXE/游戏代表路径尚未重验；旧 v11 EXE 不含本轮修复。A 真正强制终止恢复仍 DEFERRED；C 公网 pending 取消未触发、早 close 根因 UNKNOWN；不可达非主 frame 不记通过 |
| 排除 | 扩展业务 | Mod 文件变更、通用整合包导入/安装、公开 Java 面板、新 IPC/任务格式/依赖、发布均不进入本轮 |

## 统一验证

隔离候选 `D:/MC_start/OUCL-remediation-20261114-r1`，复用既有 v11 工具链，不安装依赖。通用测试显式设置独占 D 盘 OUCL_TEST_ROOT，使脚本创建相应 TEMP/TMP；保留系统 TMP 拒绝的 r1 失败，不削弱路径保护。测试额外加载 180 秒 unref watchdog，未触发。

| 实际命令 | 结果 |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | r3 exit 0 |
| `node node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts` | r3-final exit 0；首 r3 因 AggregateError 未直接 cause 失败，已保留失败并修复 |
| `node scripts/test.mjs` | r3 691 项：687 PASS、0 FAIL、0 cancelled、4 既有 SKIP；51980.9388ms；core 行/分支/函数 98.97/96.39/99.27% |
| `node scripts/build.mjs` | r3 exit 0，正式七产物 |
| `node --test tests/components/maintenance-preview/component-harness.cjs` | 9 PASS、0 FAIL；受控 hooks/bridge，无 DOM |
| `node tests/components/launch-recovery/run.mjs` | exit 0，failedRecoveryCases=[]；实际 adapter/组件与受控 hooks/bridge |
| 新构建固定 worker + 编译后 fixed-pack-preview.test.js | 4 PASS、0 FAIL、0 SKIP；单列证据，不改写全量 4 SKIP 统计 |

r2 首批 687 项中 683 PASS、4 SKIP，类型/lint/build及上述专项通过；其后才加入 B02/D01，因此采用 r3 覆盖最终源码。D01 的标准回归进入本轮 691 项，使用实际 LaunchService/状态机、受控存储和进程；B02 的标准回归真实 worker/SQLite，受控时钟只进入测试 bundle，产品 build 不注入。最终提交前仅移除 D 组件夹具末尾多余空行，无可执行语句变化。Git 旧隔离树 InstallPanel 的 CRLF 与 main LF 经干净状态及归一比较核实；清单同时记录实际原字节与 Git LF 摘要。

## C 实际窗口补证

全新资料由正式安装/Mod 服务和固定合成响应生成，未手写 ready 状态。保留原 main/preload/React/worker 和真实 JAR/平台解析；严格受控传输不是 HTTP/公网。首个真实 completed 状态回执延迟 8 秒，原 3 秒桥超时，后由实际 GUI 取消取得完成先赢终态并清旧错误。A 标签可见；B 固定版本由实际 DOM/AX 支持，截图下半行被裁切，不声称该截图显示完整固定版本。

窗口 PID37688/HWND657704 已于 14:15:18 UTC 正常关闭，app exit0；七产物 SHA、6 JAR/安装依赖文件和 4 持久任务前后一致，audit.json 七项检查通过。首次背景截图 status-timeout.png 是旧画面；实际超时画面为 timeout-refreshed.png。准备 r2 因资料不完整而 NEEDS_RECOVERY 的失败现场原样保留，没有启动 GUI 或删锁。GUI 产物为 B02/D01 加入前的 r2，不能称最终七产物或最终 EXE 已验。

原始日志、局部结果及截图见 evidence/；SHA256.json 管理本版 48 份原始证据。源码精确清单为 evidence/final-changes-r3.json。旧版本报告不回写为通过，当前总体仍 IN_PROGRESS。
