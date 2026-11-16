# NT 相对句柄原型：两轮结果与准入阻塞

日期：2026-11-16（Asia/Shanghai）。范围为 `spikes/distribution-file-guard/v3/`、本页及relative-evidence。v1/v2和生产transaction/main/build均未修改；没有新增第三方库、系统权限修改或Git提交。

## 结论

**NOT_READY / rename与link可用性仍阻塞。** 两轮各7项，均 **4 PASS /3 FAIL /0 NOT_EXERCISED，原生exit1**。强目录句柄与按官方建议分离的metadata RootDirectory方案，都在正常rename/link返回 `STATUS_SHARING_VIOLATION 0xc0000043`（Win32 32）；未通过的行为不能接生产。

原型实际完成了关键攻击验证：只请求WRITE_ATTRIBUTES的竞争handle，在empty target目录已被持有后，**FSCTL_SET_REPARSE_POINT成功**将它原位变为junction，held handle可见attrs1040。正常目录验证拒绝该变更；特意绕过正常验证的诊断relative rename使用原目标HANDLE及leaf，内核返回 `0xc0000280`（Win32 1921），外部target没有escaped.txt且sentinel原样保持。不能再将ShareRead解释为足以阻止reparse元数据变更。

两轮限额已用完；保留失败，不继续猜测share flags。该结果支持“逐级相对handle和不跟随reparse的fail-closed路径”进一步审查，不支持“可用平台原语已完成”或公共分发执行。

## 先核对的Microsoft主文档

| 文档 | 对本原型的具体影响 |
| --- | --- |
| [NtCreateFile（用户态）](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile) | RootDirectory非NULL时ObjectName相对该目录；同步选项须有SYNCHRONIZE。每次只给一个经过校验的component，避免重新走完整父路径。 |
| [OBJECT_ATTRIBUTES](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes) | OBJ_DONT_REPARSE是名称解析拒绝reparse标志；同时用FILE_OPEN_REPARSE_POINT并对返回handle查属性。不能只依赖标志文字假定所有组合安全。 |
| [FILE_RENAME_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information) | RootDirectory可直接提供目标目录handle；相对名仅simple filename，ReplaceIfExists=false。文档明确内核可能relative reopen目标目录取得写访问，并建议TRAVERSE/READ_ATTRIBUTES的原RootDirectory避免sharing冲突。 |
| [FILE_LINK_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_link_information) | 使用现有源handle创建硬链接，目标为RootDirectory及leaf，不假定Win32 SetFileInformationByHandle支持该类。 |
| [FILE_INFORMATION_CLASS](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/ne-wdm-_file_information_class) 与 [NtSetInformationFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntsetinformationfile) | 使用传统Rename10、Link11、Disposition13；rename/disposition的源有DELETE访问。枚举表与结构定义用于确认传统class值，不照搬某页面表格中混淆的Link编号。 |
| [FSCTL_SET_REPARSE_POINT](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_set_reparse_point) | 通过DeviceIoControl实际设置junction数据；文档的一般权限说明不代替本次具体tag/访问mask的实测。本机mount-point数据在WRITE_ATTRIBUTES=256的handle上实际成功，无须修改token。 |

这组文档描述单个接口，不构成本机以外Windows版本/文件系统的安全证明。用户态NtCreateFile页对ObjectAttributes flags的文字比通用OBJECT_ATTRIBUTES页更窄；本原型明确记录所用组合及实际返回，未将其推广为所有版本的固定保证。

## 实现边界

[RelativeNative.cs](../../../spikes/distribution-file-guard/v3/RelativeNative.cs)使用自有C# P/Invoke声明，现有.NET Framework x64编译器，无下载或依赖安装。初始盘根handle仅由CreateFileW引导；后续所有child目录与源文件均通过 `NtCreateFile(ObjectAttributes.RootDirectory=parentHandle,ObjectName=singleComponent)` 打开。叶名拒绝分隔符、冒号、点路径及NUL；配置OBJ_CASE_INSENSITIVE、OBJ_DONT_REPARSE、FILE_OPEN_REPARSE_POINT，并对打开后的对象验证普通类型/reparse/卷/目录inode。

源以READ|DELETE|SYNCHRONIZE、ShareRead打开并用同handle读完整有界SHA256/volume/file-index/size。mutation buffer的目标RootDirectory为已持有handle，FileName仅leaf，ReplaceIfExists=false。普通rename/link没有绝对目标路径回退；FileDispositionInformation对同源handle标删。

本机卷通过GetDriveTypeW=DRIVE_FIXED(3)、GetVolumeInformationW文件系统名NTFS及volume serial检查，拒绝UNC、非本地固定类型、未知FS和跨卷graph。实际stdout记录D盘为fixed NTFS、serial2162252404。没有把drive-letter本身当local证明；也没有寻找网络/其他FS环境，故“拒绝条件代码存在”不等于各未知FS真实测试通过。

## 两轮配置与原始结果

| 轮次 | 配置 | 结果与证据 |
| --- | --- | --- |
| round1 / strong | 所有目录READ|FILE_ADD_FILE|SYNCHRONIZE，ShareRead；逐级相对打开，目录graph复用同handle | 7项4PASS/3FAIL，exit1。[stdout](relative-evidence/round1.stdout.json)、[status](relative-evidence/round1-status.json)、[源码快照](relative-evidence/round1-RelativeNative.cs) |
| round2 / metadata | 独立GENERIC_READ/ShareRead|ShareWrite（无ShareDelete）的namespace保护handle；另TRAVERSE|READ_ATTRIBUTES|SYNCHRONIZE、ShareRead的metadata anchor供NtSetInformationFile作RootDirectory。两个handle同volume/inode；子对象仍逐级relative。 | 7项4PASS/3FAIL，exit1。[stdout](relative-evidence/round2.stdout.json)、[status](relative-evidence/round2-status.json)、[源码快照](relative-evidence/round2-RelativeNative.cs) |

round2只基于主文档和round1真实sharing错误做这一轮有依据的分离方案；没有改断言、放宽目标先占期望或继续试其他flags。round2中保护handle允许write sharing，是为了配合文档的内核目标目录重开；metadata anchor仍ShareRead，未假称这种组合已避免冲突，实际仍32。错误具体由哪个内核open/handle对产生尚未跟踪证明，不进一步猜测为已定位根因。

runner直接保存原生UTF-8 stdout/stderr字节后才解析；两轮编译exit0、源代码/EXE SHA256、固定命令、case目录及已有junction夹具证明均已归档。运行经自动审核批准在独占 `D:/MC_start/OUCL/tmp/file-guard-v3-20261116`；所有EXE和测试数据留tmp，证据目录无EXE。既有junction由Node在同测试根实际创建，前后external sentinel保持。

## 逐项结果（两轮一致）

| 用例 | 结果 | 实际证据与限制 |
| --- | --- | --- |
| 正常relative rename | FAIL | NtSetInformationFile(10)返回C0000043/32，未证明可用；没有copy/absolute rename回退。 |
| relative no-replace目标先占 | FAIL | 仍32，未到预期NAME_COLLISION/183；不能因为没有覆盖就当该用例通过。 |
| relative FileLinkInformation先占及正常link | FAIL | 先占即32，未继续正常link；正常link在此格未行使，不补记PASS。 |
| relative源同handle disposition | PASS | NtSetInformationFile(13)返回0；close后原文件消失，随后明确创建新文件。 |
| 源外进程写/删/rename/replace及空parent改名 | PASS | 源竞争四项均32，空parent rename32。竞争者为自有EXE子进程，路径均自建。 |
| 已有junction relative component open | PASS | 实际junction被打开后属性检查REPARSE_OR_TYPE_REJECTED，external sentinel不变。此处不是证明OBJ_DONT_REPARSE单独挡住了所有reparse；显式handle检查参与拒绝。 |
| 已持有empty parent后的原位FSCTL攻击 | PASS（安全拒绝） | 下节完整描述；实际set成功，不是因权限失败推导安全。 |

## FSCTL攻击：实际发生且未逃逸

两轮均记录 `attack-256={opened:true,desired:256,error:0,set:true}`。竞争handle通过原测试路径打开已有empty parent，仅申请WRITE_ATTRIBUTES；随后DeviceIoControl FSCTL_SET_REPARSE_POINT写入真实IO_REPARSE_TAG_MOUNT_POINT数据。原先已持有的目标handle此时Attributes=1040，证明不是更名后另一个目录，也不是虚构夹具。

1. 正常graph.Verify观察到REPARSE_POINT位，立即拒绝（normalGuardRefused=true），不会进入生产式mutation流程。
2. 为验证“检查之后才被攻击”的窗口，**仅诊断原型**故意跳过这次目录检查，直接给NtSetInformationFile原来的目标RootDirectory HANDLE及leaf `escaped.txt`，源仍为同一已验证handle。
3. 内核返回C0000280/1921，未完成rename；自建external中escaped.txt不存在，sentinel内容仍preserve。两轮均externalUnchanged=true。

所以本机该真实junction变化下，正常检测和native相对操作分别给出了拒绝证据；并未证明所有tag、所有中间祖先位置或其他NTFS版本的等价行为。也未把诊断绕过guard写进生产。

## 后续最小动作

先分析两个既有原型的真实sharing错误，明确哪些目标open与哪些hold handle产生冲突，必要时在另行明确的有界范围获取系统级调用证据；不要无限排列share flags取得绿色。正常rename/link未通过前，不移植到生产helper或放开公共执行。

对已经取得的fail-closed原语，可审查相对父HANDLE/单组件名、固定NTFS支持范围、root/gameDir权威identity及源FileProof绑定的接口方案。根引导仍需可信volume/root身份，不接受renderer提供任意根；双链接源、helper中断/超时、reparse检查间窗及恢复journal接口都需分别验证。v2先前Node/native字段映射证据保持，v3正常rename失败，runner没有生成新的跨语言成功比对，不冒称重复通过。
