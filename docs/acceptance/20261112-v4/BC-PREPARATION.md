# B/C 同产品壳补验准备

2026-11-12。状态：**PREPARED，未启动 GUI，未作窗口通过声明**。开始核对 v3 TASK_PLAN/DECISIONS；五小时已用55%、剩45%，未使用周额度门槛。此次主协调明确授权准备独立 profile/数据和生产壳 harness；沿 B 只读目标查询、C 短期内存只读预览批准，无产品业务扩展。

## 位置与候选

独占准备目录：`D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v4-bc/`（以下称 base）。活跃树只新增本报告。没有改 v3 产品源码/冻结文件、既有测试、D 准备目录或其他工作包文件，没有启动 GUI/游戏、访问原五聊天进程/玩家目录、提交或自动任务。

协调方指定候选为 v3 / commit `bc01f07`。此副本无 `.git`，本准备没有自行宣称 Git revision 验证成功；运行 `git rev-parse HEAD` 实际返回不是仓库。采用协调方既有 `acceptance-results/product` 的生产构建，逐字节复制到 base/product；新 `verify-manifest.mjs` 按路径排序核对原 `acceptance-results/product-manifest.json`，**7 个生产产物 SHA256 均相同**。没有重编译、patch、替换 main/renderer/preload/worker。主协调仍以自己的冻结源码/commit 对应记录为准。

## 实际准备和证据

执行 `node acceptance-results/v4-bc/prepare.mjs` 退出0，日志 base/preparation.log。prepare 使用 esbuild 在 base/services.cjs 打包正式服务与两个现有生成夹具；**只用于数据准备，不被窗口 harness 装载**。窗口只 require base/product/main/index.cjs。

真实调用链：StorageClient → 独立正式 storage worker → RecordStore/SQLite/JSON；modInventoryContext + InstalledLanguageReader + InstalledJavaFacts/ProfileService → ModInventoryService → 正式 ModArchiveReader 独立 worker → ModInspectionService → 正式 ModrinthModClient（网络 transport 对所有请求抛受控错误）→ ModTaskService 正式接纳、执行、生成报告、提交 completed。不存在 SQL 手写 queued/running/completed，也不手写报告或平台已知结论。

每实例的基础 ready InstanceRecord 是既有 `modReadyInstance` 生成的**合成元数据**，不是安装服务实际完成的 Minecraft：只用于只读 Mod 目录定位，未下载 Minecraft/Java/加载器，不得点击启动游戏。创建六个 JAR 均只有本地生成的 fabric.mod.json、ZIP 结构，无 class/可执行内容，无第三方源码。实例 summary 的原安装 taskId 是合成 fixture 身份，没有伪造对应安装成功任务；本验收的真实持久任务是下表两个 mod-check。

准备后关闭全部服务与 worker，再启动第二个真实 StorageClient/worker，ModTaskService.initialize 恢复、readModTargets 按实例查询及 report 回读均成功。该结果是**后台真实 worker 重开**，尚非产品窗口正常退出重开。

| 对象 | 身份与预期 |
| --- | --- |
| profile | base/profile；主进程 userData 显式设到这里，metadata=base/profile/metadata |
| 游戏测试根 | base/synthetic-games；只含自生成目录及6个非可执行JAR |
| rootId | `40000000-0000-4000-8000-000000000001` |
| A | `BC-A Synthetic Fabric`，instanceId `40000000-0000-4000-8000-000000000002`，revision1 |
| A 真实完成任务 | `2e678b5c-762b-4dc9-a5a8-e8114ecc7fec`；check 报告 localState=satisfied、state=unknown，NETWORK_FAILED，不冒充平台满足 |
| B | `BC-B Synthetic Fabric`，instanceId `40000000-0000-4000-8000-000000000003`，revision1 |
| B 真实完成任务 | `08feb115-2678-41e2-a486-19466eeeae89`；localState/state=unsatisfied，beta-dependent 要求 beta-provider>=2.0.0，实际1.0.0；另有平台NETWORK_FAILED |

全部请求身份、公开报告、fingerprint/fileId 及预计算预览在 base/seed.json。两实例各一个真实检查任务，初始无活动任务；不将“无活动”说成活动观察已验。

## 启动与正常重开（只由主协调聊天执行）

PowerShell 精确冷启动入口：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\v4-bc\window.cjs' '--bc-run=cold'
```

通过窗口正常关闭后，等进程退出、日志有 will-quit/exit，再以相同 profile 正常重开（只改日志标签）：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\v4-bc\window.cjs' '--bc-run=hot'
```

harness 只设置独立 userData、禁硬件加速、清除继承 OUCL_PORTABLE_ROOT，拦截 HTTP/HTTPS，记录公开 bridge/DOM，不替换 ipcMain、领域能力、preload、页面或 hooks。每1.5秒读 handshake、当前 sidebar 选择、报告实例/时间、Mod面板文本、任务卡片文本，以及所选实例的公开 listInstanceTaskTargets；不自动点击/选择/提交任务，不调用文件写操作。日志 base/window-cold.jsonl、window-hot.jsonl，异常只记错误类型。无启动即无这些窗口日志。

原生窗口安全参数从生产 webPreferences 读取并记录 loaded；预期 contextIsolation=true、sandbox=true、nodeIntegration=false，nodeAbsent=true；是否实际成立由窗口执行结果确认。

## 主协调建议操作与预期

1. 等产品连接完成，侧栏选 A，Mod面板恢复 alpha 三文件，时间来自真实历史报告；公开 targets 只含 A 任务。选 B 后只能出现 beta 三文件及 B targets，A 任务不能当成 B 活动目标。正常退出重开后分别再选 A/B，报告/任务身份仍一致。
2. A 中点 alpha-provider.jar 的“预览禁用影响”：正式预计算为 blocked，直接依赖 alpha-dependent.jar；NETWORK_FAILED 保留。点 alpha-standalone.jar 则 unknown、无直接依赖，不能显示ready。这些值只是准备时真实服务的后台结果，窗口尚须实测。
3. B 中点 beta-provider.jar：blocked，before 版本问题应可见 beta-dependent.jar、要求>=2.0.0、实际1.0.0、本地来源与严重程度；after 缺失依赖亦保留。B standalone 预览仍 blocked，原因是既有版本冲突没有消失，不要误期望unknown/ready。对话协调方可据同文件映射、来源、actual文案验证BC-02。
4. 预览是内存观察，不进入持久任务历史，正常进程重启后不能宣称旧previewId恢复；历史 mod-check 报告才应恢复。用户重新发起预览会重扫，所有JAR字节必须保持不变。

### 可选的真实活动态观察（网络层受控等待）

base/network-hold.json 默认 `{"delayMs":0}`，所有网络立即拒绝。主协调如需足够时间切 A/B，可将**此独占文件**改为 `{"delayMs":5000}`。harness 对 api.modrinth.com 请求延迟最多5秒后仍取消，其他网络立即拒绝；每次请求读取设置，无需重启。正式服务自身的网络超时/重试仍可能先发生，故不保证精确5秒活动窗口。

在 A 点击正式“一键双重检查”，等待真实服务接纳后切 B：A 的真实新mod-check会在平台请求中等待，B的目标查询不能出现A的新taskId；返回A应可看到其正在检查/观察确认，随后如实完成unknown或取消。日志的 targets/卡片和 NETWORK controlledWaitMs 可区分此场景。ModTaskService 一次只允许一个活动检查，不制造 A/B 同时运行；B 此时再提交可能 SCAN_BUSY，不能伪报第二活动任务。完成后将delayMs恢复0再做C，避免真实共享检查器忙导致SCAN_BUSY干扰。

此活动是正式任务接纳/状态机/扫描/网络调用，**延时来自测试网络拦截**，不是真实上游延迟，更不是重开后活动任务继续运行证明。不要强制结束产品进程以补别的恢复目标；此次仅正常重开。

## 复核与可重复使用

以下命令都只读受测数据并在本独占目录写证据，不启动GUI：

```powershell
node acceptance-results/v4-bc/verify-manifest.mjs
node acceptance-results/v4-bc/inspect-state.mjs after-cold
node acceptance-results/v4-bc/inspect-state.mjs after-hot
```

建议产品退出后执行 inspect-state，避免混淆在途快照。base/state-before.json 已生成：6 JAR、2真实任务；后续对比 hashes 可证明只读预览未改JAR，任务数量可能因明确点击检查增加。inspect-state 对 SQLite 以 readOnly 打开，不写状态；输出包含受控fixture路径，仅本地证据。

prepare 有 seed.json 存在保护，重复运行会拒绝覆盖已有验收数据。可反复以 cold/hot/其他 `--bc-run=<label>` 标签启动**相同profile**，不需重置。若需从零新样本，由主协调另建授权独立目录，不删除/覆盖当前物证。

已执行：prepare退出0、第二worker回读PASS；verify-manifest退出0（7产物）；inspect-state before退出0（6 JAR/2任务）；`node --check .../window.cjs`无诊断。初次manifest核对因数组枚举次序不同误报，已改为按路径排序后逐项/逐文件哈希比较，没有改产物或放宽哈希要求。

尚未验证生产main完整初始化、实际UI接线/选择/预览/正常关闭与重开；主协调运行窗口后以实际日志/桌面证据裁定。若出现问题先保留profile和日志，不在冻结产品内热修。
