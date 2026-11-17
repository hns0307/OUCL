# 本地Mod域适配：真实JAR / worker / SQLite / native集成验证

2026-11-17。公共A方案未批准，本轮仅验证内部LocalModDomain；不新增公共IPC/schema、真实网络、依赖或产品接线。子任务独占新增测试、fixture和本报告/证据，未修改生产或旧测试，未提交Git。

## 实际结果

最终 **15 PASS / 0 FAIL / 0 SKIP，exit0，10308.2199ms**。整仓TypeScript与本测试/fixture局部ESLint均exit0。

- [最终15项原始输出](domain-evidence/tests-coordinator-final.log)、[最终源码/helper摘要](domain-evidence/status-coordinator-final.json)
- [类型检查结果](domain-evidence/typecheck-coordinator-status.json)、[lint结果](domain-evidence/lint-coordinator-status.json)，对应stdout/stderr日志也保留
- [首轮13项](domain-evidence/tests-first.log)及[补prepared signal后的14项](domain-evidence/tests-final.log)输出与摘要保持原样；主协调随后只要求补一个coordinator联合格，最终15项通过

最终冻结测试源SHA-256 `c97e4cdc2dd77e54dd2878f28c09843d744539673f5140ab92ac2a7635684f7a`；fixture源SHA-256 `aabab1135adc08d28497298b7d582433116e44303a18accafc80539f2ad02242`。LocalModDomain冻结源SHA-256 `2f850757db0afe8c041b5a111f4dd74549f690df9b39740b3291dab2681bd8d7`。

## 测试事实

| 场景 | 已实际验证 |
| --- | --- |
| prevalidate→真实事务→postvalidate | 自生成有效Fabric声明JAR，经真实ModArchiveReader worker和ModInventoryService扫描；临时Ed25519签名经PinnedReleaseSource与真实DistributionStore高水位/archive接纳；实际native factory发布，两个authorize均调用domain，SQLite receipt/journal完成。返回source证据精确绑定planDigest/index/hash。 |
| 内部coordinator联合链 | 正式DistributionExecutionCoordinator的prepare→confirm→重复confirm→CANCEL_TOO_LATE→close全部通过；使用同一真实domain/worker/SQLite/native工厂。prepare沿相同seq/hash重新验签CAS，收据只提交一次(revision=1)，最终JAR nlink=1、lease释放、activeScans=0；无新增公共调用。 |
| replace / remove / keep | 真实add→replace→remove三笔顺序事务通过；最终库存缺少旧JAR不会被重新执行投影误拒。remove journal file.stage=backedUp，keep不生成事务file项，未受管player.jar保留。 |
| 外部变更 | published检查点将目标改成另一份有效合成JAR；domain报FILES_CHANGED。因未知字节同时改变暂存/目标hardlink，事务保守NEEDS_RECOVERY，保留未知目标/lease，receipt未提交；不谎报回滚成功。 |
| journal三格 | 真实staged(prepared)、published(仍pending)、receipt-committed后全新domain无pre-session，分别拒绝JOURNAL_UNAVAILABLE；authority journal保持不变。 |
| 未决条件阻断 | class桥接层实际拒绝permission=unknown、平台hash映射缺失、平台server_only和Java版本未知；均不发布文件或收据。denied、坏JAR、错hash等helper基础边界由主协调独立helper测试负责，本组不重复大矩阵。 |
| 不支持的范围 | mods子目录路径和resourcepacks区域拒绝UNSUPPORTED_OPERATION；不把有效JAR内嵌套声明一概禁用，沿既有纯检查语义保留unknown阻断。 |
| source重绑定 | pre完成后将source改名并同路径写入完全相同字节，新inode使artifact拒绝FILES_CHANGED；原source保留，不按相同hash静默换来源对象。 |
| TTL / 容量 /身份 | maxSessions=1、maxSeen=4、TTL=20ms的可控时钟下，容量失败、到期tombstone和同tx异内容均拒绝；过期不能重收编；上界非法TTL拒绝。 |
| 等待中clock回拨 | 已prepare的artifact在readContext等待期间回拨到created-1，释放port后拒绝DOMAIN_EXPIRED，不返回path。 |
| prepare后signal取消 | validate(A,signal)成功后abort，立即释放唯一session槽；B验证成功，A仍CANCELLED不可复活。 |
| worker取消 / close两格 | 实际worker读扫描已启动时取消原signal或close domain，await真实reader settlement后activeScans=0。取消后新plan可再验证，close后DOMAIN_CLOSED。 |

两项worker测试使用正式ModArchiveReader，其Promise在worker exit后settle；fixture只记录调用起止和转发signal，没有伪造扫描结果或用假worker替换。平台/许可拒绝组是多个子场景，完整Node测试计数仍严格为15，不把每条断言重复计项。

## 信任与验收边界

合成JAR使用仓库已有modZip生成，不复制第三方源码/素材/Mod；声明、CRC和hash由真实worker解析，fixture.bin为惰性数据，不是实际运行的Minecraft Mod。context端口明确供应MC1.20.1、Java17.0.1、Fabric0.16.14的合成已知事实，不冒称本轮实际Java进程探测或加载器启动。

platform/redistribution许可是明确的typed合成main ports：来源许可只返回与当前planDigest/index/artifactId/hash/size精确绑定的fixture证据，平台映射按真实worker SHA512/SHA1/size关联自生成JAR。`synthetic.invalid` URL不会被请求。这证明协议绑定和阻断语义，**不证明真实来源、真实平台匹配或许可证已经审查**，不得用这些port替身开放公共执行。

前三笔成功与外改等事务均使用真实SQLite DistributionStore及native factory；仅实例/context与许可/平台端口为合成。没有强杀游戏或未知进程、没有用户资料/正式EXE操作。原始故障通过明确检查点或端口gate注入，不能替代产品UI/公网/游戏验收。

主协调修复的clock回拨与prepared signal两个具体边界均有上述实际代表测试；累计scan facts的8MiB实现预算未在本15项中构造超阈值巨型事实，不将静态防护写成该边界实测。

## 复现与文件所有权

独占最终根 `D:/MC_start/OUCL/tmp/domain-tests-coordinator-final-20261117-r3`，前两轮根单独保留。使用已安装esbuild按bundle=false/platform=node/format=esm/target=node24/outbase=.编译src/*.ts及本测试/fixture/mod-zip，保留真实worker相对目录结构；不覆写共享dist/.test-build。

```powershell
$env:OUCL_TEST_ROOT = 'D:\MC_start\OUCL\tmp\domain-tests-coordinator-final-20261117-r3'
$env:OUCL_SOURCE_ROOT = $PWD.Path
node --test "$env:OUCL_TEST_ROOT/.test-build/tests/distribution-local-mod-domain.test.js"
```

需要硬链接/自有helper子进程的运行经require_escalated正常自动审查，仅触独占D根。测试内真实编译helper、由受保护metadata loader取得factory；最终helper21504字节，SHA-256 `44c795a4c1bf6d4a9c2be12c24247405b1918b75b1dff9275699f0864bc45092`。最终领域/编排源码摘要见status-coordinator-final；前一轮实际worker编译条目及库存/reader源码摘要也在status-final保留。

只新增 `tests/distribution-local-mod-domain.test.ts`、`tests/helpers/distribution-local-domain-fixture.ts`、本页及domain-evidence，未改生产/旧测试/DECISIONS。初次静态检查仅发现fixture未使用readFile导入，已删除后执行真实测试；没有通过修改断言/跳过制造绿色。交由主协调统一fullcheck/审查/本地收存，测试和fixture现已冻结，不再扩范围。
