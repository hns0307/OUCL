# 方案A：公共执行严格契约基础

2026-11-17。用户已明确批准PUBLIC-EXECUTION-PROPOSAL方案A；本次仅新增 `src/shared/contracts/distribution-execution.ts` 与独立契约测试。未修改handshake/preload/locale，未广告能力，未实现main handler、任务执行或新网络；真实sources/key仍空。原批准/验收记录不改写。

## 导出API

- `DISTRIBUTION_EXECUTION_CAPABILITY='distribution.execute.v1'`；`DISTRIBUTION_EXECUTION_CHANNELS` 固定五通道，与批准提案一致。
- `DISTRIBUTION_EXECUTION_IPC_TIMEOUT_MS=3000`、`PREPARE_TIMEOUT_MS=120000`、`PROPOSAL_TTL_MS=300000`、`MAX_ACTIVE=16`、`MAX_SEEN=1024`、`MAX_OPERATIONS=256`、`MAX_PATH=1024`、`MAX_RESPONSE_BYTES=1048576`（其余名称均有相同完整前缀）。这些只是边界常量，不代替未来handler的计时/取消实现。
- 类型 `DistributionExecutionBinding/Proposal/Preparation/Accepted/Recovery/Code/Error/Payloads/Data/Request<C>/Result<C>/Bridge`，错误码列表常量 `DISTRIBUTION_EXECUTION_CODES`。
- 严格guard：`isDistributionExecutionBinding/Proposal/Preparation/Error(value)`；`isDistributionExecutionPayload/Request/Data(value,channel)`；`isDistributionExecutionResult(value,request,channel)`。结果必须与原有效request及真实channel相关联。
- 固定失败工厂 `distributionExecutionFailure<C>(requestId,code,traceId)`；category/messageKey/retryable映射不可任意修改，traceId为规范小写UUID。复用现有MessageKey，不引入自由错误文本/堆栈。

| 通道 | payload → 成功data |
| --- | --- |
| distribution:prepareExecution | Binding → Preparation |
| distribution:executionPreparation | {prepareRequestId} → Preparation |
| distribution:cancelExecutionPreparation | {prepareRequestId} → {cancelled:boolean} |
| distribution:confirmExecution | {proposalId,instanceRevision,sequence} → {taskId,proposalId,snapshot:TaskSnapshot} |
| distribution:recoverExecution | {taskId} → {taskId,recoveryRequestId,snapshot:TaskSnapshot} |

外层为 `{contractVersion:1,requestId,payload}` 与同版本/同requestId的 `ok/data` 或 `ok/error`。Preparation.ready仅proposal非null，failed仅error非null，pending/cancelled/expired均二者null。Proposal绑定root/instance/source/package/version、proposalId、sequence/revision/expiresAt；变化/冲突互斥，单笔总计≤256，禁止重复/父子重叠Windows路径、越界/设备名/ADS/控制字符及config破坏性变化。每条相对路径≤1024字符且组件≤255。

Accepted/Recovery使用真实既有TaskSnapshot validator并核对重复taskId，未伪造unknown/any结构或强迫未就绪kind。任务kind增量由主协调在后继/并行任务域统一处理；本文件跟随实际TaskSnapshot union，不改变现有公开validator。结果还核对prepare业务Binding、prepareRequestId、confirm proposalId、recover taskId与recoveryRequestId。

## 实际验证

最终 **7 PASS / 0 FAIL / 0 SKIP，exit0，86.9731ms**；[输出](tests-final.log)、[源码摘要](status-final.json)。覆盖五通道正向、future version/extra字段、小写UUID、256/257操作、1024/1025路径、遍历/设备名/ADS、跨状态DTO、跨实例/请求关联、TaskSnapshot、未知错误/错误映射漂移、超响应预算及循环对象。额外明确拒绝数组等非string标记，不能利用String coercion伪装literal。

1MiB检查是完整响应的防御门禁；当前合法DTO受更小结构上界约束，测试未声称构造了合法DTO的恰好1MiB+1边界。超预算输入与恶意结构均实际拒绝，序列化异常返回false。

局部ESLint exit0，主协调补齐其TaskCenter并行kind文案映射后整仓TypeScript最终结果见 [typecheck-final-status.json](typecheck-final-status.json)。较早的并行TaskCenter缺项日志保留；一次工具脚本编排变量拼写错误不计产品失败，已经读取实际退出码文件确认结果。未改断言、跳过或额外依赖。

独占测试根 `D:/MC_start/OUCL/tmp/execution-contract-20261117-a`，现有esbuild bundle至 `contract.test.mjs` 后用Node内置测试；工具使用已安装固定父目录TypeScript/ESLint，未经pnpm安装入口。

冻结contract SHA-256 `c0f3960932315b1ab848c9c4e2b959d47557039b7e3b99e647ed2e556109c870`；测试SHA-256 `a8b377f0854110d2ee8c260df844812a1087df27d4cc1d12be6aad28496aa49a`。未提交Git。

## 接线门禁仍有效

纯契约不能证明执行能力已经可用。未来主进程必须在受保护helper、metadata owner、持久接纳/outbox、领域适配及受审source/key全部就绪后才广告capability。配置为空时任何调用必须SOURCE_UNAVAILABLE，且不能读target/扫盘/联网。订阅、退订和已接纳任务取消沿现有task公开范式，需单独完成真实装配、计时、幂等与sender/文档验证；本增量没有把共享类型当业务成功。
