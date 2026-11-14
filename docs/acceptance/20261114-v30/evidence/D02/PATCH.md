# D-02 候选补丁

基线代码 `fab0ac873f34d8581bf065e14fa7a9aa93c0baa3`，读取main时HEAD `262d757ecad08add5a0db16817b2adab01b98149`。候选 `D:/MC_start/OUCL-review-round-20261114/P-D/verification/d02/candidate`；可审查[统一差异](evidence/PATCH.diff)，逐文件摘要见[changed-files.json](evidence/changed-files.json)。

1. `src/ipc/game-adapter.ts`：需要恢复时公共错误投影优先NEEDS_RECOVERY，其既有retryable为false；普通failed仍使用原原因。
2. `src/ui/LaunchControls.tsx`：当前面板接收needsRecovery即显示stageRecovery并禁止普通启动；getTask拒绝不能覆盖恢复提示；组件卸载/重开不会持久保留此本地标记，见RESULT限制。

结果和验证步骤见[RESULT.md](RESULT.md)。上述文件仅在独立候选改动；未更改接口schema、持久格式、依赖或安全配置。整合时应对照原始SHA，只选择两个差异；独立fixture需要协调者审查后决定如何纳入正式测试。
