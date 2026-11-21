# Admission完整一致读取

2026-11-17，基线a8bc927d。用户已批准公共方案A；本片仅补双向reconcile所需内部读取与严格解析，不执行包、不投影任务、不新增public入口/schema/依赖。先读TASK_PLAN、DECISIONS、AGENTS及20261117-a/CHECKPOINT，沿当前G2批准范围实施。

## 已冻结API

- `store.admissions.listAll(): Promise<AdmissionRecord[]>`：无分页/limit参数，按proposalId排序返回accepted和projected全部记录。总量上限1024；超限、未知schema、损坏、孤儿alias/outbox均NEEDS_RECOVERY，不截断为看似完整列表。
- `parseAdmissionRecord(value:unknown): AdmissionRecord`：导出给reconciler验证ports/read-back。outer exact字段复用原parseData规范重建plan与内部inputDigest；只允许accepted/revision1或projected/revision2，输出detached。没有新增持久字段或复制另一套digest逻辑。
- `MAX_ADMISSION_TOTAL_BYTES = 16 * 1024 * 1024`：导出的完整admission主体UTF8累计预算；schema2不变。

listAll先调用现有store.verify核对OwnerGuard marker及数据库身份，随后以SQLite `BEGIN`读事务在**同一快照**中执行完整schema/有界记录审计和无LIMIT最终枚举；成功COMMIT，异常ROLLBACK并脱敏。借用既有transaction helper的只读选项，既有admit/markProjected仍BEGIN IMMEDIATE。schema2及原七表保持不变，store.ts本轮没有改动。

独立review补出“1024条×单条4MiB”可能累计约4GiB的问题后，主协调授权增加总预算。validateStored先查1024/4096数量上界，再用SQL `SUM(length(CAST(data AS BLOB)))`核对累计16MiB，**在解析任何record之前**拒绝超额。新admit同事务以旧SUM+即将写入的JSON实际UTF8字节核算，超额REVISION_CONFLICT，避免库自身写入后无法完整读取。已有超额库NEEDS_RECOVERY并保留全部数据，不自动删除、压缩或迁移；旧确认/alias协议不变。下游ports输出还包含phase/revision，reconciler负责其clone前的独立有界输入验证。

## 实测证据

完整局部轮 **20PASS / 0FAIL / 0SKIP，exit0**，其中新增query7项、已有admission8项及store5项。TypeScript和本片局部ESLint均exit0；[完整局部状态](final-status.json)、[原始测试FD日志](test-final.log)、[type日志](typecheck-final.log)、[lint日志](lint-final.log)。随后主协调授权修正下述初始化存在性查询，修后原query **7PASS / 0FAIL / 0SKIP**及type/lint再次exit0，见[最终冻结状态](bounded-status.json)、[最终query日志](test-bounded.log)、[最终type](typecheck-bounded.log)、[最终lint](lint-bounded.log)。未把修正前20项冒充最终摘要下重跑的数量。默认沙箱实际Windows SQLite/OwnerGuard，无网络、窗口、native重新试验或用户资料访问。

**最终总预算修正后为query8PASS / 0FAIL / 0SKIP，typecheck/lint均exit0**，见[最终状态](budget-status.json)、[8项原始FD日志](test-budget.log)、[type](typecheck-budget.log)、[lint](lint-budget.log)。上面20/7项及其摘要均按历史轮次保留。新增第8格在真实SQLite中用`zeroblob(16MiB+1)`制造超额：listAll、admit及重开均拒绝，数据长度仍完整保留；另以四个合法JSON记录的空白padding逼近预算，新admit被拒后admissions/aliases/outbox各仍四行。该测试验证数据库字节预算和原子拒写，不是巨量JS对象/DoS压力矩阵。

1. accepted/projected完整列出，返回对象修改不污染数据库；重开仍可读回，第二OwnerGuard被STORE_BUSY拒绝。
2. **真实两连接WAL一致性**：在审计结束、最终枚举前，测试仅在DatabaseSync.prepare边界同步外连接提交projected更新；生产没有测试钩子。本次listAll仍返回两个accepted旧快照，外连接直接读到已projected，下次listAll再看到新状态。并非只断言SQL字符串或模拟列表。
3. 直接在独占数据库构造有效合成行，1024条完整返回；第1025条使listAll及后续markProjected拒绝，数据库仍保留1025条且旧phase未改。此夹具证明边界，不冒称1024次产品确认。
4. 错digest、缺outbox、孤儿alias、未知表和非法revision均拒绝整个列表，后续写入也拒绝，现场两条admission保留。
5. 原confirm ID的回执在高水位前进后仍返回原task；同proposal新增alias沿原批准协议需当前authority，过时则REVISION_CONFLICT；无新增task/outbox。
6. owner.lock改为foreign marker后查询拒绝，恢复测试自己的原marker再正常close；并发close/查询只返回受控错误，close后STORAGE_IO。
7. strict parser拒绝额外字段、错phase/revision、改snapshot或plan而沿用digest；accepted和projected合法记录均detached解析。

首轮[19PASS/1FAIL原始日志](test-initial.log)及[状态](initial-status.json)原样保留。失败为**腐坏alias夹具本身**被Node默认外键保护拒绝（ERR_SQLITE_ERROR/787），还未进入产品断言；仅该外部夹具连接显式`PRAGMA foreign_keys=OFF`以真实制造孤儿，生产foreign_keys仍ON，原拒绝断言未降低。修后执行上述20项全通过，没有覆盖失败日志。

## 独立只读审查与限制

已确认旧admit语义：existing alias+相同inputDigest只返回原回执，不再次授予执行；新alias复核当前archive/highwater；异输入先冲突，未因listAll调整该协议。历史user_version1→2迁移保持原事务和七表审计，现有迁移保留/损坏测试仍通过。

发现并向主协调报告一处**现存初始化有界缺项**：initializeAdmissionSchema末尾`PRAGMA foreign_key_check`原使用.all()，在后续validateStored的1024/4096行数限制前展开全部违例。主协调明确授权后仅改为.get()：任意一条违例即NEEDS_RECOVERY，不需取回余下行，不改变schema或外键拒绝语义。原query七项和静态检查重新通过；没有构造巨量损坏库做内存压力实验，不将此静态存在性修正冒充已实测DoS矩阵。修前日志与[source摘要](source-before-bounded-sha256.json)均保留。

OwnerGuard的固定marker不是独立锁凭据：需与持有的guard SQLite事务及数据库inode共同成立；本片没有发现仅复制marker即可通过第二owner的可复现漏洞，真实第二owner拒绝保持。没有把应用ID/marker当作签名或许可证据。外部恶意同用户写入的防护沿现有private metadata信任边界，本片没有承诺加密防篡改。

## 复现与收存

固定已安装父目录node/esbuild/tsc/eslint，无pnpm或安装；[完整局部runner](run-final.mjs)和[最终query runner](run-bounded.mjs)将stdout/stderr直接写FD。独占根`D:/MC_start/OUCL/tmp/admission-query-20261117-b`；bundled独占mjs分别运行三文件与query单文件，不改共享dist。runner包含本机证据根，迁移到别处时显式改root，不把该路径写入产品源码。

最终预算轮使用[run-budget.mjs](run-budget.mjs)，执行原query文件新增一格后的八项与静态检查；修前摘要另存[source-before-total-budget-sha256.json](source-before-total-budget-sha256.json)，最终源码摘要仍为source-sha256.json。

源码SHA见[source-sha256.json](source-sha256.json)。本片只修改admission-record.ts，新增distribution-admission-query.test.ts与本目录证据；store.ts、旧测试、公共契约、任务库、依赖及持久schema均未改。生产源码已冻结交主协调完整检查/精确收存，无Git提交或正式EXE覆盖。
