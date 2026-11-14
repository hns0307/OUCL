# v22 · 真实JAR worker取消等待退出

日期：2026-11-14（北京时间）。仅追加证据，无生产代码、契约、依赖或授权变化。

仅首mod-archive worker通过execArgv加载私有keepalive；原entry/结果/资源限制不变。真实结果已到但线程保持存活，GUI取消在约24.3秒发生，早于原30秒timeout：原Reader terminate→真实worker exit1→原取消回执cancelled。exit1为受控终止；应用最终exit0。后续新身份预览正常completed/blocked。AUDIT有限PASS，不替代网络取消或在途关窗重开。

六JAR、五任务由所列快照核对，窗口均正常退出0。原始壳、日志、审计和截图见evidence，SHA256清单固定字节。源测试位于独立v3资料；七产品产物沿用该已验只读候选，不冒称本轮重新打包或完整EXE场景。最新main产品仍fab0ac8，v11 EXE摘要3d9a0ebaf289a9552933c97033ffbd6a069e0a0258e3ea8322cc2a5ceb6efce6。

整体仍IN_PROGRESS。C在途关闭/重开、复杂声明窗口展示、余下安全响应边界待补；A最终EXE强制中断恢复DEFERRED。排除文件启停/卸载、公开Java面板、通用整合包安装、额外依赖及后台。
