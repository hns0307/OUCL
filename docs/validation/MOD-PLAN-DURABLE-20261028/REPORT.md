# Mod计划持久化、恢复和取消验证

日期：2026-10-28（Asia/Shanghai）。沿用用户已批准的Mod完整计划，本次为一次可验证前置增量。

## 已实施

- 主进程`ModPlanService`与固定存储worker域真实装配。创建返回前保存原子JSON；同UUID和同参数恢复同一份计划，换参数拒绝。输入排序规范化，返回快照与消费者隔离。
- 计划保存完整request/input/plan关联及本地摘要；最大2MiB，验证根文件、目标修订、待下载量、项目去重。原文不可改，preview revision1只能转为cancelled revision2；未来格式/不明字段拒绝且保留。
- 严格公开`mods:planState`与`mods:cancelPlan`、preload读取/取消方法；响应只含公开plan/status。取消校验精确planId，重复取消幂等，同请求不能复活。未知ack结果只有精确已提交JSON可恢复成功。
- 资源库只保存可丢弃的UUID恢复指针，重载读取原计划。切换实例/修订不使用旧异步结果，旧修订提示重新检查；显示文件来源、精确大小、复用/待下载处置及依赖来路，提供实际取消按钮。

## 验证证据

1. `pnpm check`成功：471项，469 PASS、0 FAIL、2个既有系统能力SKIP。新增11项涵盖真实worker重开/CAS/不可改写、格式与关联拒绝、未来JSON逐字节保留、同请求恢复/并发/克隆、幂等取消与禁止复活、丢失ack、关闭时等待取消写入、关闭时停止metadata工作、公开IPC来源及私有信息剔除。覆盖率：行98.83%、分支96.84%、函数99.56%。
2. UI夹具和大小显示完成后，再次`pnpm typecheck`、`pnpm lint`、`pnpm build`通过，最后`git diff --check`通过。
3. `pnpm smoke:mod-plans`成功：实际生产ResourceBrowser组件、生产preload和真实存储worker；实例/资源/planner明确使用惰性本地夹具。DOM点击生成→renderer重载恢复（planner计数不增加）→取消（真实记录revision2）→新计划→修订变化提示；720px窗口无横向溢出，renderer无Node。详见`ui.json`、`cancelled.png`和`stale-small.png`。没有把夹具声称为真实Mod安装。
4. 正式main入口以`OUCL_SMOKE_OFFLINE=1`和独立profile运行`pnpm smoke`成功：36个preload方法、15项能力、renderer无Node、实际离线档案DOM创建、设置保存/CAS、五种加载器选项及新读取/取消的根检查。manifest由明确本地fixture提供，所有其他fetch在测试内拒绝，不宣称公网目录验收。见`main/smoke.json`及界面截图。

未新增依赖，未执行联网审计/公网下载/真实Minecraft启动，也未操作用户游戏数据。没有重新生成或覆盖已交付EXE。

## 未完成

确认入口、依赖实际下载、下载后逐JAR复验、占用/修订/全部文件哈希提交前复核，以及一次安装事务/恢复仍待完成。当前保存计划或取消只涉及启动器元数据，不授权写入实例；完整四加载器与Mod总目标保持进行中。
