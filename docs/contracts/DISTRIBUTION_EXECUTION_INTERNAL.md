# N6内部发布/事务协议

2026-11-16实现记录，非已启用产品IPC。纯schema和内部方法分别位于core/distribution/release.ts、services/distribution/{release-source,store,execution,transaction-record,transaction-files,transaction}.ts。

- v2发布payload：releaseFormatVersion=2、sourceId/packageId/packageVersion、sequence、issuedAt/expiresAt（UTC毫秒）、manifestSha256、既有v1 manifest；外层Ed25519 signature。固定规范键序列化，精确目标/签名/hash/时间验证后才CAS接受；同序同摘要重做CAS线性化，降序/同序异摘要拒绝。15秒预算覆盖fetch/read/authority，超时CAS结果未知时不回滚高水位。
- 私有仓库：Windows OwnerGuard独占的distribution.sqlite，application_id 0x4f554450/user_version1。release_states记录最高序号与规范发布摘要；accepted_releases归档必须匹配高水位；journals/receipts是带revision的JSON CAS行，未知schema/identity/SQL故障停写。只接受open前已有journal作为前任恢复候选，含终态未释放本人lease。
- 计划：formatVersion1、txId/rootId/instanceId/instanceRevision、source/package/version、sequence、manifestSha256与manifest。journal记录不可变planDigest/leaseToken、beforeReceiptRevision/beforeReceipt/afterReceipt、每文件dev/ino/hash/size、phase和write-ahead pending。prepared/applying/committed/rolledBack/needsRecovery转移严格解析，原始proof不可改、终态不可复活。
- commit点是私有receipt原子CAS，不是文件存在或游戏目录裸收据。receipt写入同一SQLite事务再次比较journal after证据和已接受最高发行/归档，失败走提交前回滚；回执丢失从精确txId/planDigest/receipt方向恢复。进入commit许可或已存在after证据时取消拒绝。未知外部改动保留现场needsRecovery；不处理saves、不隐式迁移或收编。
- 内部prepare/confirm最多16身份；同ID异输入拒绝，确认重读快照及当前信任/环境。要求真实产品注入JAR/依赖/许可证验证和可信制品适配，空配置不能执行。

Node path-based mutation adapter尚有外部写入竞争窗口；同handle平台适配、热撤销代次与常驻请求回收未闭合前不开放产品执行。详见执行报告的准入缺项，不能把内部单测成功理解为全产品远程更新已交付。

2026-11-16 r2后继：内部journal升级为formatVersion2，新增不可变gameIdentity:{dev,ino}；恢复先核对当前gameDir实际inode，旧v1 journal按未知格式停写，不自动迁移。coordinator快照同样纳入根目录inode。请求上限改为16个active作业与1024个seen身份的轻量tombstone；TTL为5分钟，过期或失败身份不重新执行，完成确认从权威journal只读恢复；达到seen上限需新document生命周期，绝不LRU驱逐旧ID。createFiles仅为内部平台factory端口，cooperative默认适配器不是产品准入；native helper仍有独立阻断，不能由本条视为已启用。
