# Windows 精确文件句柄操作：有界准入 spike

日期：2026-11-16（Asia/Shanghai）。范围仅 `spikes/distribution-file-guard/` 和本报告；未更改生产事务、main、bootstrap或依赖，也未提交。按协调者“最多一个实现/验证迭代”执行一次原生程序；结果不满足生产准入。

## 结论与实测

**NOT_READY：可验证的同句柄删除通过，但目标父目录guard失败，无覆盖rename尚未取得运行证据。** 不以此关闭现有Node事务中的rename/unlink竞态。

使用现有 `.NET Framework64/v4.0.30319/csc.exe`，C#自有P/Invoke、Windows x64；仅独占 `D:/MC_start/OUCL/tmp/distribution-file-guard-20261116/fixtures`。原生执行经自动审核批准在沙箱外运行，无网络、玩家资料或正式产品访问。保留测试现场，无递归删除。

| 用例 | 程序结果 | 真实解释 |
| --- | --- | --- |
| 源精确handle持有期间竞争写/删/rename，及源/目标父目录rename | FAIL / CONFLICT_NOT_BLOCKED | 只读现场确认source仍在、guarded.txt仍为owned，而空target已经成为target-moved。当前FILE_READ_ATTRIBUTES目录handle没有阻止空目标目录rename。程序未在组合断言之前输出各竞争错误码，不能把源竞争细项单独补记PASS。 |
| 目标在操作前被其他写入者先占；ReplaceIfExists=false | 程序FAIL / Win32 Error2 | 先打开已不存在的target目录时失败，尚未调用原生rename；因此该能力是NOT_EXERCISED，不能说原生无覆盖rename已被反例证伪。 |
| 缺失目标上的精确handle rename与同inode验证 | 程序FAIL / Win32 Error2 | 同上，尚未到rename调用，NOT_EXERCISED。 |
| 同handle FileDispositionInfo，关闭后再创建新文件 | PASS | 同一源handle被hash验证，竞争delete/create被拒，原生标删成功；close后原文件不存在，随后显式创建的新文件内容post-close-new-file保持。此为有界单文件证据。 |

程序计数 **4项，1 PASS /3 FAIL，exit1**。不能将两个未到syscall的用例算作通过或删除。一次实测后只读检查现场，没有修复或重跑。结果整理见 [observed-result.json](../../../spikes/distribution-file-guard/observed-result.json)；该JSON明确是从工具stdout抄存的观测记录，不冒称程序原生写出的完整日志。程序源和复现命令见 [README](../../../spikes/distribution-file-guard/README.md)。

首次编译命令使用相对源码路径，旧csc未正确解析并报CS1504；将同一源码复制到ASCII独占临时路径后编译exit0。没有因此修改代码或增加一轮原生用例运行。

## 设计与已知缺口

源通过CreateFileW请求GENERIC_READ|DELETE，仅FileShare.Read，OPEN_REPARSE_POINT；拒绝reparse/directory/多硬链接。GetFileInformationByHandle记录卷+file index，ReadFile在同handle上做SHA-256，避免Node“stat后再按路径操作”的对象替换窗口。删除用FileDispositionInfo标记同handle对象；rename拟用FileRenameInfo ReplaceIfExists=false，目标为绝对路径且RootDirectory=NULL，立即源/目标父目录handle在操作期间保持。

Win32文档要求删除信息操作的handle具有DELETE访问；FILE_RENAME_INFO的ReplaceIfExists控制已存在目标是否替换。参考 [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)、[FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info)。文档说明不代替本次没有完成的rename验证。

当前目录handle只请求FILE_READ_ATTRIBUTES，虽然不分享DELETE，实测仍未固定空target目录名称；不能将Node guardDirectory或这个弱目录handle等同原生namespace锁。下一轮候选应测试FILE_LIST_DIRECTORY或GENERIC_READ目录handle及其share兼容性，并让每个用例使用独立目录，避免一个预期失效污染其余用例。还应单独验证相对RootDirectory handle的rename是否可用；当前没有相关实测。

完整生产适配还需从可信根逐层持有/验证祖先目录handle、校验reparse与卷/目录身份，明确跨卷拒绝、NTFS/平台支持范围、既有外部writer造成的共享冲突失败策略；也需把预期inode/hash与journal严格绑定，并在真实多进程目标先占/源替换测试后进入准入审查。这里没有声称解决所有祖先race。现有Node事务仍只适合作为未产品接线的内部候选，不能凭本页启用真实分发替换/删除。
