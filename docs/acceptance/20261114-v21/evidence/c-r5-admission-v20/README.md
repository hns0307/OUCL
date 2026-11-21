# C-R5 admission 单格：仅准备未运行

固定v3七产物、原已关闭v4-bc seed.profile。独立目录，与另一模式不可同时打开。沿用前轮window.cjs启动方式，原main/preload/安全配置保留。只hold首次真实成功admission回执2500ms，低于原3000ms超时；原结果原样释放，退出清timer并释放。不自动GUI、不发业务请求、不改领域时钟或React状态。

主协调CUA以单run_steps快速执行：在A发起预览后立即切B。保留实际held/delivered时间与500ms只读DOM选择观察。必须实测B选择早于release，否则PENDING，不以事后截图反推。若未形成2500ms窗口，可停止，不扩大延迟跨过TIMEOUT。释放后停留B，截图及DOM核对无A文件/结果，再正常关闭。

node verify.cjs只读核对七摘要、原样交付和B早于释放前提，不冒称完整UI通过。DOM采样可能漏掉过快切换，缺证据仍PENDING。

cancel迟到最小设计仅候选：A已有active身份后人工取消，原cancel返回后短hold并人工切B，检查原结果不进入B；本轮不建该运行、不同时开启、不扩展批准范围。
