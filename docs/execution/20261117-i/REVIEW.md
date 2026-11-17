# I fresh-bound事务入口：独立只读审查

2026-11-17，基线H55fa9a35。只读核对transaction.ts工作树diff及transaction-files.ts既有目录绑定/清理路径，只新增本报告；未改源码或测试，未启动GUI/native试验或重复fullchecks。I后按协调者指令停止新增实现。

最终审查源码SHA256：`ee2aaf187bb47a47f724752ed91f84917a3cee6716680a7579d4447048f611f9`，与实现代理冻结摘要一致。主协调要求入口先有界检查再复制primitive，已只读复核最终代码；旧488637摘要属于修正前，不作为最终认可源码。实现代理报告整仓typecheck/局部lint0；本审查没有冒称再次运行，也不预记测试代理或主协调尚未收到的结果。

## 结论

**在本片限定范围内未发现新增阻断，有限认可内部fresh-bound基础入口。** 该入口不是执行授权；生产仍须由未来executor独立核durable admission/projection/原快照及亲自取得的本次G fresh claim，只能注入受审protected native工厂，不因此广告configured backend。

| 审查点 | 源码证据与判定 |
| --- | --- |
| mandatory factory | commitFreshBound在进入事务前要求createFiles存在，fresh分支再次要求，绝不沿legacy的Node默认适配器回退。函数存在本身不证明其实现受保护；main装配仍负责受审native工厂。 |
| strict copied DirectoryProof | 入参先exact dev/ino及primitive数字字符串长度上界、ino非零校验，随后重建仅两string字段的私有proof；不先clone未知大对象。非法或getter异常INVALID_TRANSACTION。factory另收`{...expectedRoot}`，调用者/工厂修改参数不会改私有比较基准。 |
| 任何existing journal拒绝 | 进入commitInternal后先read旧journal；fresh存在expectedRoot即NEEDS_RECOVERY，发生在authorize/target/factory之前。包括committed/rolledBack，不复用legacy终态早返，不按phase补授。 |
| 首次factory绑定 | fresh第一次创建files即传原expectedRoot；initialize后把game.gameIdentity.dev/ino与私有proof逐字段比较，显式比较错为FILES_CHANGED，尚未artifact copy或prepared journal/lease。实际换inode也可能更早被initialize/bindRoot拒绝，沿原catch映射NEEDS_RECOVERY；两者均为保守拒绝，不构成绑定穿透。 |
| legacy保持 | commit仅转发commitInternal且不带expectedRoot；可选factory及默认适配器、旧terminal分支和恢复代码保持原行为，没有将fresh拒重放规则偷偷扩到legacy。 |
| active同步占位 | 两公共async入口在任何await前调用commitInternal；plan同步parse后检查并设置active，第一处await才是journals.read。另一并发commit/recover不能穿过占位；try/finally原样释放active。 |
| 取消/cleanup | 原combined signal、authorize/artifact传递、receipt commit许可点、cancel-too-late、ledger方向、finish/rollback/release及SimulatedCrash处理未改。fresh proof只影响初次files绑定，不给commit/rollback/recover添加取消参数或中断清理。 |

## 保留的具体边界

- strict proof或缺factory拒绝在实际事务工作前；fresh被已有journal拒绝不意味着旧lease可释放，必须走H只读判定或显式受审恢复。
- initialize后身份不符或未claim前失败，可能保留私有staging；当前没有沿不明目录自动删除的逻辑，本片不承诺自动清理或可以无journal盲重试。
- combined signal在await期间撤销仍沿既有检查点与回滚收敛，不能把“发出abort”写成“无任何metadata/staging变化”；commit开始后的ledger/finish方向不被取消推翻。
- expectedRoot通过trusted main-owned factory传递；恶意/不受审factory能写什么不由“factory非空”消除，不能把内部测试工厂当产品准入。
- Fresh入口自身不读取durable admission、任务projection或G claim，不证明许可证/发行当前可用；其注释已明确调用者先取得成功fresh claim。未来执行服务还须补生命周期、状态/结果持久化、target观察与控制/显式恢复门禁。

本报告只审本次diff与必要调用链；未把旧legacy终态早返当作严格H checker，未重复验证已验native原语，也不替代I专注真实测试和主协调全检。真实source/key/许可政策仍空，A批准不授权跳过这些条件。

测试代理首次把真实inode更早拒绝写成只允许FILES_CHANGED，实际为NEEDS_RECOVERY；原始失败保留，随后按真实保守错误对齐断言，并未修改产品错误映射以制造通过。最终测试数字以测试报告/原始日志为准，本只读审查不提前填写。

保存状态：主协调实测primary剩8%触发保存，I作为WIP等待额度恢复后完整检查；本次不启动新测试/实现或fullcheck。最近完整通过提交为H `55fa9a35`，不能将其fullcheck结果记到I源码。此REVIEW现已冻结，仅文档由主协调统一收存。
