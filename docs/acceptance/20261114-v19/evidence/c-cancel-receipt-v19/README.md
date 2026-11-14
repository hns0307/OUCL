# C-R3 完成先赢、取消回执超时：仅准备

沿用 P-C 已批只读预览。固定 v3 七产物与原已关闭 v4-bc seed.profile；未启动 GUI，不改生产 preload、领域时钟、结果或组件状态。额度检查五小时剩余92%。原 profile 必须由协调者确认无其他进程使用后启动。

协调者 CUA 启动原 Electron 并传入本目录 window.cjs（沿用 c-admission-v14 启动方法）。壳仅延迟首次实际 completed status 回执8秒，以及随后首次实际 completed cancel 回执8秒。所有原输入、原输出、sender/frame、held/delivered 和只读 DOM 变化写 window.jsonl；退出会清理 timer 并原样释放挂起结果。没有自动合法业务调用或 GUI 点击。

1. 人工选择原合成实例/文件并发起一次只读预览。
2. 等待首次 completed status 被 hold，以及原 preload 3秒 TIMEOUT。组件保留旧 queued/running snapshot，poll 错误分支不再调度，因此取消入口应保持。截图确认，若入口不在则停止并记 PENDING。
3. 人工点击取消。原 cancel 必须实际返回 completed，证明完成先赢；壳才延迟该回执。等待第二次 TIMEOUT，截图确认。若原结果不是 completed，壳仅记录前提不成立，不能宣称通过。
4. 等两次8秒 hold 均释放后，人工点击“查询”，确认原 previewId 仍 completed、展示原结果。不得点新预览来替代查询。正常关闭并记录 exit0。

取消会递增 generation，让旧 poll 失效；此时 poll 已因 TIMEOUT 停止，单次 setAccepting 更新不会改变 effect 依赖，静态看不会自行抢先查询。上述为可达性分析，实际 DOM 仍待验。若行为不同保留失败，不注入 React 状态。

只读检查：`node acceptance-results/c-cancel-receipt-v19/verify.cjs`。运行前只比对七产物并报告 PREPARED_NOT_RUN；运行后检查两次真实 completed、原身份、原样释放、延迟、后续同ID completed、没有额外接纳及正常退出。GUI TIMEOUT/结果展示和六JAR五任务不变仍需协调者原有证据流程，不由此脚本冒称。其余 R5 场景不在范围。
