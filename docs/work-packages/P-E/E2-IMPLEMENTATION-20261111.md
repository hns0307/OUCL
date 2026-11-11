# 固定整合包样本只读入口：实现和验证

2026-11-11。用户对本聊天所列 `packs:inspectFixed`、文件选择和固定样本预览界面的具体范围回复“批准”。本记录仅对应该只读增量，完整1E导入、任意mrpack和安装事务未由此批准。公共TASK_PLAN/DECISIONS保留共享工作区现状，由整合方结合用户实际答复更新。

## 实现

- `src/shared/contracts/packs.ts`、`src/ipc/packs.ts`、`src/ipc/preload-packs.ts`：版本化exact请求/结果、固定错误映射和sender验证；只暴露选择并检查的方法，不向渲染层暴露本机路径或URL。
- `src/services/packs/coordinator.ts`：同sender同请求合并、其他请求拒绝、有限选择器数量与单活动worker；窗口导航/销毁后中止worker并丢弃迟到选择结果；选择器未结束不提前释放槽。
- `src/main/index.ts`、`src/shared/contracts/handshake.ts`、`src/ipc/preload.ts`：受控原生选择器、生命周期清理与能力装配；仅检测到构建worker时广告 `packs.fixed-preview.v1`。
- `src/ui/FixedPackPreview.tsx`、`src/ui/App.tsx`、`src/shared/locales/messages.ts`：下载页提供固定样本检查入口，展示MC/Forge/Java要求、FerriteCore与覆盖信息，并明确未验证、不可安装。
- `scripts/build.mjs`：生成专用worker；不更改依赖或持久格式。

本片不对未识别包生成可执行计划；文件超过16MiB与不安全路径沿现有内部实现都映射通用不可用，不能从错误反推原因。renderer调用等待选择器真实结束，不以观察超时冒充取消，也没有自动二次打开对话框。用户取消选择是正常结果。

## 验证记录

- 全量测试：`OUCL_TEST_ROOT=<P-E/evidence/20261111> node scripts/test.mjs`，623项、619通过、0失败、4跳过；其中两个固定worker测试在通用运行器未设置专用worker路径时跳过，专用运行器另实际通过。[日志](evidence/20261111/e3-test.log)含本片5项IPC/协调测试。
- `node docs/work-packages/P-E/run-fixed-tests.mjs`：4通过、0失败、0跳过，含真实worker和取消/超时/异常退出。
- `node node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts`：通过。`node node_modules/typescript/bin/tsc --noEmit`：本轮首次因其他工作包并行修改的维护预览文件报错，后该工作区更新后复跑通过；没有修改该包文件来掩盖错误。
- `OUCL_BUILD_ROOT=<P-E/evidence/20261111/e3-build> node scripts/build.mjs`：通过；独立构建包含 `workers/fixed-pack.cjs`（17444字节）。未生成或覆盖正式EXE。
- 独立Electron（隔离userData）通过原生选择器选中E0固定样本，界面显示FerriteCore 6.0.1及“尚未验证运行环境和模组；当前不可安装”；再次打开选择器并取消，界面显示“未选择文件”。这是当前工作区独立构建的实际窗口证据，不等同打包EXE或正常重开验收。应用版本目录加载触发了现有目录读取，不能称本次窗口全程无网络。窗口进程之后已退出；未对玩家实例、旧EXE或游戏窗口操作。

GUI操作使用本机 [cua-driver技能](C:/Users/Administrator/.agents/skills/cua-driver/SKILL.md)。驱动首次后台点击报告成功但界面未变化，随后按驱动规则切换前台后观察到下载页；第二次打开选择器时驱动报告前台确认失败，但新选择器窗口及等待状态均实际出现，取消后结果确认。所有结论以上述实际状态而非单一点击返回为依据。

## 仍未验收

正式EXE重打包及冷/热重开、在真实文件选择器中选择不匹配文件、窗口销毁期间关闭对话框的真实窗口竞态、无网络/实例变化的完整物证尚未执行。对应部分由真实worker与协调器自动化覆盖，但不能替代产品实测。本片不生成实例、下载Mod或提供安装按钮；下一步需独立评估可信来源、包级提交和恢复，再按审批门禁推进。
