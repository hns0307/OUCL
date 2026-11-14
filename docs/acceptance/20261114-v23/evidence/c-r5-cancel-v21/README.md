# C-R5 cancel迟到单格，仅准备

固定v3七产物、原已关闭v4-bc profile，沿用window.cjs启动方法。未运行GUI，未改源/契约/领域时钟/Reactstate。

先由GUI在A发起一次预览，首次真正completed status回执hold8秒，原3秒TIMEOUT后保留active取消入口。主协调待该入口可见，再用单run_steps取消后快速切B。只有原cancel真正返回completed才hold2500ms，其他结果仅记录前提失败。原回执原样释放，不自动调用业务或GUI。

必须从实际DOM证实B选择位于cancel held和delivered之间；若晚于释放或未观测到，PENDING。status hold与cancel hold分别记录实际时间，不能混用前一8秒窗口证明取消迟到。释放后B的三beta文件应无alpha结果或取消控制；截图、DOM、request/preview同一性及正常exit0共同审计。退出清timer原样释放，保持两次原结果。

取消后组件可能尝试status查询，是否发生及是否到达旧组件须保留真实日志，不能阻断或手造成功。未观察到后续查询不等于领域取消；后台completed先赢。仅本格，不并开其他壳。
