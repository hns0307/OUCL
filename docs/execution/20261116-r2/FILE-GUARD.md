# Windows 精确句柄文件操作 v2：两轮有界准入验证

日期：2026-11-16（Asia/Shanghai）。已读有效TASK_PLAN、DECISIONS与前轮CHECKPOINT。只修改 `spikes/distribution-file-guard/v2/`、本页及本目录native-evidence；保留v1源码/失败日志。没有改生产transaction、main、build、bootstrap、依赖或提交。

## 当前结论

**原11项矩阵NOT_READY；独立junction补证通过，可进入有界Windows平台适配审查。** 第二轮11项中 **10 PASS /0 FAIL /1 NOT_EXERCISED，原生进程exit2**。唯一未行使格为reparse目录/源文件：创建测试符号链接时Windows返回1314（缺少所需特权），没有降低权限策略或修改系统配置。两轮限额已用完，不将该格当PASS，也不继续重试原矩阵。协调者随后明确追加一个独立junction拒绝probe，结果见末节；它不改原11项结果。

除该格外，本机Windows x64已证明GENERIC_READ逐级目录handle能阻止空目标父目录/祖先rename；独立进程无法写、删、rename或替换持有的源；原生rename不覆盖先占目标且正常移动保持同inode/hash；原生同handle删除、exclusive硬链接发布和实际跨卷guard拒绝均取得有限证据。不是全平台、断电或正式产品准入完成。

## 实现与证据

源码：[NativeGuard.cs](../../../spikes/distribution-file-guard/v2/NativeGuard.cs)、[Program.cs](../../../spikes/distribution-file-guard/v2/Program.cs)、[run.mjs](../../../spikes/distribution-file-guard/v2/run.mjs)。

每个case在独立目录创建自己的普通源/目标，避免v1的失效目录污染后续用例。夹具/临时EXE均只在 `D:/MC_start/OUCL/tmp/file-guard-r2-20261116`。原生程序明确限制测试根；跨卷格只读C盘根volume，不向C盘写文件。

runner使用现有 `.NET Framework64/v4.0.30319/csc.exe`，无安装。通过Node spawnSync直接保存原生stdout/stderr字节，原生Console为无BOM UTF-8；保存完成才解析JSON。两轮均在自动审核批准的沙箱外运行，以取得真实Windows链接/文件句柄能力；没有GUI、网络、用户游戏或正式产品访问。

| 轮次 | 原生结果 | 原始证据与来源绑定 |
| --- | --- | --- |
| round1 | 11项：8PASS/3FAIL/0未行使，exit1 | [stdout](native-evidence/round1.stdout.json)、[status](native-evidence/round1-status.json)、[当轮NativeGuard](native-evidence/round1-NativeGuard.cs)、[当轮Program](native-evidence/round1-Program.cs) |
| round2 | 11项：10PASS/0FAIL/1未行使，exit2 | [stdout](native-evidence/round2.stdout.json)、[status](native-evidence/round2-status.json)；status记录最终源码与EXE SHA256及跨语言双方proof |

编译stdout/stderr及原生stderr也分别保存，未覆盖原轮次日志。两轮编译均exit0。

## 第二轮逐项事实

| 用例 | 实测结果 | 边界 |
| --- | --- | --- |
| 空目标父目录、祖先目录rename | 两次均ERROR_SHARING_VIOLATION=32，目录仍在原位 | 从D盘根逐层持有所有祖先；只尝试改名测试case以内的目录，未尝试改名真实用户/仓库祖先 |
| 独立进程源write/delete/rename/replace | 前三种32，MoveFileExW替换为5；源/竞争文件内容保留 | 竞争者是本次自编译EXE子进程，所有路径由测试生成 |
| 目标在源校验后先占 | no-replace rename返回183，原源及foreign-winner目标均原样保持 | 不把检查目标不存在当作安全保证，实际由单次原生操作拒绝覆盖 |
| 正常同handle rename | 原生0；关闭后新名同inode/hash，旧名消失 | 源/目标同卷；默认单链接 |
| 正常same-handle FileDispositionInfo删除 | 原生0；close后旧对象消失；随后显式创建的新对象保持 | 证明有界删除，不是删除任意外部替换路径 |
| guard之前源已换为另一inode | 预期proof不匹配，拒绝删除；foreign原样保持 | 防止先前Node观测的旧proof被新对象冒用 |
| 默认单链接策略 | 真实双链接源被拒，两个名称/内容保留 | 未证明的硬链接不当作普通单文件 |
| CreateHardLinkW发布 | 先占目标183不覆盖；空目标0，stage/目标同inode/hash且nlink2 | 源和全部祖先handle在整个按路径链接调用期间持有；没有假定FILE_LINK_INFO可用于SetFileInformationByHandle |
| maxLinks2上界 | 真实三链接源被拒 | 允许2不是收编未知双链接；生产必须另外证明私有stage与published目标构成已知pair |
| reparse祖先/源 | **NOT_EXERCISED**，CreateSymbolicLinkW=1314 | 未伪造reparse夹具或跳过后记绿；需后续明确有界范围采用真实junction或有许可的符号链接环境补证 |
| 跨卷 | D卷2162252404、C卷4104189936；guard明确CROSS_VOLUME拒绝，mutationAttempted=false | 证明真实不同卷号的预检拒绝；没有写入C盘或执行跨卷rename |

## 首轮失败与唯一修复迭代

round1的逐层GENERIC_READ目录guard、源竞争、delete、硬链接和跨卷格已经通过。两rename格失败：先占返回87；正常rename返回0却产生带堆垃圾后缀的文件名，新预期路径不存在。只读现场确认尾部垃圾，不能当作正常rename成功。

第二轮只做两项有依据的修复：FILE_RENAME_INFO缓冲多分配一个WCHAR并全部清零，保留FileNameLength为不含终止符的实际字节数；CreateSymbolicLinkW的BOOLEAN返回显式MarshalAs(I1)，避免默认4字节BOOL将失败误判为成功。修复后rename两格通过；符号链接创建失败被正确记录为1314未行使，而非Open不存在路径的假夹具错误。

微软文档分别说明 [FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info) 的no-replace、RootDirectory与名称规则，以及 [CreateSymbolicLinkW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw) 的BOOLEAN返回和非特权创建前提。本次使用显式NUL终止避免首轮实测异常，不以文档或猜测替代两轮原始结果。

## Node与native proof直接比较

runner在正常rename完成的同一目标上执行Node `lstat({bigint:true})`和SHA-256，与native GetFileInformationByHandle/同handle hash逐字段比较。双方实际一致：

| 字段 | native | Node |
| --- | --- | --- |
| 卷/dev | 2162252404 | 2162252404 |
| 64位file index/ino | 281474978246863 | 281474978246863 |
| size | 12 | 12 |
| SHA256 | a2192fa93f3c68571deb18c4c09c40cc6a7ef5f561ca310b1d7a1291168c4ffe | 相同 |

[round2-status](native-evidence/round2-status.json) 保存了双方完整对象与equal=true。这只证明当前本机卷/Node版本上的实际映射，不擅自推广其他平台、网络盘或文件系统。

## 后续可复用接口建议（尚未产品接入）

拟由主进程私有端口调用Windows helper，入参使用既有FileProof `{dev,ino,size,sha256}`，另加固定操作enum、已验证相对位置、可信root/gameDir身份及maxLinks(1或2)。helper内部流程必须是：固定根内逐层目录handle → 非reparse/同卷/目录身份核对 → READ|DELETE且只ShareRead的源handle → 同handle精确proof → no-replace rename、同handle disposition或受保护源的CreateHardLinkW → 回执含原/后proof与稳定错误码 → 最后释放源及目录handle。

不得把renderer路径/绝对目录、任意原生flag、任意入口或shell作为接口；不降级到Node路径操作。写操作结果未知时由原事务journal恢复，不能自动换新txId重放。私有stage/published已知双链接需成对验证两名称同inode；目前只验证链接建立与读取nlink2，未补做双链接源上的rename/delete矩阵。现有spike的Open/Capture参数有maxLinks2上界，但不自动产生管理证明。

生产适配前至少还要补符号链接tag的未验范围说明、已知双链接删除/移动、helper超时/中断回执不确定性、固定受控进程装配和平台/本地卷范围。保持默认真实来源/公钥为空。当前可开始审查helper接口与风险，但不因10个PASS开启公共分发执行。


## 追加授权的独立junction拒绝probe（不是第三轮矩阵）

协调者在原两轮停止后明确允许**只增加一个独立junction case**，不修改round2 NativeGuard、不重跑11项、不更改系统特权。Node在同独占测试根使用 `fs.symlink(target,junction,'junction')` 实际创建junction，随后编译极小JunctionProbe与未修改的NativeGuard源。NativeGuard SHA256仍为 `ab94aac345ee923ff8a00e14cc04483793e0d98208f1e9c5a5655fb7fc0f4165`，与round2-status逐字相同。

实际 **1 PASS，exit0**：Node lstat确认isSymbolicLink=true，native File.GetAttributes返回1040（DIRECTORY16|REPARSE_POINT1024），原guard明确抛UNSAFE_REPARSE_TYPE_OR_LINKS拒绝；外部测试target目录仍仅sentinel.txt，前后SHA256完全相同。该target本身也是自建测试目录，没有触及用户数据。

原始证据：[junction.stdout.json](native-evidence/junction.stdout.json)、[junction-status.json](native-evidence/junction-status.json)。stdout同样由runner直接保存进程字节；status包括target前后清单/hash、guard/probe/EXE摘要及编译/运行退出码。源码：[JunctionProbe.cs](../../../spikes/distribution-file-guard/v2/JunctionProbe.cs)、[junction.mjs](../../../spikes/distribution-file-guard/v2/junction.mjs)。没有第二次junction尝试。

这为通用REPARSE_POINT拒绝分支取得了一个真实junction标签的证据；**不表示所有reparse tag或源文件符号链接都已验收**。原符号链接创建1314的NOT_EXERCISED保留。可据此审查“只支持已明确本机Windows本地卷、拒绝任何reparse、拒绝跨卷”的平台原语候选；仍不开放公共分发执行，也不把矩阵改写为11项全PASS。

建议正式接口最小为 `mutate({txId, operation, trustedRootIdentity, gameDirIdentity, sourceRelative, destinationRelative?, expectedFileProof, knownPrivateLinkPair?})`，仅moveAside/no-replace-publish/removeOwned三枚举，使用受控stdin JSON而非shell。原FileProof字段由主进程journal提供，helper按本次已实测native↔Node映射校验；目录身份也必须与权威目标绑定，不能仅相信临时解析到的新目录。允许nlink2须先证明两名称属于同一已登记私有pair；未证明pair或>2一律拒绝。网络盘/其他FS/UNC、未知tag与不支持平台都fail-closed。该建议是具体后续适配输入，不是已经完成的生产代码。
