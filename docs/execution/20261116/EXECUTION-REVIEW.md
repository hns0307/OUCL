# N6 内部执行编排：独立集成验证与审查

2026-11-16。主协调独占 `services/distribution/execution.ts`，本子任务只新增 `tests/distribution-execution.test.ts` 和本报告，没有修改产品或Git提交。

## 实际结果

独占 `D:/MC_start/OUCL/tmp/execution-integration-fixed-20261116`，esbuild bundle当前测试后用Node24内置测试执行：**12 PASS / 0 FAIL / 0 SKIP，exit0**。局部ESLint与整仓TypeScript `--noEmit` 也实际exit0。

夹具使用真实临时Ed25519密钥、真实SQLite DistributionStore与OwnerGuard、真实普通文件/硬链接发布、正式release/source/coordinator/transaction代码。HTTPS获取用注入的内存Response，无公网；artifact是明确标为synthetic的普通文字文件，文件名fixture.jar仅测试路径，**不是合法JAR、Mod依赖、许可或游戏验证**。`validate`是有计数和拒绝/gate的合成产品端口，证明编排不能略过校验，不能代表真实产品JAR/许可证校验已接入。

| 用例 | 真实观测 |
| --- | --- |
| prepare→确认→重确认 | prepare无文件发布；重复prepare同身份返回同提案；正式确认提交文件和权威收据；重复confirm返回同journal；validate再次执行 |
| 空来源 | prepare拒绝；target/fetch/validate计数全0，无游戏观察或制品执行 |
| prepare后接纳更高序号 | 同一真实store经PinnedReleaseSource接纳2，再确认旧1拒绝，无目标文件/收据 |
| prepare后撤销 | 通过受控readSources端口变更当前pin撤销，旧提案拒绝 |
| 过期 | 提案/发行过期后确认拒绝，无文件/收据 |
| archive签名篡改 | payload hash仍匹配最高值但外层签名改为全零，确认真实验签拒绝，补齐store只hash payload的边界 |
| 最终validate内高序升级 | 第四次validate中真实接纳并存档2，旧1经过最后authorize后仍被SQLite收据提交事务拒绝；已发布文件回滚，journal=rolledBack |
| 身份/关闭 | 同requestId不同query拒绝；取消提案后确认CANCELLED；close后不再确认 |
| confirm尚未进入transaction时取消 | readTarget gate固定停在confirm前置阶段；cancel使原提案中止，无文件/收据，不误报NEEDS_RECOVERY |
| validate等待期间撤销 | 第四次validate改变当前pin，等待后重验拒绝；发布文件回滚，journal=rolledBack |
| 外部文件变化 | prepare后添加玩家文件，确认FILES_CHANGED；玩家文件原样保留，无包文件或收据 |
| 产品端口拒绝/会话忙 | 校验端口拒绝或实例运行状态变忙，都没有文件和收据提交 |

## 实现问题与闭合

首次7项运行实际1PASS/6FAIL，均在空权威收据的正常初次prepare路径触发 `transactionDigest(undefined)`，原生Hash.update拒绝undefined；扩大为10项时仍是同一产品根因。已通知主协调，主协调把空值比较统一为null，原断言没有放宽或跳过。

独立源码审查同时指出constructor克隆sources不能反映prepare后撤销；主协调新增主进程受控readSources端口，每次authorize读取当前记录。本测试使用该真实端口，不直接修改coordinator私有克隆对象。

另指出confirm前置阶段已设置confirming但transaction尚无active时，cancel直接调用transaction.cancel会失败且原confirm继续。主协调增加executing阶段区分，未开始事务时abort原controller；加入确定性target gate测试实际通过。validate等待后的pin重验及收据提交SQLite最高序号guard也被上述两项竞态实际覆盖。

修复后的12项全部通过，不将首轮失败说成环境问题，也不把合成产品端口当真实Mod校验。

## 可复现命令

在本main工作树，先用已安装esbuild编译测试至独占目录，再运行：

```powershell
$env:OUCL_TEST_ROOT = 'D:\MC_start\OUCL\tmp\execution-integration-fixed-20261116'
node --test "$env:OUCL_TEST_ROOT/distribution-execution.test.mjs"
node ../../node_modules/eslint/bin/eslint.js tests/distribution-execution.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit
```

编译参数：entryPoints=`tests/distribution-execution.test.ts`，bundle=true，platform=node，format=esm，target=node24；不覆写共享dist或.test-build。生成的runtime数据库、游戏夹具和文字制品只在上述独占根。

## 保留边界

默认真实来源、公钥仍为空，没有产品main/IPC执行接线、GUI安装或公网交付。正式游戏目录、旧EXE和原WIP未参与。这些集成结果不覆盖整仓完整回归或真实用户操作链。

当前coordinator最多保存16个request，终态/失败/TTL到期后未自动回收；常驻产品接线前需有界保留/tombstone语义或明确短生命周期，不能在清缓存时把旧ID重新当新任务执行。

动态pin在prepare/确认/validate等待后均重验；SQLite收据guard原子绑定最高seq/archive，尚未对外部热更新的pin配置建立持久代次CAS。当前测试证明明确触发窗口的撤销拒绝，不宣称任意跨域时刻撤销与文件提交原子一致。产品若支持运行中trust热更新，须将配置代次/串行化纳入提交准入。

## 一轮有界事务只读审查

按主协调追加任务，独立阅读 `transaction-record.ts`、`transaction-files.ts`、`transaction.ts` 当前版本；审查者没有编写这些文件，本轮不改产品、不运行全套或新增故障矩阵。

已核对：

- 未知journal格式、附加字段、计划/清单摘要不符、非法文件proof、原归属不匹配、配置破坏操作和非法pending位置均在文件变动前拒绝。journal不可变proof由transition检查约束，terminal journal不能变成新执行操作。
- 备份/发布前后核对文件dev/ino、摘要和大小；发布采用硬链接的独占目标语义。receipt是私有权威提交点；提交前失败按原proof回滚，遇未知外部文件保留并转needsRecovery；提交后按精确receipt处理完成，不把取消当回滚许可。
- finish/rollback/操作循环补核对本人lease；旧journal只有新私有metadata owner提供canRecover时能接管。终态恢复精确匹配原token并复核receipt方向后只释放本人锁，不重新应用文件、不清除异token锁。
- 取消在提交前使原controller中止；receipt提交许可开始或已有after证据时拒绝CANCEL_TOO_LATE。逐文件哈希和制品复制不在每个内部IO上监听取消，因此取消响应时间仍受当前有界文件操作影响，不能称实时抢占。

**具体残余竞争窗口（已通知主协调，未注入复现）：**`moveAside` 在检查retained目标缺失后调用Node `rename(target,retained)`。该API允许替换既有目标；若外部进程在缺失检查与rename之间创建retained，未知字节可能被覆盖，因此“No overwriting rename”注释不能作为原子不覆盖证明。`removeOwned` 的require检查与unlink之间同样存在路径替换窗口。私有staging与metadata/gameDir租约约束本客户端并发，不能阻止不遵守租约的外部进程。这是从实际API语义与await间隙推导的限制，不记为已经复现的数据丢失或已通过外部修改原子隔离。

除上述明确限制，本轮没有从journal/回滚/终态锁控制流中确认新的独立阻断问题。该源码审查不增加测试通过计数，也不取代事务子任务的真实故障测试与最终完整回归。
