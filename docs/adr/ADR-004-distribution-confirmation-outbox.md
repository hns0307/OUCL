# ADR-004 分发确认与任务投影

状态：2026-11-17用户明确批准方案A；实施按可验证增量推进，未等同产品执行已开放。

问题：私有分发ledger与既有任务库是两个SQLite提交域。超时或退出可能发生在确认落盘、任务投影、标记投影之间，不能假定跨库原子提交或每次重试随机创建taskId。

决定：DistributionStore先以唯一proposal/transaction和内部canonical inputDigest持久接纳确认，生成一次taskId；确认request aliases绑定同意图。相同意图恢复原回执，异意图冲突。意图包含完整plan、真实root inode/prepare fingerprint及accepted发行摘要，避免重开重新收编变化基线。新admission同事务验证archive/highwater；旧回执读取不重授执行权限。

outbox与admission同库提交。后继以固定taskId将任务和request原子投影到RecordStore的tasks/requests（非TransferDatabase下载checkpoint库），成功读回比对后标记projected。projected仅是观察投影，不是执行或receipt成功。重开双向检查缺失/冲突，未知状态停写needsRecovery；无confirmed admission不投影，不自动重启未确认prepare，无journal不盲目重放文件写入。

执行继续由当前信任/有效期、高水位、根/实例修订、完整领域/许可和native proof gate复验。真实source/key/locator/policy未配置时不广告公共execute。既有preview独立，可信主文档/sender校验、exact schema、3秒IPC与有界准备/订阅语义不放宽。

迁移：私有distribution schema1→2须事务保留旧四表和已存权威记录；unknown schema/corruption/owner不明拒绝。具体列/唯一约束/限额由首片typed schema与真实迁移测试给出，不宣称当前task接线已完成。

验证：重复确认同task、别ID同proposal alias、冲突拒绝；确认已落盘但任务/ack丢失的重开；固定ID双库对账、取消commit边界、真实native链及空配置无副作用。未得到证据的格继续保留未完成。
