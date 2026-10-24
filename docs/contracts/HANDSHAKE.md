# 空骨架IPC契约 v1

批准来源：DECISIONS末尾默认方案与阶段0工程启动批准；采用提案已有 `app:handshake`，不增加业务通道。请求/响应的权威可执行定义在 `src/shared/contracts/handshake.ts`。

请求 `{contractVersion:1,requestId:UUID,payload:{supportedVersions:正整数数组1–4项}}`，拒绝未知字段/null/非法数值。响应为带相同contractVersion/requestId的ok判别联合；成功data为 `{selectedVersion:1,capabilities:[],sessionId:UUID}`。空能力列表明确没有业务能力，不注册其他假成功通道。

错误包括validation.INVALID_ARGUMENT、validation.UNSUPPORTED_CONTRACT、permission.INVALID_SENDER、system.TIMEOUT、system.UNAVAILABLE；仅固定messageKey、retryable与随机traceId，不暴露堆栈、路径或原始请求。非法requestId不回显，用traceId代替。

主进程验证受管webContents、主frame、完整入口URL。preload只暴露无参数handshake，不允许任意invoke、路径、URL、脚本或Electron事件。超时3秒，清理timer；请求只读无任务、无取消、无订阅，因此没有幂等重放或退订状态。窗口销毁删除会话，重载需重新握手；当前不建立持久授权。

主major为1，仅协商该版本。未知major拒绝；响应同样严格校验，不能在capabilities添加业务名来假装已实施。后续业务契约/schema变更先审批，再同步两端与测试。
