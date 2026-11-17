# G 原子 claim 独立只读审查

2026-11-17，基于 F `403f15b4` 后本轮冻结差异。只读复核五个生产文件、新增 claim 测试及其原始证据；未改源码或测试，没有运行重复 full suite，没有提交。

结论：**本有限范围未发现确定阻断，可有限认可内部首次认领原语。** 这不是执行服务、真实来源或文件写入的接纳结论。

## 核对结果

- `src/services/storage/tasks.ts:175`：owner/proposal/task UUID 要求小写，digest 要求64位小写hex。`BEGIN IMMEDIATE`（同文件126）包住 requests 查找、任务读取、pristine 校验与更新；在现有独占 owner 和 SQLite 写事务条件下，不存在两个成功调用同时看见 queued 的窗口。
- `tasks.ts:181`：查询覆盖 `(owner,proposal)` 或 `taskId` 两种占用。LIMIT2 对“必须且只能一条完全一致映射”的判定足够：无行、多行、不同 owner/proposal/task/digest/kind 均拒绝，不会因为更多冲突被截断成单行。此处不是读取全域清单，不能据此宣称所有存储内容均审计完毕。
- `tasks.ts:186`：严格要求 queued/attempt0/revision1/sequence0/bytes0/无total；core start 输出还核 running/attempt1/revision2/sequence0/bytes0/无total，且提交后才返回。已有 generic update 必须提升 revision（同文件205），不能用正常更新把任务重新变成首次认领初态。
- `src/services/workers/entry.ts:79`：worker 从真实 installation 读取 root，再核 expectedRootId；调用方不能通过 command 注入 owner。`protocol.ts:181` exact schema 拒额外字段并核 UUID/digest；RecordStore 方法是内部低层端口，不是 renderer 选择 owner 的入口。
- `src/services/workers/storage-client.ts:143`：仅在本次 request 成功后校验完整首次 running 状态并返回，没有 retry、get/readback 补授或把 project 当 claim。底层超时只拒绝该 Promise，保留 pending slot 到实际 reply/exit（同文件108）；迟到响应不能让已拒调用重新取得许可。后继执行层仍必须遵守“只有本次成功返回才派发 effect”，裸 running snapshot 不代表新许可。
- `src/services/storage/records.ts:123` 和 `tasks.ts:218`：worker ready 前执行 recover；旧 running 通过 core interrupted 变 needsRecovery，claim 不接受该状态。queued 保持原态但必须继续符合全部 pristine 字段；不把中断任务自动重排为首次执行。

## 证据与限制

独立逐一重新计算六个冻结文件 SHA256，均与 `storage-evidence/checks.json` 一致。关键 tasks.ts 为 `94e84f9079a759a44e039a6108bc4d439324f122207529cb74d8cdf0ac9a33a3`，storage-client.ts 为 `dc899bddcdcc274dcafc5fd7af57ddf1fc6e84d4793030dfc2f60748699ed429`。`git diff --check` exit0（仅既有文档 CRLF 归一提示）。

读取并核对代理保存的真实日志/status：新增4项+旧投影/查询7项，11PASS/0FAIL/0SKIP，376.7679ms；typecheck与局部lint exit0。此处为独立证据复核，**未冒称本人重跑这些测试**。

non-pristine 测试经真实 generic update 形成 revision2 的 queued，验证正常可达路径不能重授；它没有单独保持 revision1 并逐字段隔离变异。源码对每个字段都有显式等值/缺省检查，此测试限制不是已证实实现缺陷，不要求机械扩大矩阵。丢 ack 格是在真实提交成功后由包装器抛合成异常，非实际传输丢包；worker 正常关闭重开确实经过 recover，非强杀。未单独新跑实际 timeout、恶意篡改 SQLite 或公共 handler。

本轮 claim 只占任务状态，不读取 admission/发行/领域许可，也不执行游戏文件。后继执行服务必须另外校验 durable admission、原始 snapshot/rootIdentity、当前可信发行/许可/idle 并使用受保护 native factory；这些既定接线条件不能由本次 metadata claim 替代。source/key 空、生产 no-port/no capability 的边界保持。
