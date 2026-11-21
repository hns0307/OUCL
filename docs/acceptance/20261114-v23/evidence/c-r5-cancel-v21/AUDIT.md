# C-R5 cancel迟到有限审计

原始completed status保持8秒；原cancel真实completed保持2500ms，原样交付。B实际DOM在cancel hold与release之间，唯一接纳，同preview身份，exit0，七产物摘要一致、六JAR五任务快照完全一致、审计时owner.lock已释放。精确时间和身份见audit.json。

before快照在首预览开始后，只保证取消阶段数据不变，不覆盖初始预览之前。B记录仅三beta文件、无alpha结果或取消控制；释放后DOM去重可能没有新行，不能以空集宣称独立持续观察通过。主协调已看b-after-late.png，此处固定文件哈希并与日志层级区分。

admission及status-r2既有审计形成切换早于原回执释放的有限时序证据；status首轮切换过晚继续PENDING，未覆盖失败。加上本次cancel，三个R5有限格按各自时序/原回执/协调者截图消费分层闭合，不等于完整历史矩阵全部通过。

旧verify.cjs缺失导致MODULE_NOT_FOUND属于审计工具缺项，不是产品失败；空verification.log及原证据保持原样。复现：在本独立验收树运行 node acceptance-results/c-r5-cancel-v21/audit.cjs。该脚本不启动GUI/业务、不修改产品或旧日志，仅重写新增audit.json/AUDIT.md。
