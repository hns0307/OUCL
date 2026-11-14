# B-01 候选变更清单

## 最新候选（待统一复核）

观察池内部保守预算及跨根装配已接入，22 项 observer 测试和 1 项真实 `taskPool` 装配测试通过；另一个独立调用 `subscribeTask` 的假桥场景峰值 9，见 [RESULT.md](RESULT.md)。统一协调已明确八的预算只覆盖观察池与同 ownerKey 跨根新池，池外反例保留为范围说明；不可据此宣称全 bridge 不超过八。候选交统一协调复核，本聊天不自行整合。之前的 21/1 失败日志保留。

| 文件 | 原始 SHA256 | 当前候选 SHA256 | 改动 |
| --- | --- | --- | --- |
| `src/ui/task-observer.ts` | `5aa4b350ad8733f83527c6fc4754fdc157c773fe0ba71627a549df8c6da2efa6` | `6389279f1129064ea988bf2b75f38cbc6b2cf7c985580bc33418d948374ab05b` | 七稳定位和一轮换读取位；同 owner 的 WeakMap 已发订阅额度最多八、未知退订不复用、额度不足改查询 |
| `src/ui/InstallPanel.tsx` | `0baee89e6dd9ae09427b28a5ea43a6cff03d72dfc88bea35d6e33f05980405af` | `cae2f4d812e613e58efe0cb44f8ee2467c5c24b301269abd3a5d62c62d9205bb` | 保留原包装调度器，仅在私有构造时传入原 bridge 身份 |
| `tests/task-observer.test.ts` | `a457af3ec6303b5390e1f7e89910e4da7a7e12ec7fbca3e79e6e64ec06bb0d83` | `3ee34c93e072171f5cc3c323cb6e967e4a109a032d9e9609672248c7e3b3fbde` | 九/百任务、公平、健康心跳、迟到/隐藏/显式重连与延迟退订测试 |

当前差异：[observer](evidence/budget-observer.patch)、[InstallPanel](evidence/budget-panel.patch)、[tests](evidence/budget-tests.patch)；56 个复制源文件 SHA 见 [source-sha256.json](evidence/source-sha256.json)。另有测试专用 [assembly-build.mjs](assembly-build.mjs)、[assembly.test.mjs](assembly.test.mjs)、[outside-bridge.test.mjs](outside-bridge.test.mjs) 及候选 `tsconfig.b01.json`；这些不作为产品文件合入。

以下为上轮预算方案选择前的历史版本，差异文件和 SHA 不代表当前候选。

**未准备好整合**：当前延迟退订反例失败，原因与可选设计见 [RESULT.md](RESULT.md)。此文件用于协调复核，不是批准或提交。

| 文件 | 原始 SHA256 | 候选 SHA256 | 内容 |
| --- | --- | --- | --- |
| `src/ui/task-observer.ts` | `5aa4b350ad8733f83527c6fc4754fdc157c773fe0ba71627a549df8c6da2efa6` | `72437076ae8ece7d3bf36fdce9e72a5896835fd7100a209b51c431f87b8e96f2` | 超八项时七个稳定观察位加一个按 due 轮换的单次读取位；不轮换在途位；释放最后消费者/close 时清引用 |
| `tests/task-observer.test.ts` | `a457af3ec6303b5390e1f7e89910e4da7a7e12ec7fbca3e79e6e64ec06bb0d83` | `3ee34c93e072171f5cc3c323cb6e967e4a109a032d9e9609672248c7e3b3fbde` | 补九/百活动任务、心跳、预算、显式重连、旧代迟到和延迟退订反例；调整原固定八订阅断言为候选具体策略 |

生产源码差异：[observer.patch](evidence/observer.patch)；测试差异：[tests.patch](evidence/tests.patch)。候选辅助配置仅 `tsconfig.b01.json`，不应作为产品变更；其他类型依赖复制件未修改。原始 52 个复制源文件的路径与 SHA 见 [source-sha256.json](evidence/source-sha256.json)。所有生成输出在此包 `evidence/`，无玩家数据。

候选保留的固定逻辑是按插入顺序的七个稳定订阅；其余任务在第八位依到期时间获得只读确认，因此九任务与 100 任务的有限界限只在即时返回 fake-timer 夹具中有证据。Bridge 持续超时或结果不返回时无法保证有限完成；高任务数也受每秒两次调用的总吞吐限制，不能宣称任意数量都能每 15 秒确认。

延迟退订模型目前产生远端峰值 9；由于桥接 `dispose()` 不暴露确认，本候选不得用于声称严格远端八订阅。未改动 `preload-instances.ts`、共享类型、IPC、存储、worker 或 B-02，必须由协调者决定后续方案。
