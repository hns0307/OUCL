# Mod文件事务与恢复验证

日期：2026-10-28（Asia/Shanghai）。原批准安装/恢复方案的内部提交增量；尚未开放公共确认任务/安装按钮。

## 实际实施

固定worker日志和受控实例JSON可选modCommitId已接通。gameDir标记与游戏启动共用；暂存使用独立私有副本，逐文件复核三摘要/大小后保存dev/ino并独占新增。实际库存/环境/计划/会话复验后，以实例唯一modCommitId+下一修订JSON作为提交点，随后同步索引和committed日志。只读共享对象不会成为可写Mod的hard link目标。

回退不递归清理，所有材料保留。已发布文件的身份和内容仍匹配才移动回私有恢复目录；外部替换/改名文件保留，外部编辑则停在needsRecovery并保留标记。恢复使用原日志token及精确JSON身份，提交后不凭中断或取消猜测回退。

## 检查与故障测试

- 最终`pnpm check`：491项，489 PASS、0 FAIL、2个既有系统能力SKIP；类型、lint、coverage、production build成功。core行98.83%、分支96.90%、函数99.56%。初次类型检查的scan数组缺少显式类型已补齐；之后完整检查490项通过，补充校验中取消回归后最终491项通过。
- 11项事务测试使用生成的JAR、明确惰性Minecraft metadata夹具、真实SQLite/JSON存储与真实JAR worker。真实Mod文件写入只发生在独立`.test-build`测试目录，不代表真实Minecraft安装或游戏运行验收。
- 成功事务实际写入两个JAR，实例和索引修订均为2、modCommitId对应事务，重试不重复发布；修改可写Mod后共享对象字节保持不变。
- 第一文件发布后故障回退本次文件，原修订保持1、标记释放、暂存和回退材料保留。
- 用户编辑本次文件时原字节保留且needsRecovery继续阻止启动；外部替换/改名文件不被移除，其他本次新增文件回退。
- 外来session标记和同名玩家文件原样保留；提交点前取消回退，提交点后中断/取消从唯一JSON提交证明完成结果。
- 实例/日志ack丢失可精确重连；索引失败后真实存储worker关闭/重开可完成提交；提交点前中断重开可回退。未来日志格式的typed读/写拒绝，原JSON逐字节不变。
- 校验中取消传递到worker边界，并等待退出后回退，没有开始新的暂存复制。

`node scripts/mod-transaction-runtime.mjs`在已安装Electron45.0.0的as Node模式与**正式打包dist worker**下重新执行11项：11 PASS、0 FAIL、退出0；见`electron-runtime.json`。运行器收集完整TAP统计并拒绝空结果，Windows GUI EXE直接调用的空输出未被用作验收。

未新增依赖，未联网、未启动真实Minecraft、未修改用户游戏数据或现有EXE。未执行真实断电/任意kill矩阵；故障注入与正常重开不替代该矩阵。

公共确认任务/index、计划取消互锁、实测Java事实及任务/UI装配仍待实现；完整四加载器/Mod目标继续进行。
