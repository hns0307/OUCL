# Relative Windows helper最终只读复核

日期：2026-11-16（Asia/Shanghai）。对象为当前 `native/distribution-files/NativeGuard.cs` 与 `Program.cs`；独立只读review，未改产品或追加实验。本页结论不替代主协调的完整回归、打包或真实来源接入验收。

**本次指定边界内未发现需要阻断整合的具体代码问题。** 可将当前helper交主协调继续验证；不是整个分发功能、所有Windows版本/文件系统或全部reparse tag的验收通过。

## 源码与验证层级

实际审阅源码SHA256：

| 文件 | SHA256 |
| --- | --- |
| NativeGuard.cs | 547143af5a6d24469208c5808fd4b0bdcbf828ccf401911557e6e4de8379657f |
| Program.cs | aba0b8632d4de64d548e358c7f8eabc103d241c2e668ffcf1f5d918aa651705d |

两值与实现代理另存的 [relative-v4-source-and-binary.json](native-helper-evidence/relative-v4-source-and-binary.json) 一致。旧source-and-binary-manifest记录的是历史候选，不能拿它绑定这份源码；该材料暂态差异已反馈实现者，由其保留旧证据并补后继说明。

独立核读原始 [relative-v4-tests.log](native-helper-evidence/relative-v4-tests.log) 与 [status](native-helper-evidence/relative-v4-test-status.json)：14项14PASS/0FAIL/0SKIP，exit0，2834.9198ms。这是实现代理运行的生产源码专注测试，不冒称本review又运行了一遍。review另外核读了对应测试中的独立持有进程与真实FSCTL harness：它们编译同份production源码，不是只测spike替身。主协调完整check与包验证另记。

前置原语证据为v4单轮7PASS及保留的v3两轮4PASS/3FAIL。v4精确对照只改变metadata anchor的ShareWrite，消除了实测sharing错误；旧失败不删除，也不把当时尚为share1的metadata测试说成已排除了方案。详见 [v4 README](../../../spikes/distribution-file-guard/v4/README.md)。

## 已核对的产品路径

1. **目录锚定。** 盘根仅一次Win32 bootstrap；GetDriveTypeW要求DRIVE_FIXED，GetVolumeInformationW要求NTFS并核对实际root handle serial。后续每个目录组件用NtCreateFile的父RootDirectory HANDLE和单组件名打开，同时OBJ_DONT_REPARSE、FILE_OPEN_REPARSE_POINT及显式属性/type/inode检查。保护handle和metadata anchor必须同volume/inode，均在graph存活期保持；metadata anchor明确share3，不再误用share1。不存在失败后转回绝对路径rename/link的分支。
2. **权威root与lease。** Program核对请求rootIdentity的dev/ino与持有gameDir对象；source/destination均被限制在root受控文件区域/本txId私有stage。lease通过 `Open(rootChain,"oucl.session.lock")` 相对父handle打开，普通操作只读持有，精确36字节UTF-8 token/nlink1校验；release复用该同一handle作为DELETE源，避免另开lease产生对象替换窗口。
3. **源proof。** 源通过 `Open(sourceChain,leaf)` 相对打开，READ|DELETE、ShareRead；不信任请求仅声称的路径存在。实际同handle的volume/file-index/size/SHA256须与原FileProof一致；普通源nlink限定1..2，link仅允许1→2。原型与生产专注测试均有Node/native字段实际比对。
4. **目标mutation。** NtSetInformationFile传统Rename10/Link11使用持有目标parent anchor及固定leaf，ReplaceIfExists=false；buffer有边界/NUL分配，不允许leaf重新解释为路径。先占目标必须返回碰撞而非覆盖。Disposition13对持有源对象执行，不按旧路径再unlink。mutation前后检查graph/proof，未知失败不使用覆盖、复制或Node路径操作回退。
5. **live reparse。** 生产测试实际WRITE_ATTRIBUTES256竞争handle的FSCTL成功，已持有目标可见junction；正常guard拒绝。故意跳过guard的诊断Name10及Name11均负NTSTATUS，external目标没有新文件且sentinel不变，sourceproof保持。未将“GENERIC_WRITE被拒”当作“所有metadata写都被拒”的证据。既有junction的拒绝也包括显式handle属性检查，不归因于单独某个NT flag。
6. **stdin/错误边界。** Main只接受无CLI参数、Windows-x64，stdin严格UTF-8、1..16384字节。自有小JSON解析器拒重复键、未知字段、数组/null/布尔值、指数/小数/负数字面量、超深对象及尾随数据；顶层/rootIdentity/expected均exact。操作enum、版本、UUID、hash、无符号identity、size和路径白名单进一步校验。所有异常最终仅输出固定版本success或受控code，不输出原生message、路径、token、堆栈或handle。原生reparse错误1921/4390..4399映射UNSAFE_PATH，其他未知错误不当成功。

相关接口边界与 [Microsoft NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)、[FILE_RENAME_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)、[FILE_LINK_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_link_information) 的相对RootDirectory形式一致；实际结果仍以本机测试为证据，不以文档代替运行。

## 结论的实际限制

helper只是私有文件primitive，不认证publisher签名、release sequence、包管理权、JAR语义、许可或事务提交；这些仍由主进程权威ledger/规划/journal负责。nlink2许可也不产生管理证明。真实站点、分发来源和公钥仍空，review不授予任何真实远程安装能力。

本轮真实reparse攻击使用junction/mount-point tag，不宣称所有tag、每个祖先位置及所有Windows build都已穷尽；fixed NTFS检查也不代表在网络盘/其他FS上做过真实拒绝实验。源/parent互斥、no-overwrite、helper同handle行为和原生失败的保守映射已在规定本机边界取得有限证据。

本review没有新增测试、修改断言、运行产品窗口、启动游戏、清理现场、git暂存或提交。整合接线、完整检查、helper载荷哈希和发布状态由主协调最后统一核验。
