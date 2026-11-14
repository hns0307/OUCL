# P-C 独立只读审查

审查日期：2026-11-14。结论：发现一项可由既有真实窗口证据直接确认的问题列表展示缺陷；另有一项由源码推导、尚未单独复现的旧错误提示残留风险。未发现足以推翻既有有限证据的其他确定性缺陷；这不等于全部安全、生命周期和真实网络场景已通过。

## 范围与基线

按任务计划、实际批准记录和 v26 交接，本轮只审查只读 `mods-maintenance-preview.v1`，包括接纳/重试、状态/取消、IPC/preload、sender、跨实例迟到、TTL/退出及复杂声明展示；不涉及文件操作、持久执行计划、新依赖或后台。稳定候选 `D:/MC_start/OUCL-download-main`：调度时 HEAD `26483918cef993266d541e9aacc8249c4ad4c2d4`，审查末 HEAD 已前进到文档提交 `2f7202c`；相对产品 `fab0ac8`，`src`、package.json 和 pnpm-lock.yaml 无差异，工作区干净。证据使用原始 v13–v26 记录及代码；没有运行 GUI、构建或测试，没有修改产品。

## 发现

### P2：缺失依赖问题行显示依赖方而隐藏缺失项

位置：`D:/MC_start/OUCL-download-main/src/ui/MaintenancePreviewPanel.tsx:93–100`。问题行用 `issue.modId ?? issue.dependencyModId ...` 只取第一个非空字段。v26 A 原始 `docs/acceptance/20261114-v26/evidence/c-r6-window-v26/window.jsonl:11–12` 记录两条 `MOD_DEPENDENCY_MISSING`：依赖方均为 `dependent_mod`，缺失项分别是 `parent_alias`、`nested_mod`；实际 DOM 和 `a-relations.png` 的两行均显示“缺少必需模组。 dependent_mod · 要求 *”。用户在问题行无法区分缺少哪个前置，且容易把依赖方当作缺失对象。展开关系可分别看到两个名称，因此不是数据丢失或兼容性判断错误，但问题行本身具有误导性，尤其是不同问题可能有不同要求或时刻。

同一单字段回退也隐藏平台固定版本：v26 B 的 `window.jsonl:21–22` 显示项目 `ProvPr01`、要求版本 `ProvVr02` 均在 payload 中，页面只显示项目；`b-completed.png` 可见不匹配提示，不能称版本 ID 可见。provider 的 `embeddedDepth` 也未在声明列表中显示（第 87 行；v26 A nested_mod 深度为 1），该两项已列在 v26 当前清单中，不重复当作新发现。建议在获授权的后续 UI 增量中明确标示依赖方与缺失 ID、同时展示平台项目及固定版本，并就嵌套深度按批准的展示要求处理；使用包含相同依赖方、两个不同缺失项及项目/版本同时存在的用户可见断言验证。

### P3：成功取消查询后可能保留先前超时提示（静态推导）

位置：同文件第 35–45、58–69、79–82 行。轮询失败会设置错误；用户随后取消时第 60 行使旧轮询失效，若取消回执及后续 status 成功，第 66 行只更新 snapshot 而不清除 error。若返回终态，页面可能同时显示旧超时告警和已取消/已完成结果，且终态不再显示重新查询按钮。v19 报告确认取消前存在旧 TIMEOUT 文案，但该轮取消回执也超时，因此不能把本审查推导的“成功取消后仍残留”称为 v19 已实测。建议后续在可控测试中先制造状态查询超时，再令取消及最终 status 成功，检查终态和 alert；若确认，成功采纳新状态时清除旧观察错误。此项不表明取消失败或数据被修改。

## 已核对的证据和边界

- IPC：`src/main/index.ts:121–122,254` 将可信窗口、session、senderFrame URL 与主 frame 判断传入处理；共享契约对各通道数据进行严格验证。v25 只证明原 handler 对同 requestId 不同 action 拒绝、以及注入的三类不合法响应被原 preload 拒绝；测试注入不是真实成功扫描。非主 frame 真实 IPC 在当前安全配置不可达，未验，不应降低安全配置补证。
- 身份与异步：v15 接纳响应丢失后的同身份重试、v19 完成先赢及回执超时、v21/v23 接纳/状态/取消响应跨实例迟到的隔离，各按原记录限定解释。面板 `matches` 校验 root、实例、修订、指纹、文件、摘要及动作，generation 抑制旧轮询；这些不等于穷尽所有竞态。
- TTL/取消/退出：v13 是真实等待的 15 分钟保留到期；v22 是真实 JAR worker 加私有 keepalive 后取消并等待 worker exit，v24 是 worker 同类生命周期注入下的正常关窗、旧身份过期和重开新观察。worker exit 1 为受控终止；v24 app 两次 exit 0。v17/v20 的真实网络 pending 前提未形成，仍为 NOT_EXERCISED，早 close 根因 UNKNOWN；不得将 worker 注入等同真实网络取消或在途网络退出。
- v26 使用严格白名单合成传输替身，保留正式解析、worker、服务、IPC、preload 和 React；不是实际 HTTP 或公网验证，也未启动游戏。A/B 的 payload、DOM、四张截图与上述展示结论对应。v25 记录 will-quit 和 owner 释放而无进程退出码，不得写成 exit 0。
- 既有 v11 完整检查及 v12 游戏记录是历史证据，本轮未重新执行。总体仍 IN_PROGRESS；A 最终 EXE 强制中断恢复、真实网络 pending 取消/退出及非主 frame IPC 保持现有边界。

## 建议的最小后续动作

先由主协调确认 P2 展示问题是否纳入已授权修复增量；P3 先通过局部可控测试验证。此报告不授权修改契约、产品、额外依赖或启动新 GUI 场景。只有获得新的请求活动性证据后，才重新设计网络 pending 场景；不要重复 v17/v20 的无前提尝试。
