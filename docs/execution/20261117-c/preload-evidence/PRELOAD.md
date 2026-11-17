# 执行 preload transport 局部验证

2026-11-17，已批准方案 A 的 C 增量。独占新增 `src/ipc/preload-distribution-execution.ts` 与 `tests/preload-distribution-execution.test.ts`；未改公共 glue、共享契约或来源配置，没有提交。

## API 与行为

唯一导出：`createDistributionExecutionBridge(ipc: { invoke(channel: string, input: unknown): Promise<unknown> }, timeoutMs = 3000): DistributionExecutionBridge`。第二参数仅供内部测试缩短等待，必须为整数 1..3000，不能延长批准预算。

五方法严格沿共享契约命名：`prepareDistributionExecution`、`getDistributionExecutionPreparation`、`cancelDistributionExecutionPreparation`、`confirmDistributionExecution`、`recoverDistributionExecution`。通道字符串固定，不接受调用方指定任意通道。

下发前复制并严格校验完整 request；非法输入返回固定 `INVALID_ARGUMENT` 且不 invoke。prepare/confirm/recover 的有效调用方 ID 保持不变，status/cancel 使用新 cryptoUUID。独立保存用于校验的 request 副本，避免调用方或 transport 修改绑定。

结果使用共享 `isDistributionExecutionResult(value, request, channel)` 校验两次（原始与 detached 副本），包含 envelope、业务身份、任务 kind、输出预算和安全路径。无效结果、异常或不可复制响应统一为固定脱敏 `UNAVAILABLE`，不转发原始异常、路径或堆栈。合法上游错误沿固定映射保留。

3 秒 transport 超时返回 `TIMEOUT` 与原有效 requestId，**执行结果仍未知**。不自动重试、不暗中取消；迟到 resolve/reject 已被 Promise.race 接管，不改已返回结果。确认/恢复的原 ID 重试由调用方与主服务负责。120 秒 prepare 预算、proposal TTL、任务持久化及来源空 failclosed 由主服务负责，本 transport 不伪造这些结果。

## 真实验证

独占编译文件：`D:/MC_start/OUCL/tmp/preload-execution-20261117-c/test.mjs`。无 Electron、网络、游戏目录或新依赖；Node 合成 invoke 仅验证 transport，不能代替真实生产 IPC 验收。

9 PASS / 0 FAIL / 0 SKIP，118.5621 ms，exit0：

1. 五通道、精确 payload、调用方 ID 与 status/cancel 新 UUID。
2. 非法 UUID、额外字段、不安全标识符在 invoke 前拒绝。
3. 错误 envelope、prepare/root/proposal/task/recovery 绑定拒绝。
4. future version、错误 task kind、路径遍历、超大、循环与抛异常 getter 响应拒绝。
5. 合法 SOURCE_UNAVAILABLE 保留；未知 error code 和 detail 注入拒绝。
6. invoke 同步抛错与异步拒绝脱敏。
7. timeout 保留 ID、不重试/取消，迟到成功不替换 TIMEOUT。
8. 迟到 rejection 已处理；非法 timeout override 拒绝。
9. 输入和返回值与调用方/transport 引用分离。

全工程 `tsc --noEmit` exit0；新源/测试局部 ESLint exit0。原始输出在 `tests.log`、`typecheck.log`、`lint.log`，对应 status JSON 记录实际退出码。

```powershell
node --test D:/MC_start/OUCL/tmp/preload-execution-20261117-c/test.mjs
node D:/MC_start/OUCL/node_modules/typescript/bin/tsc --noEmit
node D:/MC_start/OUCL/node_modules/eslint/bin/eslint.js src/ipc/preload-distribution-execution.ts tests/preload-distribution-execution.test.ts
```

源码 SHA256：`b83341236d4599c060ac5afea50a2133a2959af210ffb4b01163788a72342f4f`。
测试 SHA256：`aac63d4274602a301e1196ae66c2dda996efd713d8f1366d175a268aa673358a`。

源码与测试已冻结，交主协调做 glue、全回归和提交；本报告不预记后续结果，不广告 capability，不声称真实来源已可执行。
