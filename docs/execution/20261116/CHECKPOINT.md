# 额度保存与恢复入口

2026-11-16（Asia/Shanghai）。本轮开始primary 300分钟窗口4%已用，保存时92%已用、剩余8%，resetsAt=1794824262；按保留规则停止新增实现。独立额度监测仍由来源聊天负责；不创建重复监测、不使用重置券、不购买。用户“额度够高立刻恢复”的新规则优先于旧的等待刷新措辞，恢复时实测可用额度即可，不看周额度暂停。

工作树：D:/MC_start/OUCL/本地资料/OUCL-download-main，起点49086688。当前所有本轮源码/日志按精确文件本地保存，最新提交以git log为准；tmp未提交，原mod_loaders WIP不动。没有push发布。用户持续执行授权有效，站点/来源/公钥仍明确留空。

## 已验证并保存

- 内部v2发布、权威高水位/签名归档、SQLite journal/receipt CAS、真实FS事务与内部prepare/confirm/cancel/recover。无公共执行接口；新类型、协议、领域适配准入详见REPORT和contracts/DISTRIBUTION_EXECUTION_INTERNAL.md。
- 最终完整796项792PASS/0FAIL/4既有SKIP，56.853秒，exit0；类型/全lint/build通过。最后增加“receipt必须绑定applying journal”之后，17项专注与完整796项均重新通过。原始证据final-evidence。
- 候选EXE execution-20261116为49086688冻结只读首片，内嵌九文件/七产物通过；正式EXE保持。候选实际外层运行握手capabilities为空、服务UNAVAILABLE，初始化UNKNOWN；进程正常exit0不算功能通过，现场保留。详见PACKAGING。
- Windows同handle文件操作spike只有一轮1PASS/3FAIL，未修断言、未重试、未进生产。源码/原始观察/退出码在spikes/distribution-file-guard，详见FILE-GUARD-SPIKE。

## 下次最小增量

1. 先读取TASK_PLAN/DECISIONS、REPORT和本页，核对Git状态/本地保存提交与真实额度。
2. 解决并实测spike的目录handle guard：当前FILE_READ_ATTRIBUTES未阻止外部Directory.Move，导致两个rename格未实际到达。证明同handle身份删除、禁止覆盖目标的rename以及祖先目录不可替换后，才设计正式平台适配。不要用Node检查后rename/unlink假装跨外部进程原子隔离已完成。
3. 另一个独立增量定位候选EXE初始化失败；最多有界诊断，保留run1—5证据和owner现场，不清锁、不自动替换正式EXE。移除inspect继承的猜测未被证实，根因仍UNKNOWN。
4. 上述安全准入闭合后，再接N6公共确认/持久任务/恢复UI。真实制品映射、JAR/依赖/许可验证仍需受控产品适配；内部validate/artifact端口的测试替身不是这些能力。动态trust热更新需配置代次门禁，常驻coordinator需有界请求/tombstone语义。

用户技术文档任务尚未全部完成；不把796单测全绿、包完整性或正常退出改写为整体产品验收通过。
