# H 终态证据只读审查

独立审查 `src/services/distribution/admitted-terminal.ts` 及其复用的 journal/receipt/admission parser；未修改产品或测试，未运行测试或整仓检查。当前有限结论：未见确定阻断。

- 输入 expectedRootId 要求小写 UUID；admission 严格解析且必须 projected/root 匹配，plan 及 gameIdentity 取自真实调用方提供的私有 admission，不重建 renderer 计划。
- admission 与每个 envelope 在 clone 前检查字节；journal/receipt envelope exact revision/data，revision 必须正 safe integer，data 独立受 MAX_RECORD_BYTES 限制。错误统一 NEEDS_RECOVERY，不泄漏底层异常。
- 按 J/R/J/R 顺序，每次 await 后立即有界 snapshot；两次 journal、两次 receipt 必须 revision 和完整 data digest 一致，消失、出现或改变均拒绝。
- journal 必须原 planDigest/完整 plan、proposal txId、目录 dev/ino 匹配，仅 committed/rolledBack。既有 parser 另校验 pending、file operation/proof、before/after receipt 推导与终态阶段。
- committed 只接受真实 receipt revision=before+1 且 data 完全等于 afterReceipt；rolledBack 只接受 before revision/data，before=null 时必须真实缺 receipt 且 revision0。方向没有混用。
- 稳定无 journal 返回 undefined，明确不是 fresh claim 或文件执行许可；有不匹配/部分 journal 不降级到 undefined。

这是历史私有元数据证明，不验证当前玩家文件、当前发行许可、当前 key/时间或提供执行/恢复授权；后继执行服务仍须独立控制这些边界。digest 采用仓库既有 JSON 序列化语义，字段顺序等价变动可能保守拒绝，不导致假成功。
