# Mod新增文件事务与恢复

2026-10-28，原批准Mod安装/恢复方案的私有提交服务。`ModTransactionService`尚未接公共确认任务或安装按钮。

## 提交与文件所有权

输入只来自已验证的`PreparedModInstall`，服务重新绑定持久计划、root/instance/revision/fingerprint和全部文件摘要/来源身份。先保存`prepared`日志，再独占创建与GameProcessService相同的`oucl.session.lock`，核对无活动/未知会话。占用标记覆盖暂存、逐文件发布、JSON提交与索引同步，阻止启动器在中间状态启动游戏。

每个源对象重新通过有界JAR worker核对SHA1/SHA256/SHA512/大小，再复制到该游戏目录的`.oucl-mod-staging/<taskUUID>`，写回磁盘并复验。所有暂存文件的dev/ino身份先保存到日志，随后才进入`applying`。文件通过同卷独占hard link从**私有暂存副本**发布到mods，目标已存在就失败；可写Mod不会直接链接到共享对象仓库。不支持该文件系统操作时失败并回退，本机D盘已实测。

发布后重新扫描实际库存，对比预期全部文件指纹与本地/平台要求，再检查环境、修订、计划取消和会话。ready实例JSON一次CAS写入`summary.revision+1`和独特`modCommitId=taskUUID`构成提交点，随后同步实例索引并把日志标为committed。`modCommitId`是formatVersion=2加载器ready实例的可选字段；旧记录保持可读，不原地改写旧用户文件。未知字段/格式仍停写。

## 固定日志

存储worker只新增`mod-txn:get/set`，记录名严格为`mod-txn-<taskUUID>`，没有通用路径/JSON/SQL入口。现有schemaVersion=1 envelope的data格式版本1包含task/root/plan/instance关联、原修订、库存指纹、前/后实例JSON摘要、占用token、phase以及最多256个文件的安全文件名、项目/固定版本、三摘要、大小、sourceKey、dev/ino。最大512KiB。摘要是本地内容身份，sourceKey链接既有可信来源证明，不伪称上游签名。

阶段为prepared、applying、committed、rolledBack、needsRecovery。固定身份和文件摘要不可变；文件身份只在prepared阶段从null补齐，终态不重写。未知版本/字段/阶段、额外操作和非法路径拒绝，原记录保留。单个活动提交/恢复，正常关闭应由未来任务服务等待在途事务结束后再关存储。

## 回退与恢复

提交点前失败/取消时，只有目标文件dev/ino与日志一致且真实三摘要仍匹配的本次新增文件才能移动回私有恢复目录。回退材料全部保留，不递归清空目录。外部替换文件保持原位；本次文件若已被外部修改，保留修改并进入needsRecovery，继续保留占用标记。若移动时遇到身份竞争，只尝试独占恢复原名，绝不覆盖另一个新目标；不确定的材料保留等待恢复。

JSON写入/确认消息丢失后，必须同时核对实例唯一modCommitId和完整预期JSON摘要才能判定已提交；同一个revision不足以作为证明。已经越过提交点的取消不能再承诺回退。实例索引失败时保留日志/标记，显式恢复可完成索引和committed记录；提交点前中断且原JSON仍精确匹配时才回退。恢复只认可自己的原始token，不按PID、时间或文件存在猜测所有权，也不清除外来标记。终态记录可补释放仍属于自己的标记。

所有权以服务记录及当前文件观察为依据；外部进程不遵循启动器标记时，发现变化即保留证据并停止。断电/任意进程kill全矩阵尚未验收，不能把故障注入和正常worker重开描述成该矩阵通过。

## 后续接入要求

仍需持久公共确认任务与计划占用/取消互锁，确保事务开始后不能由独立plan取消接口虚假承诺撤销；需实测Java事实、任务进度/取消/重连及完整产品界面/EXE验收。当前仅内部API，任何renderer请求都不能直接提供PreparedModInstall、文件路径或操作日志。managed文件列表可供未来分发差异计划使用，删除/替换必须核对该记录及预期旧摘要；不因清单缺项删除未知Mod/配置/存档。

验证见[MOD-TRANSACTION-20261028](../validation/MOD-TRANSACTION-20261028/REPORT.md)。
