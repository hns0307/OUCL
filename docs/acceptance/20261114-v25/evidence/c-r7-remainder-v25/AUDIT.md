# C-R7 剩余四项有限审计

新增audit.cjs已实际执行：同requestId首次接纳、不同action返回INVALID_ARGUMENT；三次真实PREVIEW_EXPIRED分别经负向注入错previewId/额外url/额外path，原preload均返回UNAVAILABLE，request身份及记录顺序一致。七产物摘要一致，零archive worker，will-quit存在，审计时owner.lock不存在。

冲突的原handler日志只记录requestId/返回码，完整输入差异由已运行壳的固定表达式与first input佐证，不伪称原handler已记录全部payload。注入ok=true是明确负向queued夹具，不是领域业务成功。非主frame仍不可达，零worker不等于直接scan计数。

旧verify第10行失败原因是日志fields.kind覆盖外层kind，三条注入记录实际以各mode命名，因此旧计数得到0。属于审计标签误判，不是产品失败。旧脚本、日志及verification.log保持原样，不重跑业务。

主协调正常AltF4关闭；日志有will-quit，但没有进程exit0记录，不声称退出码0。

复现：在v11独立验收树运行 node acceptance-results/c-r7-remainder-v25/audit.cjs。脚本只读产品/原日志，写新增audit.json/AUDIT.md，不启动Electron。
