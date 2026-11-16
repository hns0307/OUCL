# Windows 分发文件窄接口 helper：实现与分层验证

日期：2026-11-16（Asia/Shanghai）。本片实现自有C# helper、独占构建脚本和Node跨语言测试，不改旧spike、Nodewrapper、交易记录或主进程装配。**最新v4后继：固定本机NTFS的relative HANDLE实现14项通过；公共分发执行未开放。** 下列首轮内容保留其历史失败，最新接口实现/源码摘要与限制见文末“v4后继”。

## 首轮历史结论和源码状态

最初目录 `ShareRead|ShareWrite` 的功能候选完成13项真实测试，13PASS；随后按协调者要求验证去掉目录ShareWrite能否同时阻止外部目录写入和保留自身操作。该严格版本真实重编后 **13项8PASS/5FAIL，exit1**。独立进程的GENERIC_WRITE探针确实取得未guard成功、held目标目录错误32，但helper自己的正常link/rename也被阻断。不能用原13PASS覆盖这次失败，也不能因为拒绝写句柄就宣称全部reparse竞争已闭合。

恢复后先收取了此前已运行命令的真实输出，**没有重复跑这轮测试**。按协调者后续明确指令，已保存严格版本源码快照和SHA，只把目录shareflag恢复为原 `ShareRead|ShareWrite`，没有更改其他校验、原断言、Node端或旧spike。恢复后未再次运行测试，不声称当前源码加新增准入断言已经全绿。

首轮回退的 `native/distribution-files/NativeGuard.cs` SHA-256为 `73b802fd3c92f030f49424dd5ccd3a3415cff31acb54c611eac0671c02b0b20b`；被拒绝的ShareRead-only源码为 `be938779d475ced978bae8abb3dcf1545da3afff048778fb5de6fb449b96f380`。Program、构建脚本、测试、两份实际EXE及metadata摘要见历史 [source-and-binary-manifest.json](native-helper-evidence/source-and-binary-manifest.json)。源码快照在 [share-read-only-source](native-helper-evidence/share-read-only-source/)；旧功能EXE和失败严格EXE留在不同独占tmp目录，均未覆盖正式EXE。

## 实现文件与协议

- `native/distribution-files/NativeGuard.cs`：由自有v2 guard提炼，固定Win32句柄、同handle证明/哈希、no-replace rename、同handle delete和独占hardlink；未复制第三方实现。
- `native/distribution-files/Program.cs`：一次stdin请求、一次受控JSON响应；不接受命令行操作、任意shell、插件或递归删除。
- `scripts/build-distribution-files.mjs`：Windows x64使用既有.NET Framework64 csc，无新依赖；`OUCL_BUILD_ROOT`默认dist，输出 `native/distribution-files.exe` 和同目录 `distribution-files.json`。
- `tests/distribution-native-helper.test.ts`：独占目录、真实Node dev/ino/sha256与C#对照、真实本机文件和独立进程guard测试。

请求格式：

```json
{
  "version": 1,
  "operation": "rename|link|delete|release",
  "root": "<absolute ordinary gameDir>",
  "txId": "<lowercase UUID v1..v8>",
  "rootIdentity": { "dev": "<unsigned decimal>", "ino": "<positive decimal>" },
  "leaseToken": "<lowercase UUID v1..v8>",
  "source": "<absolute allowed path>",
  "destination": "<rename/link only; absolute allowed path>",
  "expected": { "dev": "<unsigned decimal>", "ino": "<positive decimal>", "sha256": "<64 lowercase hex>", "size": 0 }
}
```

stdin UTF-8至多16384字节；根/expected对象及顶层字段exact，拒绝重复键、未知字段、非法UTF-8、数组/null/布尔值、非整数/指数数字及未来版本。字符串有界；UUID版本/variant与共享契约范围一致，并要求小写；size范围0—1GiB。输出固定 `{ "version":1,"ok":true }` 或 `{ "version":1,"ok":false,"code":"..." }`，小于4KiB，不返回路径、原生错误文本、句柄或堆栈；成功exit0，拒绝exit1。

受控错误码为 `INVALID_REQUEST`、`UNSUPPORTED_VERSION`、`UNSAFE_PATH`、`ROOT_CHANGED`、`LEASE_MISMATCH`、`PROOF_MISMATCH`、`DESTINATION_EXISTS`、`FILE_BUSY`、`CROSS_VOLUME`、`IO_FAILED`；helper本身还以 `UNSUPPORTED_PLATFORM` 拒绝非Windows-x64。构建脚本在非该平台明确失败，不假造可用helper。

source/destination只能位于root的mods/resourcepacks/config文件或 `.oucl-distribution-staging/<本txId>/<0..4095>.new|old|rollback`；拒绝UNC、ADS、路径规范化别名、父级穿越、保留设备名和不相关目录。release不允许destination，source只能为root下 `oucl.session.lock`，必须同时匹配同handle文件证明与UTF-8 token。rename/link必须destination；delete/release禁止多带destination。

构建metadata固定为 `{formatVersion:1,file:'distribution-files.exe',sha256,bytes}`。它供主进程从包内受manifest保护的记录定位自有二进制，不接受renderer提交bin/hash。本helper只检查文件primitive身份与lease，**不认证签名、包归属、事务计划或执行许可**，不能替代主进程可信规划和持久journal。

## 已实现的句柄边界与尚未闭合处

root到父目录的每个普通祖先均持有GENERIC_READ、OPEN_REPARSE_POINT/BACKUP_SEMANTICS句柄，拒绝reparse属性，核对同卷；root的dev/ino必须等于请求里的原身份。独立lease文件句柄核对精确36字节token，普通操作持有只读lease；release复用lease作为DELETE源句柄，避免再开DELETE句柄的共享冲突。

源文件以READ|DELETE、ShareRead打开，拒绝目录/reparse/未知身份、链接数不在1..2；同handle分块哈希至多1GiB并核对外部Node证明，link只允许1→2。rename使用同handle SetFileInformationByHandle的no-replace选项；delete使用同handle disposition；hardlink在持有source/祖先时独占创建，目标先占不得覆盖。清理仅关闭句柄，不递归删目录。

**这些实现不等于原子reparse隔离通过。** 当前返回原ShareRead|ShareWrite是功能候选，允许目录写句柄，路径式CreateHardLinkW/绝对目标rename仍有未解决的reparse竞争。去掉ShareWrite的版本虽拒绝GENERIC_WRITE，却影响自身路径式操作，不能作为替代修复。

GENERIC_WRITE错误32只证明这一访问掩码；本片没有实际测尽FILE_WRITE_ATTRIBUTES等所有可影响reparse的访问方式，也没测所有reparse tag、内核版本或卷。Microsoft的 [FSCTL_SET_REPARSE_POINT说明](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_set_reparse_point) 与 [CreateFile共享规则](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea) 用于边界理解，不能代替真实准入测试。

协调者已另派v3逐级relative HANDLE与RootDirectory相对rename/link原型；本片不擅自扩写该方案，也不先接主进程。只有相应安全兼容性证据齐备后，才可决定替换当前内核实现。

## 真实测试记录

| 运行 | 实际结果 | 证据/限制 |
| --- | --- | --- |
| 初次功能验证 | 12项11PASS/1FAIL | ADS路径在.NET规范化阶段先抛异常，被映射为IO_FAILED，与UNSAFE_PATH断言不符；未改断言，修正为规范化前拒绝第二冒号。该初次控制台结果未另存日志，不冒称有独立原始日志。 |
| 修正ADS并补真实v7 UUID后，ShareRead\|ShareWrite | **13PASS/0FAIL，exit0，2.398s** | [test-share-write-previous.log](native-helper-evidence/test-share-write-previous.log) / [status](native-helper-evidence/test-share-write-previous-status.json)。这是新增目录GENERIC_WRITE准入断言之前的功能结果。 |
| ShareRead-only目录句柄 | **13项8PASS/5FAIL，exit1，2.499s** | [test.log](native-helper-evidence/test.log) / [test-status.json](native-helper-evidence/test-status.json)。正常发布link、v7正常link、占位保护、正常rename、先link再delete配对用例未通过；配对delete用例在前置link就失败，不能反推同handle delete单独失效。占位用例明确取得原生helper FILE_BUSY，不能误写为目标占位已正常处理。 |
| 同轮独立guard探针 | PASS | 未guard的空目标parent可开GENERIC_WRITE（native0），held时同一探针为ERROR_SHARING_VIOLATION32；普通子文件创建/删除仍允许，source写删与祖先rename被阻止。使用另一个进程编译/调用同份NativeGuard源码，未向产品协议增加test操作。 |

功能测试还覆盖Node/C# dev/ino/hash一致、目标先占字节保留、source被替换/wrongproof、root身份/lease门禁、release同handle、未知三硬链接、输入大小/重复字段/UTF-8/未来版本、外国tx staging/ADS/跨root路径拒绝，以及真实junction祖先拒绝且sentinel不变。跨卷helper输入是在schema层被拒绝；真实不同卷的native guard能力来自前继v2 spike，不能合并成一次完整跨卷mutation验收。

此前v2矩阵仍为10PASS/1符号链接创建权限1314不可达；独立junction路径补证与本helper junction测试通过，不覆盖所有reparse tag，不改写原1314记录，也不构成全平台结论。

测试始终使用独占 `OUCL_TEST_ROOT` 与新建合成文件；不触玩家目录、正式runtime、原owner现场或旧EXE。未新增skip，不通过修改断言制造全绿。回退后保留的GENERIC_WRITE必须32断言仍然存在，不能对原ShareRead|ShareWrite配置宣称该安全准入断言已通过。

## 首轮交接（历史保存点）

仅交付实现候选、编译接口、真实测试及阻断证据；不交付生产准入。当前旧功能配置未经新增断言重跑，后续应在v3真正解决兼容/隔离后统一重编、跑原断言和wrapper/事务测试。类型/lint由当前维护树实际工具核对，结果另存本目录；全库检查与本地提交由主协调负责。本代理未git add/commit、未push发布。

## v4后继：relative HANDLE替换与固定NTFS有界通过

上文的CreateHardLinkW、绝对目标rename及NOT_ADMITTED描述是首轮历史，不是本节最终库实现。v3两轮没有通过，未据其转换生产库；协调者确认v4唯一有界试验 **7/7PASS、exit0** 后，才从自有 `spikes/distribution-file-guard/v4/RelativeNative.cs` 提炼固定metadata模式。本片没有新增试验矩阵或修改旧spike。

最终库结构如下，stdin/stdout DTO、16KiB/4KiB界限、RootNodeProof、leaseToken、1GiB哈希及nlink1..2/发布1→2规则不变：

- 仅卷根通过CreateFileW取得起始句柄；限定drive type3、文件系统精确NTFS，并核对卷序列。其后**每个目录组件、lease与source均使用父HANDLE+单叶名NtCreateFile打开**，不重新解析绝对文件路径。
- 每个目录保留两种已测句柄：GENERIC_READ保护guard（ShareRead|ShareWrite、不ShareDelete）与TRAVERSE|READ_ATTRIBUTES|SYNCHRONIZE metadata anchor（ShareRead|ShareWrite、不ShareDelete）。anchor与guard必须同dev/ino；每层拒绝reparse/type/volume变化。
- lease通过root的held anchor打开；release继续复用其READ|DELETE源句柄。普通source为READ|DELETE|SYNCHRONIZE、ShareRead。root原始dev/ino仍与journal请求中的RootNodeProof核对，不能把当前新目录当旧root。
- rename/link不再调用CreateHardLinkW或带绝对目标字符串的SetFileInformationByHandle；两者使用NtSetInformationFile的FileRenameInformation10/FileLinkInformation11，**RootDirectory=held metadata anchor，文件名只有单叶名**，ReplaceIfExists保持false。同handle delete使用FileDispositionInformation13。
- preflight/收尾检查仍然存在，但实际安全边界不是“目录不能被改为reparse”：真正发生中途改写时，相对原目录对象的native操作必须拒绝或不逃逸。固定NTFS之外fail closed，不据此支持网络盘、FAT/ReFS、其他Windows版本或任意reparse tag。

### 本片最终验证

最终 **14PASS / 0FAIL / 0SKIP，exit0，2.835秒**，真实重编后原正常/占位/wrongproof/root/lease/严格DTO断言均通过。新增真实FSCTL测试先在held空目标目录上用FILE_WRITE_ATTRIBUTES256成功设junction，随后正常guarded调用拒绝；再故意绕过preflight、直接对原metadata anchor执行rename与link，二者均返回 `0xc0000280`（1921），source证明保持、外部sentinel和三个潜在逃逸目标均不变。未修改的stdin协议也对该已变为reparse的父目录返回受控UNSAFE_PATH。

原始证据：[relative-v4-tests.log](native-helper-evidence/relative-v4-tests.log)、[relative-v4-test-status.json](native-helper-evidence/relative-v4-test-status.json)、[relative-v4-fsctl-result.json](native-helper-evidence/relative-v4-fsctl-result.json)。源与实际helper二进制/metadata绑定在独立 [relative-v4-source-and-binary.json](native-helper-evidence/relative-v4-source-and-binary.json)，旧manifest没有覆盖。当前NativeGuard SHA-256为 `547143af5a6d24469208c5808fd4b0bdcbf828ccf401911557e6e4de8379657f`，Program为 `aba0b8632d4de64d548e358c7f8eabc103d241c2e668ffcf1f5d918aa651705d`，另存 [relative-v4-source](native-helper-evidence/relative-v4-source/) 供只读审查。

首次merge回归是12项实际协议/正常安全测试通过，另外两个独立C#harness在执行前编译失败（Capture兼容默认参数、fixture路径字面量转义）。保留 [初次日志](native-helper-evidence/relative-v4-initial-harness-failure.log) 和 [状态](native-helper-evidence/relative-v4-initial-harness-status.json)；仅完成这一次明确的兼容/夹具修复，未改变内核sharing方案或断言目标，然后复跑上面14项全部通过。

原GENERIC_WRITE必须32的假设断言**没有改成符合新实现的成功值**；它连同原代码已冻结在 [before-relative-v4](native-helper-evidence/before-relative-v4/) 和原失败日志。新测试转而实测FSCTL可以成功、正常调用拒绝、原anchor native调用不逃逸。保留原source写删/祖先rename禁止和正常/占位/身份断言，不把被证伪的假设或旧失败擦去。

audit_ui在其独占目录重新构建最终helper后，原12项Nodewrapper/factory/双恢复/loader测试也全部通过，未改断言；证据见同轮 [native-wrapper-relative-v4-tests.log](native-review-evidence/native-wrapper-relative-v4-tests.log) / [status-relative-v4.json](native-review-evidence/status-relative-v4.json)。独立审查、全回归/类型/lint、11文件打包审计和本地接纳由主协调统一汇总，本片不抢记尚未返回的最终结论。

此处只证明本机fixed local NTFS上的有界实现和接口链；符号链接创建权限1314、所有reparse tag/所有卷和完整系统故障矩阵没有改记通过。公共分发执行仍未接main，真实来源/公钥仍空，没有运行真实下载或游戏，没有替换正式EXE、push发布或git提交。源码已按协调者要求冻结，只有独立审查发现确定缺陷才再改。
