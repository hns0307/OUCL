# N6 私有权威账本与文件事务首个闭环

日期：2026-11-16（Asia/Shanghai）。本页记录内部服务实现与独占真实文件验证，不是公共安装接口或真实社团源上线。真实来源/公钥保持为空；不接main、IPC或全局worker schema，不增加依赖，不改旧实例或采纳游戏目录里的裸receipt。

## 文件与接口

- `src/services/distribution/transaction-record.ts`：严格plan/journal/receipt parser、不可变事务证据和CAS状态转移校验。格式版本均为1；未知字段/格式、路径冲突、非字符串枚举、非法leaseToken、pending索引/步骤、file proof与manifest不符均拒绝。
- `transaction-files.ts`：真实异步FS适配。普通祖先目录逐段guard；文件以打开handle的dev/ino/size/mtime/ctime及SHA-256前后复核；拒绝符号链接、不明硬链接、超过1GiB文件。artifact先实际nlink1复验，再COPYFILE_EXCL复制到私有暂存并sync、复验；从不把可写目标直接链接到共享缓存。
- `transaction.ts`：DistributionTransactionService.commit(plan,signal)、cancel(txId)、recover(txId)。每个服务单在途；publisher/manifest/sequence、实例修订、gameDir、idle、私有ledger和lease在必要边界重新核对。
- `tests/distribution-transaction.test.ts`：独占真实文件、真实链接、原子JSON测试仓库、故障点与新service恢复；没有模拟成功替换文件操作。

`TransactionEnvelope<T>={revision:number,data:T}`。JournalRepository提供read(txId)/write(txId,expectedRevision,value)，ReceiptRepository提供read(instanceId)/commit(instanceId,expectedRevision,value)，均要求持有私有metadata独占owner并执行持久原子CAS。`assertDistributionJournalTransition(before,after)`禁止初始非prepared、改写plan/lease/receipt/proofs、状态回退及终态复活；服务自身调用，生产仓库也应在CAS事务内调用。

协调者独占的store.ts提供生产SQLite/OwnerGuard适配，execution.ts提供签名源编排；其独立验证不并入下面18项计数。本服务的端口authorize必须核对当前主进程配置、公钥/撤销状态、已接纳可信发布及精确manifestSha256/sequence；artifact必须提供已验证的本地文件，不能由renderer提交磁盘路径。服务本身不声明完成JAR语义/许可证审核。

## 提交与恢复算法

1. 严格解析并规范plan；同txId已终态只返回原结果，内容不同拒绝。授权、target revision与idle核对后读取**私有权威receipt**。同source/package的sequence必须严格递增；缺失ledger不收编旧文件。
2. 对非keep操作预检。add要求目标不存在；replace/remove要求私有ledger的source/package/managedId/旧SHA256同时匹配并核对真实inode/hash。已有config即使受管也默认冲突，玩家修改不覆盖。keep和清单遗漏均不产生隐式删除。
3. 所有新字节复制到gameDir/.oucl-distribution-staging/txId的私有普通文件。保存带old/fresh identity+hash的prepared journal，然后使用原有`oucl.session.lock`、随机token独占，同游戏和Mod事务互斥。未知既有锁不清理；lease token/nlink/普通文件条件在每个变更和提交边界复验。
4. applying阶段先持久pending(backup/publish,index)。原文件rename到唯一私有backup；若rename后inode/hash不符，保留实际移入字节并needsRecovery。新文件由私有stage用exclusive link发布，不覆盖既有目标。每次动作完成再持久对应stage；中断时依据journal中的精确proof复核，不按文件存在猜拥有权。
5. 最后在锁内重查target/idle/授权/所有新文件/ledger。设置不可取消边界后，将含txId+planDigest的afterReceipt原子CAS提交至**私有ledger**，这是唯一commit点。不是gameDir裸receipt或journal phase。回执丢失必须读回完整afterReceipt及expectedRevision+1精确一致，才能确认为已提交。
6. commit前普通失败/取消且ledger仍精确before时，只将inode+hash都匹配的新目标移入保留rollback文件，并从精确backup恢复旧目标；外来replacement或原inode被修改均保留并needsRecovery，不沿链接删除。没有递归删除业务目标。
7. recover只接纳严格journal和`canRecover(txId,leaseToken)`提供的新metadata独占owner证明；不能只靠游戏锁token推断原服务失效。精确afterReceipt则完成收尾；精确before则保守回滚；其他ledger、外改、路径或锁不明则保留现场。终态journal也可能在释放锁前中断：只有锁token精确属于原事务且ledger仍符合终态才能释放；外来锁不改。当前owner新写journal不得被第二service当成死事务。

SimulatedDistributionCrash仅为测试故障注入，直接越过正常catch回滚；新service从真实磁盘journal、backup和目标恢复。覆盖backed-up、published、receipt-committed、journal-committed及journal-rolled-back后的中断；这不是操作系统断电或正式EXE强杀验收。

## 实际验证

独占root：`D:/MC_start/OUCL/tmp/distribution-transaction-20261116`。Node v24.21.0，固定现有esbuild。默认沙箱链接能力此前已实测EPERM，因此本组真实链接测试使用自动审核批准的沙箱外执行，无网络/用户游戏访问。

最新已运行 **18 PASS /0 FAIL /0 SKIP，exit0，1700.0286ms**：

- add→replace→remove及keep/个人文件保留、私有ledger确证、真实目标最终nlink1。
- 裸游戏收据不构成管理权；已有config保留；publisher sequence回退拒绝。
- precommit取消撤回、receipt回执丢失精确复核、commit后取消明确CANCEL_TOO_LATE。
- 四个正向故障点及rolledBack终态故障，新service恢复、恢复幂等和精确原锁释放。
- 外来锁保留、未知ledger不清锁、lease被替换时停止发布。
- 外部inode替换及原inode内写保留，needsRecovery保留锁/资料。
- 既有gameDir锁、idle和实例revision阻断；未知journal/篡改lease/proof/pending（含数组步骤）拒绝；链接祖先不触及外部sentinel。

早期11项首跑7PASS/4FAIL，四项在构造replace plan时因测试fixture直接对非规范字段顺序的manifest计算摘要而在parseDistributionPlan失败；修正fixture按parseDistributionManifest生成canonical摘要，随后11项全过。parser同时去除了对JSON键插入顺序的错误依赖，plan规范字段顺序固定。后续扩为16项、再18项均实际通过，没有跳过、放宽期望或伪造成功。

最终局部ESLint与全仓TypeScript --noEmit均实际exit0；此前并行execution.ts与store测试的暂态诊断已在协调者修复后复核消失。原始UTF-8日志和退出码在独占root的transaction-tests.log、test-status.json，可由协调者最终归档；未自动更改其他报告或提交。

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/distribution-transaction-20261116'
node --input-type=module -e 'import {build} from "esbuild";await build({entryPoints:["tests/distribution-transaction.test.ts"],bundle:true,platform:"node",format:"esm",target:"node24",outfile:process.env.OUCL_TEST_ROOT+"/transaction.test.mjs"})'
# 在已获准提供真实链接能力的环境运行
node --test "$env:OUCL_TEST_ROOT/transaction.test.mjs"
node ../../node_modules/eslint/bin/eslint.js src/services/distribution/transaction*.ts tests/distribution-transaction.test.ts
```

## 保留范围

本组证明的是内部有界事务与正式FS操作，不是公共安装确认、真实签名发布源接入或全游戏兼容。生产journal/receipt适配和真实发布序号接纳由协调者验证。当前没有自动恢复扫描、后台回收、任意目录导入或收编旧内容；私有stage/backup保留，不自动GC。普通本地FS检查不能提供对任意外部恶意写入的内核级原子隔离；观察到不一致时停止并保留资料。断电持久化和所有平台/失败矩阵仍须独立证据，不以本组局部故障注入代替。

