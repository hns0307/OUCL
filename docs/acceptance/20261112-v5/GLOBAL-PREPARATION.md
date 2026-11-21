# 全局任务中心正式安装夹具准备

2026-11-12。状态 **PREPARED / 窗口未启动**。复查批准记录后，仅在独占 `D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v5-global/` 新增脚本与数据；活跃树只新增本报告。开始五小时剩27%，高于20%门槛，未以周额度门槛停工。未改产品源码/契约/冻结产物或旧profile；未伪造SQL状态/补假安装任务；未启动GUI/游戏、提交或增加依赖。

## 本次解决的准备前提

此前v4合成ready实例缺原install admission，导致全局列表先读取实例安装任务时TASK_NOT_FOUND。此处没有修产品或修改旧数据，而在全新profile调用**正式 InstallerService.create 两次**完成真实安装事务，随后调用正式ModTaskService完成检查与报告。`InstallerAdapter.dispatcher(...)(tasks:list,{limit:100})` 返回**2条install + 2条mod-check，全部completed，无nextCursor**，关闭并另起真实StorageClient/worker及Installer/Mod服务initialize后，列表身份与报告仍可读。没有TASK_NOT_FOUND。

安装执行包含正式接纳、SQLite日志/状态机、可信摘要传输、共享对象、实例物化/收据及ready提交。外部metadata reader和下载transport只提供本地生成的固定数据，域名保持产品规则形状、摘要与字节对应，但**不是Mojang上游成功证据**。客户端jar只是标注SYNTHETIC NON EXECUTABLE的文本；空资源索引、无普通库/native；无Java，无游戏运行。正式create负责生成实例身份/记录/revision，未手写ready。

Mod报告来自正式context、库存、JAR worker、检查与持久任务服务。每实例放一个本地JSON-only Fabric声明JAR，而实例为vanilla，因此报告localState/state均unsatisfied，另有平台NETWORK_FAILED；不伪装加载器或平台已知来源，不将此样本称兼容游戏。Mod报告观察的实际instanceRevision均6，准备脚本从存储读取修订后接纳，不硬编码。

## 路径与身份

下文base=`D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v5-global`。

- 全新profile：base/profile；游戏根：base/synthetic-games。
- rootId：`50000000-0000-4000-8000-000000000001`。
- A：`GLOBAL-A Synthetic Installed Vanilla`，instanceId=`528fb120-c25a-5362-a32a-bf7411524655`；installTaskId=`1d5ca48b-de12-480a-b84a-e44b61a7f005`；modTaskId=`b1cd9fd4-93ef-41f4-aa2c-c1dec4f76486`。
- B：`GLOBAL-B Synthetic Installed Vanilla`，instanceId=`aea2680d-17c4-5c07-9837-8cd964a1b010`；installTaskId=`c925a628-bea3-4e3a-98af-308648ee2689`；modTaskId=`f236be40-ca29-4952-bb96-1b146f3af798`。

base/seed.json保存两实例报告、四任务首次/重开列表和请求计数；base/preparation.log保存正式准备输出。两组任务completed只表示本地合成输入上的正式服务完成，不保证Mod声明满足/真实MC能启动。

## 主协调启动（唯一操作GUI）

冷启动：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\v5-global\window.cjs' '--global-run=cold'
```

点击产品顶部“下载”，滚到“任务记录”，等待四张历史任务卡片全部显示已确认。应有两个“安装完成”和两个Mod检查完成，任务ID与上表对应。可分别点A/B看各自报告，但无需重新发起检查。**不要点击启动游戏**，夹具客户端不可执行。

正常关闭并等待exit0，再热启动相同profile：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\v5-global\window.cjs' '--global-run=hot'
```

同样进入“下载”查看四卡片及确认状态，正常关闭。提取：

```powershell
node acceptance-results/v5-global/extract.mjs cold hot
```

提取器逐运行要求：公开listTasks返回四个预期ID且completed，两种kind各至少2；DOM包含这四个data-task-id、completed状态且data-observation-state=confirmed；有will-quit与exit0。全部满足输出PASS/exit0，否则INCOMPLETE/exit2。原始证据base/window-cold.jsonl、window-hot.jsonl，摘要base/window-extraction.json含首个通过采样行号。不能只凭四个后端任务就称窗口验收通过。

## harness边界与已验证

window.cjs只设置新userData、清除继承portableRoot、禁硬件加速、拒绝所有HTTP/HTTPS，并记录公开handshake/listTasks与DOM；不替换domain、仓库、preload、React组件或hooks，不自动点击/提交。产品包逐字节复制协调方已有v3七产物，核对原product-manifest.json中**7项SHA256全匹配**；没有重新构建或patch。数据准备专用services.cjs只在prepare运行，不被产品窗口加载。

实际命令：`node acceptance-results/v5-global/prepare.mjs`退出0，正式adapter列表与真实worker持久重开断言通过；`node --check .../window.cjs`及`node --check .../extract.mjs`无语法诊断。未运行全量检查或真实窗口。prepare成功后seed存在保护，拒绝覆盖物证；旧v4三条及后续任务完全保留在旧profile。

剩余由协调方确认：完整生产main启动、任务中心DOM四卡片、观察确认、正常冷/热退出及持久重开。当前只证明真实正式服务/adapter和worker层，不提前宣布产品壳通过。

| 新脚本 | SHA256 |
| --- | --- |
| prepare.mjs | 63457B4F88D6DA46F3A157B91969D1458E778098CDA0F0C580FA8BBA4305D362 |
| window.cjs | 90D94D99DAC0DF85C4CCECAF15261695A72D790F54C1C98E1E7A245E628EFF73 |
| extract.mjs | 001553724CB53659F569EDEF85A2E6FDA0B60D6FC8C6F5D04FFE9F1B61EF6015 |

## 额度暂停交接

2026-11-12主协调通知五小时已用81%、剩19%，按规则停止新增验收。本包准备已完成，window.cjs与extract.mjs均已交付；未启动v5-global窗口，因此cold/hot产品壳与四卡片DOM验收仍未执行，不能记为通过。下一步额度实际刷新且足够后，由主协调按上文冷/热启动及提取命令继续，无需重跑prepare或创建新数据。

本次只追加本交接，不新增GUI、产品或数据工作。v5-global新profile、旧v4 profile、日志及七产物均保留，不改不删。主协调另报D原版及Fabric实机结果由其独立证据负责，本报告不将那些结果混作GLOBAL合成任务中心窗口通过。停止等待额度。
