# C 候选 shell 验收夹具增量

仅修改 `scripts/extensions-candidate-smoke.mjs` 的现有真实 main/preload renderer inspector 检查，不运行或打包候选。本片局部 ESLint exit 0（harness-lint.log）。最终 shell 结果必须由主协调实际运行后提供，本文不声称已通过。

保留原 18 项检查，新增 8 项，预期总数 26：五方法存在（合计一项）、handshake 不广告 distribution.execute.v1（一项）、五个合法调用各返回 SOURCE_UNAVAILABLE（五项）、五方法非法 payload 全部 INVALID_ARGUMENT（合计一项）。调用方法为 prepareDistributionExecution、getDistributionExecutionPreparation、cancelDistributionExecutionPreparation、confirmDistributionExecution、recoverDistributionExecution。合法参数使用即时生成 UUID 和固定 missing source/package，不使用真实实例或网站。

非法参数覆盖额外 path 字段及非法 UUID；shell 断言验证公开 preload 桥返回 INVALID_ARGUMENT，单凭返回值不证明 IPC 完全未发送，preload 本地拒绝由对应源码/专项测试独立证明。

应用 entries 数量仍取 audit.entries.length；原逐条提取 hash、runtime hash、outer/Worker/进程退出及 owner.lock 释放流程不变。未改窗口隐藏 hook、生命周期、网络 fixture、安全参数或进程控制。无产品修改、依赖或 Git 提交。
