# N1 实例只读概览子任务

日期：2026-11-15。执行范围来自本次用户要求读取并执行 `docs/EXECUTION_HANDOFF_20261115.md`，不新增公共 IPC、持久格式、依赖或权限。

## 产出与接线

- `src/ui/InstanceOverview.tsx`：只读当前实例状态/身份/隔离/会话、关联 Mod 任务、刷新与进入任务中心。
- `src/ui/instance-overview.ts`：有界关联任务查询、失效控制、会话选择、已证明任务修订合并。
- `tests/instance-overview.test.ts`：八项专注单元测试。

主协调将组件放在现有首页当前实例卡片中；建议保留现有游戏版本、加载器和目录入口。签名为 `InstanceOverview({ instance, rootId, targetsEnabled, sessions, tasks, onOpenTasks })`。`targetsEnabled` 仅在握手广告 `task-targets.v1` 时提供；`onOpenTasks` 切换下载页现有任务中心。

TaskSnapshot 没有实例身份，不能将全局任务按当前选择推断归属。此组件只通过既有 `listInstanceTaskTargets` 查询已证明归属的 `mod-check` / `mod-install`，每次最多20条；有 nextCursor 时标明仅载入部分，其余可进入任务中心。全局快照只用于推进已经证明归属的相同 taskId、相同 kind，保留较高修订。组件没有任务取消控制，不复制既有 InstallTask 的观察与控制流程。

读请求经共享 `rendererTaskReads` 预算；换根或实例时 close 并屏蔽旧 identity，迟到的旧请求不发布。请求失败只改变读取连接状态，不把任务改为失败。继承隔离显示“沿用全局设置”，不凭 enum 猜测实际目录。Java 仅说明启动前复测，不显示未公开的精确版本。会话只取相同实例；主协调仍须保证传入 sessions 属于当前根（既有 useGameSessions 换根前保留数组的行为不由本组件改写）。

## 共享文案接入清单

主协调拥有 messages.ts，本子任务没有修改该文件。需添加：

| key | 中文 |
| --- | --- |
| overviewStatus | 实例状态 |
| overviewIdentity | 实例标识 |
| overviewTasks | 此实例的模组任务 |
| overviewTasksScope | 这里只列出已确认关联的模组检查和安装任务；其他任务请在任务中心查看。 |
| overviewNoTasks | 当前已载入记录中没有关联任务。 |
| overviewTasksUnavailable | 暂时无法确认关联任务，任务执行状态未改变。 |
| overviewTasksPartial | 仅展示已载入的关联任务。 |
| overviewSession | 游戏会话 |
| overviewNoSession | 尚未观察到此实例的游戏会话。 |
| overviewJavaHint | Java 会在启动前检查；此概览不提供未验证的 Java 版本。 |
| overviewTasksOpen | 打开任务中心 |
| overviewRefresh | 刷新概览 |
| overviewIsolationInherit | 沿用全局设置 |
| overviewTaskQueued | 等待处理 |
| overviewTaskRunning | 执行中 |
| overviewTaskVerifying | 校验中 |
| overviewTaskCommitting | 提交中 |
| overviewTaskPausing | 正在暂停 |
| overviewTaskPaused | 已暂停 |
| overviewTaskCancelling | 正在取消 |
| overviewTaskCancelled | 已取消 |
| overviewTaskCompleted | 已完成 |
| overviewTaskFailing | 正在处理失败 |
| overviewTaskFailed | 已失败 |
| overviewTaskNeedsRecovery | 需要恢复 |

CSS 可对 `.instance-overview-facts` 使用响应式定义列表，对 dd/code 添加断行规则，对 `.instance-overview-tasks small` 独占一行。无新全局布局假设。

## 实际验证

独占临时输出：`D:/MC_start/OUCL/tmp/execution-n1-20261115/instance-overview.test.mjs`，没有写共享 dist/.test-build。

```powershell
node --input-type=module -e "import { build } from 'esbuild'; await build({ entryPoints: ['tests/instance-overview.test.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'D:/MC_start/OUCL/tmp/execution-n1-20261115/instance-overview.test.mjs' });"
node --test D:/MC_start/OUCL/tmp/execution-n1-20261115/instance-overview.test.mjs
node D:/MC_start/OUCL/node_modules/.pnpm/eslint@10.13.0/node_modules/eslint/bin/eslint.js src/ui/InstanceOverview.tsx src/ui/instance-overview.ts tests/instance-overview.test.ts
```

结果：8 PASS / 0 FAIL / 0 SKIP；局部 ESLint exit0。首次尝试 main 本地不完整的 `node_modules/eslint/bin/eslint.js` 返回 MODULE_NOT_FOUND，随后直接调用既有父目录固定版本成功，未安装新依赖。八项覆盖跨实例迟到、同实例刷新乱序、连接失败不伪造执行状态、单页上限/部分标识、错误归属拒绝、已证明身份单调修订、会话筛选、inherit 保留。

尚待协调者：新增文案后全类型检查、App接线/CSS、完整回归、UI验证与独立审查。没有新运行 GUI、真实游戏、强杀或公网取消；历史25 FAIL没有被此子任务修复或抹除。
