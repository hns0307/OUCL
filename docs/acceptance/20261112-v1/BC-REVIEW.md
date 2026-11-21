# P-B / P-C 只读技术审查

日期：2026-11-12。审查源：`D:/MC_start/OUCL`，`mod_loaders`，HEAD `b87be9dc8d3640468dbb069d29e70b6af5712d7d` 加活跃未提交改动。结论是源码审查，不是冻结或整合测试通过证明。

## 范围、授权与执行限制

先读取 TASK_PLAN、DECISIONS、根 AGENTS、ACCEPTANCE_HANDOFF_20261111，核对原始 REQUIREMENTS 的历史档案性质，并读取 B 的 APPROVAL_T1 / TASK_TARGETS_V1、C 的 PREVIEW-CONTRACT。当前 G2：B 已批准只读目标查询和实例面板；C 已批准短期内存观察、严格 IPC/preload、安全展示及取消。文件启停、卸载、持久计划、新依赖不在范围。

开始时 get_usage_limits：五小时已用 3%，剩余 97%；未以周额度作为门槛。本次没有操作 GUI、创建自动任务、启动其他聊天、修改源码/公共文档、构建、测试或 Git 提交。唯一产物是本文件。主验收方负责冻结、整改调度和整合测试。

## 可操作发现

### BC-01 [P2] 过期观察把单文件预览留在永久活动态

位置：`src/ui/MaintenancePreviewPanel.tsx:32`、`:42`、`:57`、`:67`、`:71`。

触发：预览已接纳并曾返回 queued/running；首次状态查询失败后轮询停止，用户超过 15 分钟再点击查询，主进程返回 PREVIEW_EXPIRED。状态查询和取消的错误分支均只 setError，不清除旧 snapshot。active 仍为 true，重新预览按钮持续禁用，取消/查询只能再次得到过期；同一报告没有更新时只能卸载组件再进入。

影响：把已明确失效的观察继续显示为排队/运行，阻断新只读请求；不涉及文件写入或任务失败的误判。

推荐整改：单独表示观察 expired，或收到 PREVIEW_EXPIRED 后清除 snapshot/requestId 并提示“观察已过期，可重新预览”。TIMEOUT/UNAVAILABLE 仍保留原 ID 供查询，不能混同过期。重发必须使用新 requestId，保持原观察不重放的主进程保证。

建议验收：真实 React 组件的有状态测试，queued → 查询 TIMEOUT → 15 分钟后 PREVIEW_EXPIRED → 原活动文案消失 → 同报告可发起新 requestId；取消接口返回 PREVIEW_EXPIRED 走相同恢复。现有静态初始渲染测试不覆盖该路径。

### BC-02 [P2] 影响问题展示缺少定位和解释冲突的关键字段

位置：`src/ui/MaintenancePreviewPanel.tsx:85`–`:88`；对照 `src/shared/contracts/mod-maintenance-preview.ts:15`–`:17` 的 DisplayIssue。

当前 issues 仅展示 before/after、错误文案、一个身份字段及 requirement；未展示 issue.fileId 对应文件、severity、scope、actual 或 embeddedDepth。两个不同文件出现同种依赖问题时可以得到相同可见文本；版本冲突只看得到期望范围，看不到实际版本。用户无法从列表判断是哪一个依赖方的问题或其证据来源。payload 已提供字段，无须扩展公共契约。

推荐整改：用同 fingerprint 原报告映射 fileId（不存在则 ID 加未知提示），并展示严重程度、本地/平台来源、actual 及嵌套深度；保持安全投影，不恢复原始声明、URL 或内部路径。已有 direct/transitive 文件名展示可以复用。

建议验收：两个不同依赖文件具有相同 dependencyModId、不同 severity/actual 的 fixture，断言用户可区分；平台问题与本地问题可区分；未知 fileId 不从其他报告猜名称；嵌套仅显示深度。

## P-B 核查结论与待补证

未确认阻断级源码缺陷；这不等同 P-B 全部验收通过。

- `src/shared/contracts/task-targets.ts` 使用 exact envelope/嵌套 DTO、请求关联、kind/目标/数量/序列化体积校验。`src/ipc/task-targets.ts` 绑定 sender/generation、根 ID/修订、规范化过滤条件及快照；首次读取有每 sender 1 / 全局 2 槽、2.5 秒等待上限，超时读未完成前不提前释放槽。续页 await 后复查过期、逐出和代次。不能再沿用“无游标检查”的旧假设。
- `src/services/workers/mod-targets.ts` 从 SQL 接纳与索引/计划证明目标归属；公开投影不带路径、URL、摘要证明或原请求内容。mod-check 通过 `withTargetRead` 与接纳串行；不能只以报告存在推断活动任务归属。
- `src/ipc/preload-instances.ts` 有迟到订阅清理、dispose、seq 缺口回读及 revision 不回退；`src/ui/task-observer.ts` 有可见性、generation、8 详情/2 并发/500ms 接纳及有限退避。观察解除与业务取消分离。
- `src/ui/ModPanel.tsx:35`–`:57` 已完整分页并保留全部活动任务，跨实例/根/修订有 generation 围栏。历史报告选择按身份序列的第一个可读报告，但源码明确不称其为最新，界面显示 checkedAt；批准契约也未要求 latest-report API，因此不将这一已声明边界列为缺陷。
- cursor 是 opaque UUID；不得仅因大小写变换不能重用就认定违反契约。实例/任务身份大小写和请求重复库存是另一类验证问题。

冻结后仍需按 B 规范 §9 补证：双域各 1000 / 总 2000 行与体积上限、缺失/篡改计划的真实 worker、游标 TTL/容量组合、真实产品壳的 A/B 活动选择及持久重开。旧 T1 报告明确保留这些缺项；本次未运行其测试，不复述旧测试数字为新通过结论。

## P-C 安全与生命周期核查

- `src/main/index.ts:119` 的 trustedSender 核对当前窗口、受信文档与主 frame；`:253`–`:254` 三个固定通道接入。preload 双向严格校验与 3 秒等待，不允许任意 IPC。
- `maintenance-jobs.ts` 有 requestId 幂等及同 ID 不同输入拒绝、16 观察上限、15 分钟单调计时失效、4096 请求 tombstone、串行扫描、running 取消等待实际退出、应用 close 排空。
- jobs 不按 sender 分区，sender 销毁不清结果；这是已批准契约中“窗口关闭不取消、持有 previewId 可查询”的明确语义。previewId 是观察标识，非写入许可；不能擅自以 B 的 sender 私有游标要求改变 C。未发现取消会变更 Mod 文件的路径。
- 服务绑定 root/instance/revision/fingerprint/fileId/action，并在扫描前后核对上下文；展示投影去 URL/内部路径、共享 512 项预算、缺证据或截断不判 ready。仍应在冻结树重验平台失败、同名换字节及跨实例切换。
- UI start/cancel 的异步回执未像轮询一样使用 ticket，但当前父组件以 root/fingerprint/fileId 为 key 且实例切换先清报告，未据此确认跨实例污染。需在真实 React/窗口验证该实际装配，不能只用静态渲染推断竞态通过。

## 旧报告与最新源码差异

`docs/work-packages/P-C/REPORT-20261111.md:3` 仍写公共 IPC/界面未实现，正文称未入 capability/preload/公共 schema、草案待批准，已落后于当前源码和 DECISIONS 批准记录。最新源码已有 shared schema、三个 IPC/preload 方法、main 装配/能力广告、ModPanel → MaintenancePreviewPanel 入口。应在冻结后的整合报告更正快照和证据适用范围；不要将旧 612 项测试用于证明这些后增接线已通过。

B 的 T1-20261111 报告已经描述实际接线和部分新边界，且明确最新追加前后的测试差别、受限失败与未覆盖项；不应将其全部概括为“未接线”，也不能省略尚未覆盖部分。C 专属 TSX 夹具现位于 `docs/work-packages/P-C/`，通用测试仅编译 .ts，主验收需另执行其专属检查；本次没有执行。

## 建议整合决策

B：可进入冻结后的定向/整合验收候选，保留上述必需证据缺项。C：只读范围可进入候选，但先修 BC-01/BC-02 并验证状态交互；禁止据此带入启停/卸载。两个发现都是已批准 UI 范围内整改，无需扩展契约或存储。最终可合并清单由主验收方结合冻结证据决定。

## 审查末源码指纹

以下为读取后的 SHA256，用于主验收核对是否已变化，不构成全树冻结。共享工作树期间若变动，请重定位行号并复核结论。

| 文件 | SHA256 |
| --- | --- |
| src/ui/MaintenancePreviewPanel.tsx | 29066A9A106C72A9B91D43EB802AC2F87E2EF056A27DC340677F0DA991CB2CBB |
| src/ui/ModPanel.tsx | BF82747E1FB81E87211B2013E539D863E0EF8744E86772BA233957390D6CB51D |
| src/main/index.ts | AE1F7527AEE232AA90E41B9EBA94F487E2A44E6442939F476E4B685A4398BA8A |
| src/ipc/task-targets.ts | 9379F58EBC646FB38075A23B5519F33C81469217A019A63F4837DB3C17D4C683 |
| src/ipc/installer-adapter.ts | 12BA677ECDBF3B1BC0A8F4C2475A8123A87E1476E51784F2B2BB0847A9E0774A |
| src/ipc/preload-instances.ts | 1040573B3D10C1C090C05C895BC250FA8E46D6DCE4A255DA2354FAB87C0511A3 |
| src/shared/contracts/task-targets.ts | 16A11209C5C33344015B4F1AE237327FE62F9DF4B90E8B8C4FC2A2B9DA5F1F93 |
| src/services/workers/mod-targets.ts | C84381F0C29D1ABFC6140E0E8DB257E924CF5F3DA5349F69A28B128723108812 |
| src/ui/task-query.ts | 676C964364C501769B09C52356BF05FEDA588D0E7EC34E75264A687B82ABF506 |
| src/ui/task-observer.ts | 903BAD1259EC3276BD0B4984028911024824A576276C7344F8E968D4F0ADC632 |
| src/ipc/maintenance-preview.ts | 8A36D3359E8EAB33327E73096E103D317723564BCA76C125FE9547E18DF7774C |
| src/ipc/preload-maintenance-preview.ts | 9ED1AF7B5FEC67062C8182C79A7BA2B49C9B79B942C4807FA8AC6702321B66E7 |
| src/shared/contracts/mod-maintenance-preview.ts | 34590008EB10D865DED26C4B143E8C6B84B1BCA3438495C2F623BCD584F4E8CD |
| src/services/mods/maintenance-jobs.ts | 5DB69978552922CBE48EBD4562E967D1D10CD6BBC937BF976EEF08AF38D4DE45 |
| src/services/mods/maintenance-preview.ts | 9F269946B571DBE29B4E509E17A5A3BB629E4F128C0C174E04AD12145353113D |
| src/services/mods/maintenance-presentation.ts | 39C09CDD15A921B73D3E74A328B66B6C2D03F75EE4942579F213DAEAFF055945 |
| src/core/mods/maintenance-impact.ts | EC02AB20C20E3645B7CF95B5186D82FD27C1A616B908E011A0E1EB060ACF2FA4 |

## 2026-11-12 v2 授权整改与验证追加

主验收方明确要求在独立副本 `D:/MC_start/OUCL-acceptance-v2-20261112` 修复 BC-01/02；本节追加不改变前述 v1 审查结论及历史指纹。五小时额度复查已用 13%，剩余 87%。本次只修改 v2 下列文件，未修改原活跃源产品源码或 v1 副本，未提交。

- `src/ui/MaintenancePreviewPanel.tsx`：状态查询、取消及取消后补查收到 PREVIEW_EXPIRED 时，失效轮询代次并清除 snapshot/requestId，允许新请求；TIMEOUT/UNAVAILABLE 仍保留原观察供查询。issues 增加文件定位、严重程度、本地/平台来源、实际版本及内嵌深度；缺失文件名称显示原 ID 加未知，不跨报告猜名称。
- `src/shared/locales/messages.ts`：过期文案说明可重新预览，文件改变时须先重新检查；新增“内嵌深度”固定文案。沿用现有公共 DTO，无新增契约/存储/依赖/写动作。
- `docs/work-packages/P-C/acceptance-v2-component-probe.mjs`：专属可复跑验证夹具；仅输出至该 v2 包内 `evidence/acceptance-v2-component/`。

实际运行及结果（cwd 均为 v2）：

1. `node docs/work-packages/P-C/acceptance-v2-component-probe.mjs`，退出 0，四组 PASS：TIMEOUT 后状态过期释放 UI 并以新 requestId 重试；cancel 过期可重试；cancel 成功后补查过期可重试；不同文件/严重程度/来源/实际版本/深度可区分、未知文件 ID 明示且公共 validator 拒绝 URL/路径证据。结果保存在 `docs/work-packages/P-C/evidence/acceptance-v2-component/result.json`。
2. `node node_modules/typescript/bin/tsc --noEmit`，退出 0。
3. `node node_modules/eslint/bin/eslint.js src/ui/MaintenancePreviewPanel.tsx src/shared/locales/messages.ts`，退出 0。

探针直接编译生产 MaintenancePreviewPanel 和生产公共 schema，使用受控 hook 状态/effect 实现与 mock bridge；不是 React DOM、Electron 或真实游戏验证。无需等待真实 15 分钟：mock 返回权威 PREVIEW_EXPIRED，主进程 TTL 行为仍由既有 registry 测试和主验收覆盖。未运行完整测试/构建，按本次分工由主验收方运行 v2 完整检查。

整改后 SHA256：

| v2 文件 | SHA256 |
| --- | --- |
| src/ui/MaintenancePreviewPanel.tsx | 51D7AB709A553AA5ACE77AC7033C13AA08F638B0CF2292F388544D5C88B7FD8B |
| src/shared/locales/messages.ts | 8BA6A21AD4DA2754CB20406BE0DB2F62210B280CBFCDD4EAD12DE5709CC2884F |
| docs/work-packages/P-C/acceptance-v2-component-probe.mjs | E56B51F8050CA6241151C76C3EB87419EBC9DD80984E875F28EF9E8AEEAF6710 |
