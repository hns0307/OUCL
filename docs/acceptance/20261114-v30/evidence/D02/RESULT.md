# D-02 隔离复现及候选结果

日期：2026-11-14。状态：**候选完成，待统一管理聊天独立复核与整合**。稳定产品代码 `fab0ac873f34d8581bf065e14fa7a9aa93c0baa3`；复制时稳定main HEAD `262d757ecad08add5a0db16817b2adab01b98149`（后继文档），没有在稳定main、C隔离Git、共享WIP或旧冻结副本写入。无Git提交、GUI、网络、游戏、依赖安装或公开IPC/持久格式变化。

候选绝对路径：`D:/MC_start/OUCL-review-round-20261114/P-D/verification/d02/candidate`。仅复制稳定main的222个src文件及4个构建配置，不复制玩家、缓存、历史证据；[原始逐文件SHA256](evidence/source-manifest.json)、[配置SHA256](evidence/config-hashes.json)、[修改文件双摘要](evidence/changed-files.json)。候选 `node_modules` 是只读使用既有 `D:/MC_start/OUCL/node_modules` 的目录联接，未修改其内容。稳定main依赖目录缺少smol-toml，首次指向其联接不完整，已只更换本包联接；当前实际版本React19.3.1、TypeScript6.0.3、esbuild0.28.2、smol-toml1.9.0与候选package声明相符。

## 复现先于修复

[修复前输出](evidence/before.log)：使用正式GameAdapter代码、原LaunchControls组件代码、替代React hooks/JSX及bridge的隔离夹具（不是真实Electron窗口）。构造needsRecovery且原因为REVISION_CONFLICT、LAUNCH_FAILED、NEEDS_RECOVERY：前三者分别显示“实例信息已改变，请刷新后重试”、“游戏未能正常启动…”和“暂时无法完成请求”，没有显示保留文件提示；前两种投影retryable=true，三种启动按钮均启用。三项恢复断言失败。真实状态/原因是输入夹具，没有把本用例称作许可后真实进程或真实数据库复现。

## 候选修改与验证

精确差异见 [PATCH.md](PATCH.md) / [PATCH.diff](evidence/PATCH.diff)。GameAdapter对needsRecovery固定投影既有`NEEDS_RECOVERY`（既有字段和错误码，retryable=false）；普通failed仍保留原因。LaunchControls在接收到needsRecovery时立即显示既有`stageRecovery`并禁用当前面板启动按钮；后续getTask拒绝时不覆盖恢复提示，回调本身也拦截再次启动。存储记录的根因并未删除，但公共snapshot此时只表达恢复码。

[修复后输出](evidence/after.log)：三种原因均得到`NEEDS_RECOVERY`、retryable=false、“需要恢复，请保留文件并检查目录状态。”且按钮禁用；即使直接调用已禁用按钮的处理器，累计launchGame调用仍为1。模拟getTask Promise拒绝仍保留恢复提示与禁用。queued/running无错误、按钮保持进行中禁用；普通failed的REVISION_CONFLICT/LAUNCH_FAILED仍显示原文、原错误码及可用按钮。没有把替代hooks/bridge夹具称为真实渲染器、窗口或完整事务。

本轮实际命令（PowerShell，仓库根以外均使用绝对路径）：

```powershell
node D:/MC_start/OUCL-review-round-20261114/P-D/verification/d02/evidence/build-fixture.mjs
node D:/MC_start/OUCL-review-round-20261114/P-D/verification/d02/evidence/probe.mjs
# 工作目录为 candidate：
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src/ipc/game-adapter.ts src/ui/LaunchControls.tsx
node D:/MC_start/OUCL-review-round-20261114/P-D/verification/d02/evidence/build-candidate.mjs
```

夹具退出0；候选src及vite配置typecheck退出0，改动文件lint退出0；独立esbuild打包main、preload、普通worker、固定包worker及renderer退出0。状态见[check-status](evidence/check-status.json)，详细输出见同目录 `typecheck-final.log`、`lint-final.log`、`build.log`。这是esbuild可构建性检查，不是Vite正式构建、全仓lint、全量测试、最终EXE或实机。此前未建立依赖联接时的类型检查失败与错误的lint路径日志保留，不计通过；最终检查使用完整既有依赖联接。

## 明确限制

`recoveryBlocked`仅保留在**当前LaunchControls组件生命周期**。切换实例或重开后组件会重建，而现有公开launch任务快照不携带实例目标，不能保证重开后仍禁用按钮；本片没有引入新的持久状态、公共字段或跨重开关联。主协调应评估是否接受此局部UI限制，或将持久关联作为需审批的后续设计；不能把本片描述为跨重开强制互锁。

需要恢复的任务在其他入口仍保留其原有状态与行为；本片没有修D-01连续失联，也没有更改D-03检查快照语义。首次创建目录联接在受限执行中被拒绝访问；之后经已批准的权限请求仅在本包建立联接，未触碰依赖目标。未出现自动审批拒绝。
