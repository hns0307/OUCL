# 方案A首片：私有确认接纳与outbox

2026-11-17。依据用户明确批准PUBLIC-EXECUTION-PROPOSAL方案A及TASK_PLAN/DECISIONS最新记录，本片只实现distribution库确认接纳基础，不执行包、不自动投影任务，不新增公共入口或游戏目录收据来源。真实source/key保持为空。

## API与不可变绑定

`DistributionStore.admissions: AdmissionRepository`，类型定义在`src/services/distribution/admission-record.ts`：

- `admit(intent): Promise<AdmissionRecord>`。
- `readByRequest(confirmRequestId)`、`readByProposal(proposalId)`：返回原记录或undefined。
- `listPending(limit=100)`：仅accepted，limit为1..1024，按proposalId稳定排序。
- `markProjected(proposalId,taskId)`：仅原taskId可以将accepted/revision1转成projected/revision2；重复返回原revision2，不再次修改。

Intent为严格字段`{confirmRequestId,proposalId,plan,releaseSha256,gameIdentity,previewFingerprint}`；proposalId必须等于plan.txId，plan由现有严格解析器规范化，目录身份为显式dev/ino，previewFingerprint为main真实prepare快照的SHA256。此库验证其格式与持久绑定，不自行扫描或证明调用者确实完成prepare。UUID要求规范小写，hash为64位小写hex；额外字段/伪造输入digest拒绝。

Record包含`formatVersion:1,proposalId,taskId,inputDigest,plan,releaseSha256,gameIdentity,previewFingerprint,phase,revision`。inputDigest在库内对固定字段顺序的`{proposalId,plan,releaseSha256,gameIdentity,previewFingerprint}`计算SHA256，不接受外部digest；confirmRequestId不参与，因此同proposal相同意图可建立多个确认alias。taskId只在首次接纳时由主进程randomUUID生成一次。

同request同意图、同proposal另request同意图返回同task；任一已见身份绑定不同意图均REVISION_CONFLICT。已有request精确重试直接取原回执，即使高水位后来前进，也不重新授予执行或造outbox。新记录/新alias在同SQLite事务内核对当前release_states高水位、accepted_releases规范hash、source/package/version/sequence/manifest完整绑定。后继executor仍须重新检验有效期、信任、领域条件及事务ownership/lease/receipt。

## 持久schema2

原四表release_states/journals/receipts/accepted_releases及其内容不变。已识别application_id的user_version1库经过BEGIN IMMEDIATE原子增加三表并更新user_version2；新库同样到达schema2。未知版本/表/触发器/视图/列/唯一键/外键拒绝，不猜测修复。

| 表 | 字段与约束 |
| --- | --- |
| admissions | proposal_id TEXT NOT NULL PRIMARY KEY；task_id TEXT NOT NULL UNIQUE；input_digest TEXT NOT NULL；data TEXT NOT NULL（不可变Record主体，含内部格式版本） |
| admission_aliases | request_id TEXT NOT NULL PRIMARY KEY；proposal_id TEXT NOT NULL REFERENCES admissions(proposal_id) |
| admission_outbox | proposal_id TEXT NOT NULL PRIMARY KEY REFERENCES admissions(proposal_id)；task_id TEXT NOT NULL UNIQUE；revision INTEGER NOT NULL；phase TEXT NOT NULL |

record+alias+outbox初建同事务提交。outbox唯一状态迁移为accepted/1→projected/2，身份/主体不变。markProjected是后继投影者的明确确认，不证明任务库已写入；本片未接该调用者或自动执行。重开可listPending进行后续显式对账，不凭文件存在推测完成。

最多1024 admissions和4096 aliases，不驱逐旧身份；新身份达到边界以受控REVISION_CONFLICT拒绝（现有StorageCode没有容量码，后继公共层需映射）。单记录沿既有MAX_RECORD_BYTES=4MiB。启动及每次admission读写检查完整有界记录、alias/outbox对应和schema；损坏、未知phase/revision、孤儿或native SQL异常统一NEEDS_RECOVERY。重复回执仍可在容量满时读取。

## 实测与复现

最终 **13PASS / 0FAIL / 0SKIP，test exit0**：新增8项admission测试及既有5项distribution-store回归。使用真实Windows SQLite与OwnerGuard，无网络、无包执行、无游戏/窗口操作；容量夹具为独占数据库内直接生成的有效合成记录，不冒称1024个真实确认流程。

- 重复confirm/alias单task、不同snapshot/inode/revision/request冲突。
- 新接纳缺少或过时authority拒绝；旧回执在更高release后仍返回原task。
- commit后丢回执再close/reopen，accepted/outbox保留；markProjected原task幂等、错task拒绝。
- v1迁移前后release/archive/journal/receipt四表字节及修订保留，version变2。
- 未知version/schema、错digest/phase、缺outbox及运行中损坏failclosed，现场记录保留。
- 4096 aliases/1024 admissions容量边界拒新身份且旧回执不驱逐；第二OwnerGuard拒绝。

原始FD日志：[首轮12项](admission-evidence/test-initial.log)、[最终13项](admission-evidence/test-final.log)、[首轮状态](admission-evidence/initial-status.json)、[最终状态](admission-evidence/final-status.json)。首轮typecheck及局部lint均exit0；最终局部lint exit0，typecheck exit2唯一诊断为并发任务的TaskCenter.tsx缺distribution-install映射，详[typecheck-final.log](admission-evidence/typecheck-final.log)，本片未修改该文件，交主协调整合全检。没有以删除诊断或降低断言造绿。

固定已安装工具，未使用pnpm/安装依赖。独占根`D:/MC_start/OUCL/tmp/admission-20261117-a`；可复现runner及实际命令见[run-final.mjs](admission-evidence/run-final.mjs)，esbuild编译两测试为独占mjs，node --test仅运行这两文件。runner把子进程stdout/stderr直接写FD；本轮默认沙箱执行，未请求未沙箱运行。源码摘要见[source-sha256.json](admission-evidence/source-sha256.json)。初轮与最终日志分别保留，不覆盖历史结果。

范围：只修改store.ts，新增admission-record.ts、distribution-admission.test.ts、本报告和admission-evidence；源码已冻结交主协调完整检查/精确收存，无Git提交、public接线或正式EXE覆盖。
