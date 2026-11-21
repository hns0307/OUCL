# r3 内部本地Mod域适配

由既有独立额度监测触发恢复，实测primary300分钟1%已用。沿用户持续内部实现授权，起点c250ca9b；公共A未获批，仍不改IPC、持久schema、task/outbox、签名格式、真实配置或第三方依赖。

拟改新增文件：主协调拥有local-mod-domain-types.ts、local-mod-evidence.ts及公共记录；audit_baseline拥有local-mod-domain.ts和必要同域state模块；audit_ui拥有独立domain真实JAR/worker/事务测试与fixture；audit_n1只读审查。已验纯投影复用，不改旧scope。

目标：明确main-owned的本地artifact及许可binding；真实inode/runtime匹配；source nlink1/前后stamp/严格worker scan/sha-size；有界缓存、single-flight、取消和close/drain；真实private journal区分前置投影与已发布最终inventory，remove stage需backedUp，其余变更published；完整local/platform兼容检查和server-only硬阻断。

这些检查不提供许可来源、不创造ownership、不下载、不写游戏内容或receipt。verified只可由将来受审main policy提供，临时测试决定不是真实许可。source前后stamp不是持handle原子保证，copy/native事务仍独立复验。

验证：局部type/lint、真实合成JAR+扫描worker、真实库存/私有Store+事务及native factory的有限联合格；错误hash/source替换/unknown权限/缺platform/runtime/错journal/迟到/close边界；最终实际存在的typecheck/lint/test/build全检，保留失败和原始fd日志。测试全用独占D盘根，不触玩家/WIP/旧正式EXE，不push。
