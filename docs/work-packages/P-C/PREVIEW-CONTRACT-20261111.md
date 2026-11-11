# P-C V2a 只读入口：可审阅契约草案

状态：**APPROVED / IN_PROGRESS**。用户在本聊天对“是否批准按推荐草案接入只读预览”直接回复“接入”。本批准只覆盖本页只读预览，不授权变更文件、持久格式或安装事务。它细化 [PLAN §4.2](PLAN.md) 原有概念：原表把耗时扫描的任务接纳和完整计划结果写在同一响应中；V2a先采用独立、可过期的内存观察，以免将未实现的持久计划和可执行句柄冒充已有能力。

## 输入与返回

能力名候选 `mods-maintenance-preview.v1`，仅主进程完整装配且三方法均可用时广告；沿用现有版本化请求信封、合法sender校验和关联requestId。每个payload为exact object，多余字段、路径和URL均拒绝。

| 方法 | payload | 成功 data |
| --- | --- | --- |
| `mods:maintenancePreview` | `{rootId, instanceId, expectedRevision, expectedFingerprint, fileId, action}` | `{previewId}` |
| `mods:maintenancePreviewStatus` | `{previewId}` | `{previewId, status, result, errorCode}` |
| `mods:maintenancePreviewCancel` | `{previewId}` | `{previewId, status}` |

UUID 使用现有格式、主进程小写归一；expectedRevision为≥1安全整数；expectedFingerprint/fileId为64位小写十六进制；action仅`enable`或`disable`。`expectedFingerprint`取自用户当前所见的Mod报告：同名文件字节改变时必须重新检查，不能仅凭同名fileId接受旧选择。文件名、大小、摘要、环境和依赖均由主进程重读，不由调用方提供。

`previewId`是随机UUID，仅标识一次只读观察，**不是文件句柄、持久计划ID或写入许可**。status仅为`queued`、`running`、`completed`、`cancelled`、`failed`：completed时result非null且errorCode为null；failed时result为null且errorCode非null；其他状态两者均null。接受、状态与取消均有3秒应答预算，超时只表示回执未知。

重试接纳必须使用同一个requestId和完全相同的规范化输入：同一运行中的主进程返回相同previewId；同ID不同输入返回INVALID_ARGUMENT。renderer超时后先用同一requestId重试，不创建新的扫描。进程退出后观察失效；重启不会重放扫描、恢复任务或写入。用户重新发起时使用新requestId及最新报告。内存最多16项未过期观察，满时返回SCAN_BUSY；完成/取消/失败15分钟后失效并返回PREVIEW_EXPIRED。时间采用主进程单调计时，状态查询不延长有效期。若所有观察均完成但未过期，仍拒绝新接纳，不能静默逐出尚可查询的结果。

实现细节：为避免过期后同requestId的迟到重试悄悄开启新扫描，主进程保留最多4096个已过期请求ID；达到上限后安全拒绝新接纳，进程重启清空。已过期ID重试返回PREVIEW_EXPIRED，不保存内容或玩家路径。

取消queued直接终态；running发出AbortSignal并等待检查器退出后才为cancelled；取消与完成竞态按主进程串行接纳顺序确定终态。终态重复取消只读回原终态。窗口关闭不主动取消，sender销毁不删除结果；重开窗口在进程仍存活时可用自身持有的previewId查询。前端每秒有界查询，停止时清理定时器；状态查询失败只表示观察连接不可确认，不触发第二次写入或推断扫描失败。该候选不改变通用任务订阅协议，也不把观察项目并入持久任务历史。

## 完成结果

内部实现 `presentMaintenancePreview` 的候选投影包含：`rootId, instanceId, instanceRevision, fingerprint, fileId, filename, sha256, action, state, providers, directRequiredBy, transitiveRequiredBy, issues, relations, platformFailures, incomplete`。其中状态为`ready`、`blocked`、`unknown`；展示文案必须把ready解释为“本次已知声明检查未发现阻止因素”，**不显示为可执行授权或游戏兼容保证**。

- providers：`{id, ownerId, version, embeddedDepth}`，让用户看到同一JAR包含的声明及别名；nested只暴露深度，不暴露JAR内部路径。
- issues：`{moment, scope, severity, code, fileId, modId, dependencyModId, dependencyProjectId, dependencyVersionId, requirement, actual, embeddedDepth}`；moment区分before/after，scope区分local/platform；空值为null，actual最多16项。旧问题与新问题均可见。
- relations：`{scope, dependentFileId, providerFileId, optional, dependencyModId, dependencyProjectId, dependencyVersionId, embeddedDepth}`；本地与平台身份独立，不按名字合并。directRequiredBy、transitiveRequiredBy为对应根文件ID数组，不自动启停其他文件。
- providers、issues、relations、两组反向ID及platformFailures共用512项预算；超限或无法安全表达则`incomplete=true`且不得返回ready。blocked保留，不能因截断误显示无冲突。报告内无绝对路径、原始下载URL、平台证据URL、文件系统身份、命令行或原始声明体。
- 显示文件名称时需复用既有安全文件名校验；引用其他文件ID时只能依据同一fingerprint的原始报告映射名称，找不到则保留ID和未知提示，不能从当前另一实例猜测。

## 错误、接入与验收

候选错误：INVALID_ARGUMENT、INVALID_SENDER、TIMEOUT、UNAVAILABLE、ROOT_UNAVAILABLE、REVISION_CONFLICT、FILES_CHANGED、SCAN_BUSY、MOD_LIMIT、MODS_UNSAFE、SCAN_FAILED、CANCELLED、PREVIEW_EXPIRED及既有平台错误。映射共享错误分类和可本地化文案，禁止返回堆栈与绝对路径。平台不可用或证据缺失保留unknown，不生成“可执行”结果。

拟改文件：新增独立shared严格schema及测试；主进程新增只读job registry/生命周期测试及装配；IPC dispatcher/preload白名单/handshake能力；ModPanel请求、状态轮询与展示；messages文案。既有 `mods.v1`、Mod安装计划及worker存储格式不扩写；不新增运行依赖。涉及公共文件时先与P-B/P-D共享修改协调，保留其他工作区内容。

验收必须包含：旧fingerprint同名换字节拒绝；跨root/实例/修订切换；相同requestId重复/不同内容；应答丢失、取消与完成竞态、关闭窗口与进程重启；512项边界和非法/私有信息脱敏；一个多声明JAR的本地声明及平台源双重检查；主进程/真实preload的非法sender和schema；界面显示完整影响与unknown。全为隔离测试根，不操作玩家文件。Windows链接/回环环境导致的其他完整回归缺项保持开放。

这是可批准的只读契约草案，不将其写成已批准。若选择保留原PLAN的持久计划/通用任务做V2a，需另冻结任务kind、结果存储与重启恢复格式，再比较成本；推荐先用本页可过期观察完成只读展示。
