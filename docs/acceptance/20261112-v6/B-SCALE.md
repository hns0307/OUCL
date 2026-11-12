# B 双域规模与字节预算补证

日期：2026-11-12。固定候选v3/`bc01f07`。本次新增文件仅在 `D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/v6-b-scale/`，活跃树只新增本报告；没有改597冻结源码、产品契约、旧profile、GUI、SQL状态或提交。五小时开始已用25%、末次40%，始终高于20%剩余额度门槛，周额度不作门槛。

## 双域全worker/公共分页：PASS

脚本 `run.mjs` 使用原样生产worker `acceptance-results/product/workers/entry.cjs`，实际StorageClient → worker → RecordStore/SQLite/JSON。数据为新独占metadata/games根、合成Fabric ready实例和本地有效计划；没有Minecraft/Mod下载安装执行、网络请求或GUI活动。实例仅为只读规模定位用合成记录，不称正式安装完成。

构造均经正式API校验和持久化：

1. `StorageClient.accept(...,'mod-check',digest)` 接纳1000条，digest按正式 `{instanceId,expectedRevision,mode}` 顺序计算；`writeModJobs` 一次保存合法1000项对应索引。
2. `writeModPlan` 保存1000份合法preview/ready计划，每份root/request/input/payloadDigest/planId均经过正式解析；`acceptModConfirmation(...,true)` 正式确认接纳1000条mod-install。请求ID独立，目标/文件选择相同是合法重复尝试的合成输入；不手写SQLite接纳。
3. 两域各1000、共2000项属于同一个合成instance，便于确认单次目标查询完整返回两域。`admissions.json`保留2000个正式taskId、requestId及1000个计划记录ID。

没有调用执行器去伪造running/completed：它们是正式接纳API产生的queued任务，规模证据不代表正在进行1000个真实安装，也不涉及GUI活动验收。

| 读取 | 实际结果 |
| --- | --- |
| 双域首次真实worker读取 | 2000项，576,076字节，约1604ms |
| 关闭StorageClient/worker并重新打开后 | 2000项，相同序列化长度，约1483ms |
| 公共TargetAdapter分页 | 首次约1398ms；20页×100，全schema验证成功，taskId不重复，最终无nextCursor；mod-check/mod-install各1000 |

公共分页没有替代投影：使用真实ModTaskService的withTargetRead/targetTaskView和ModInstallTaskService.targetTaskView。构造器执行依赖留空且从不调用，未initialize/启动任务执行；这是**正式读取/持久证明/投影链**，不是领域执行或主窗口装配验收。每页请求经过真实TargetAdapter.handle与共享isTargetResult校验，读取的队列任务状态如实保留。原2秒worker/2.5秒main/30秒cursor预算未更改，以上是本机本轮实测，不保证所有硬盘/机器均在预算内。

## 正式API及真实库存超限：PASS

- 在已有1000个有效确认接纳后，另保存第1001份有效计划，再调用 `acceptModConfirmation`：正式返回 **QUEUE_FULL**，没有增加第1001条mod-install接纳。随后两域读取仍2000项，约1657ms。
- 使用正式通用 `accept(...,'mod-check',digest)` 添加第1001条检查接纳后，双域读取返回 **NEEDS_RECOVERY**，约10ms。拒绝发生在库存每域1000上限，早于索引关联；没有尝试保存不合法1001项ModJobs或伪造计划。
- 最终负例metadata原样保留：1001条check+1000条install接纳、1000项check索引、1001份plan（最后1份未接纳）。因此**本轮结束数据库有意处于库存拒绝状态**，不当作后续成功样本，也不清理修复。前面的成功结果和接纳清单已保存。

这补齐[闭合清单](BC-CLOSURE.md)当时DEFERRED的双域1000计划读取/公共分页和真实每域超限拒绝。不是“合法2001行应通过”：当前每域≤1000，总2001必然至少一个域超限，正式读路径应拒绝，不得截断成部分成功。

## 1MiB公开 / 2MiB私有精确字节两侧：合法域不可达

独立 `byte-bounds.mjs` 枚举31个固定InstanceError代码，通过正式instanceFailure生成，选最长合法error（UNSUPPORTED_CONTRACT，157字节）；构造2000个独立UUID行、两域各1000，所有可选字段存在，数字均使用最大16位十进制安全整数（私有revision按解析规则取MAX-1），state/stage最长needsRecovery。每个公共TaskSnapshot通过正式schema；100条最大种类mod-install页通过isTargetResult；2000条私有结果通过正式parseReply/parseModTargets。

| 对象 | 合法schema最宽样本/上界 | 防御阈值 | 距阈值 |
| --- | --- | --- | --- |
| main公开全快照，2000行 | **936,063 B** | 1,048,576 B | 112,513 B |
| 单页公开data，100行mod-install | **46,963 B** | 1,048,576 B | 1,001,613 B |
| 私有ModTargets，2000行 | **800,091 B** | 2,097,152 B | 1,297,061 B |

推导前提是产品生成的普通exact DTO以 `JSON.stringify` 规范序列化：UUID固定36个ASCII字符；kind最多11字符（1000行各域，mod-install比mod-check长2）；state/stage最多13；数字为非负安全整数，最多16位；错误仅固定code/category/messageKey/retryable/UUID traceId；私有execution只含固定键和整数，无任意文本或错误堆栈。数组总≤2000，每域≤1000。所有字符串均固定ASCII，UTF-8长度不存在多字节扩张。字段和逗号/括号长度由真实样本JSON逐字节统计。

上述公共构造甚至允许实际task service不会生成的最长通用错误及check的最大bytesDone，因此是**覆盖真实服务输出的保守上界**；不称所有字段组合都能由业务状态机自然产生。私有构造使用全部数值最大宽度并通过实际parser。两者均低于阈值，故规范化合法域输出不可能达到阈值或阈值+1。

原规范的1MiB/2MiB语义应理解为额外防御性上界，不能为验“+1”加入extra字段、超长UUID、超2000行、私有路径/任意错误文案或toJSON函数来冒充合法业务DTO。也不能把未规范化的JSON空白填充称作产品JSON.stringify负载。**本次结论是合法域不可达证明及有效schema样本PASS，不是执行了合法精确阈值/超限两侧测试。** 若将来放宽行数或字符串schema，必须重新计算并补可达字节边界。

## 命令、证据及失败保留

cwd为v3副本：

- `node acceptance-results/v6-b-scale/run.mjs`：退出0，result.json status=PASS；run.log含每100份计划进度和全部读取/20页耗时。
- `node acceptance-results/v6-b-scale/byte-bounds.mjs`：退出0，byte-bounds.json记录上界、固定错误枚举与推导；byte-bounds.log保存输出。

字节脚本首轮失败于错误码枚举数量断言：原正则只匹配行首，漏掉同一行第二个SESSION错误。修正为匹配所有固定键后枚举31项通过；原失败日志保留为byte-bounds-initial.log。之后改用更长mod-install种类生成100行页，复算输出；没有改产品或降低校验条件。规模链首轮即通过，未重复生成2000条数据。

只读核对两关键源码SHA256仍为原固定值：`src/ipc/task-targets.ts`=`9379F58EBC646FB38075A23B5519F33C81469217A019A63F4837DB3C17D4C683`；`src/services/workers/mod-targets.ts`=`C84381F0C29D1ABFC6140E0E8DB257E924CF5F3DA5349F69A28B128723108812`。未声称本轮重新跑完整回归或全部597文件漂移检查，主协调保管完整冻结清单。

## 更新后的范围判断

双域1000正式记录/确认计划全worker读取、持久重开及公共20页、1001正式接纳上限/库存拒绝已可PASS；精确字节阈值在当前合法规范DTO域不可达，以上界证明关闭该域的可达性问题，保留防御分支未用合法+1触发的事实。真实GUI规模、大慢盘/全部生命周期组合、最终EXE和游戏兼容仍不由本报告证明。没有发现本轮需要改产品源码的真实缺陷。
