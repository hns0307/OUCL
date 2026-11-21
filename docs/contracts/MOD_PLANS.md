# 持久Mod安装预览与取消

2026-10-28，G2原批准Mod依赖确认方案的前置增量；延续JSON原子提交、恢复日志和受控worker，不新增依赖或SQLite表结构。

## 公开方法

| 通道 / preload方法 | exact payload | 成功data |
| --- | --- | --- |
| `mods:plan` / `planMod` | 既有实例UUID/修订、资源库项目/版本/SHA1、显式selections | `{plan: ModInstallPlan}`，返回前须保存 |
| `mods:planState` / `getModPlan` | `{planRequestId: UUID}` | `{plan: ModInstallPlan, status: preview或cancelled}` |
| `mods:cancelPlan` / `cancelModPlan` | `{planRequestId: UUID, planId: SHA256}` | `{plan: ModInstallPlan, status: cancelled}` |

所有请求使用contractVersion=1和关联requestId，主进程重新校验来源、schema和当前注册根。恢复/取消为15秒上限，创建仍为35秒；超时只表示响应未知。取消幂等由保存的目标计划身份与状态保证，不能凭另一次请求UUID替换计划。缺失计划返回NOT_FOUND，错误planId或同一创建UUID换参数返回REVISION_CONFLICT。已取消请求再创建返回CANCELLED；玩家重新计划使用新的请求UUID。公开响应不含root路径、下载URL、对象库位置或内部存储字段。

## 固定记录

`mod-plan-<requestUUID>.json`复用schemaVersion=1/revision/data原子envelope。data exact为formatVersion=1、rootId、requestId、payloadDigest、input、plan、status。最大2MiB，最多256项目/512问题，沿用既有计划限制。新预览只能从revision0写为1，取消从1写为2；计划body及input不可改写，不能把cancelled恢复成preview。未知版本/字段/状态或错误关联停读停写，原文件保留。

payloadDigest使用规范化实例UUID、显式根身份和排序selections计算；planId覆盖固定字段顺序、完整文件摘要/大小/处置、依赖来路及问题。每次存储读写复核两项本地内容身份、实例修订/根版本关系、待下载总量、项目去重及ready根文件身份。它们只关联本地证据，不代表上游签名或写实例授权。

同一在途创建请求共享一次有界planner，其他请求快速返回SCAN_BUSY。成功响应丢失后，只能凭完全相同的JSON提交记录恢复成功；没有精确提交证据返回NEEDS_RECOVERY。关闭时等待在途创建、恢复读取及取消写入完成，不让存储先于操作关闭。保存的预览是历史快照，后续确认仍须复验当前文件、实例修订、会话和真实声明。

## 界面与未完成范围

浏览器只保存由root/instance组成的键及请求UUID，作为可丢弃恢复指针；完整计划位于主进程存储。指针不授权安装。恢复时主进程校验记录，界面再校验所选实例及当前修订；不匹配显示旧修订提示并移除指针。切换实例后忽略旧异步结果。取消成功清除指针，保留cancelled记录。文件列表展示安全文件名、来源、大小、复用/资源库/待下载处置和requiredBy。

本增量没有确认接口、依赖实际下载、下载后真实JAR复验或一次安装事务，也没有开放删除/替换已有Mod。已有EXE保留，不将测试夹具或保存计划视为真实游戏安装成功。

后续2026-10-28已增加私有[可信下载准备服务](MOD_PREPARATION.md)，可对明确confirmed的固定计划执行实际对象传输及真实JAR检查；尚未接公共确认任务或一次实例事务，上述用户界面边界保持不变。

验证见[MOD-PLAN-DURABLE-20261028](../validation/MOD-PLAN-DURABLE-20261028/REPORT.md)。
