# L root-owned J→K 编排

新增私有 `DistributionExecutionRunner(rootId,ports)`，公开内部方法 run(proposalId,taskId)、cancel(activeProposalId)、close；不修改 J/K、主进程装配、IPC、schema 或依赖。

固定 root、严格 projected admission/projection 及 inputDigest/task 绑定。仅 pristine queued 走 J→K；已有 completed/failed/running/needsRecovery 只能 K 结算/历史读取，不调用 J。重复 settled 可绕过 J 对 current receipt 的要求，返回真实 durable StoredTask，不返回薄 evidence。末尾重读 admission/projection 精确匹配 K 返回的完整 terminal execution。

J 失败后尝试 K：若真实证明 completed，返回真完成，避免误报取消；若落 failed，保留可信 typed J 原错误，绝不推断 cancelled；K 无稳定证据时仅最新状态仍为 pristine queued 才保留 source/idle 等可信原错，running/未知 claim/partial 无证据均 NEEDS_RECOVERY，不重 claim 或复位 queued。

root 单 active job 从读 admission 贯穿 J、K 到最终读回；同 proposal/task 单飞，其他 job 忙而非排队，不能在 J 结束/K 未完成间启动下一 receipt 写入。seen 最多1024轻 proposal，在真实绑定后记录，wrongtask 不污染正确后续身份。该 mutex 仅约束本入口：root 装配必须让所有执行写入由同 runner 独占，不能声称阻挡外部直接调用 legacy coordinator/transaction。

cancel 在 metadata preflight 仅标记取消、阻止迟到启动，J 阶段委托原事务门禁，K 阶段 TooLate；不持久取消 queued。close 同步停新与发出 J 停止请求，然后 drain 原 J/K job；K CAS 不取消、不关闭共享 J/K 或 stores。主协调指出的同步 wrapper throw 已防护：cancel 在同步 try/catch 内立即调用，异常也建立关闭 promise 等原 job，不用 Promise.then 推迟停止。

## 本代理实际验证

固定 Node 整仓 tsc --noEmit 与单源码 ESLint 最终均 exit0，原始日志在本目录；首轮 ESLint prefer-const 失败保留于 lint-first.log，改为 const job 的 microtask 初始化后通过。源码 SHA 见 checks.json。

真实专项由独占测试代理运行、独立审查及统一全检由其他代理/主协调收存；本文不冒称本人运行测试或全构建。无 Git 提交，无网络或玩家文件操作。真实 source/key/locator/许可政策配置不由 fixture 或此 runner 补齐，生产能力广告未改变。
