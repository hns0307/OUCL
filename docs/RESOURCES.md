# Modrinth 资源库 v1

2026-10-25用户批准《OUCL 前端改版与资源下载》；本增量仅下载资源，不安装加载器、依赖或写入实例。

## 契约

能力`resources.v1`。通道均采用版本1信封、requestId关联、可信主frame和严格schema；renderer只传标识和筛选，无URL/路径透传。

| 通道 | 输入 | 返回 / 时限 |
| --- | --- | --- |
| resources:search | kind=mod/resourcepack/shader、query≤120、gameVersion、loader、offset≤10000 | 20条结果、total、offset；15秒 |
| resources:versions | projectId、gameVersion、loader | 最多100个版本，含兼容版本/加载器及文件SHA1选择标识；15秒 |
| resources:download | projectId、versionId、fileId=SHA1 | taskId；15秒；超时结果未知，保留requestId重试 |
| resources:library | 空 | 最多512条公开资源记录；5秒 |
| resources:open | 空 | opened=true；5秒；仅主进程打开固定资源库目录 |

下载接入现有tasks:list/get/control/subscribe/events:unsubscribe，TaskSnapshot新增download类别；仅支持cancel，提交阶段拒绝取消。观察退订不取消传输。错误包括INVALID_ARGUMENT/INVALID_SENDER/UNSUPPORTED_CONTRACT/TIMEOUT/UNAVAILABLE、NETWORK_FAILED/RETRY_LATER/HASH_MISMATCH/ROOT_UNAVAILABLE/NEEDS_RECOVERY；不暴露堆栈、私有路径或原始响应。失败资源保留errorCode及重试入口。

## 来源、存储与恢复

主进程访问`https://api.modrinth.com/v2`，固定User-Agent、12秒API期限、8MiB响应上限、最多4个并发API请求；429按Retry-After退避。搜索按项目类型、游戏版本和运行组件筛选。下载再次取得项目和版本，验证归属、文件名、大小与官方SHA1。只有HTTPS官方CDN可作为文件来源，拒绝重定向、凭据、端口和query。

扩展来源锚`modrinth-version`：官方版本响应SHA256标识来源，文件使用官方SHA1；共享对象仍按SHA256寻址，来源证明独立。Modrinth传输与Mojang、Adoptium分属协调域。复用安装器持有的唯一对象仓库、worker哈希、传输事务和有界协调，不新建竞争owner。

固定`resource-library.json`复用版本1信封和原JSON提交日志，data为`{rootId,items}`。每项含公开项目/版本/文件标识、类别、文件名、大小、任务UUID、downloaded、可选错误，以及私有下载spec和对象引用。固定最大512项，不变更tasks.sqlite格式；SQLite的download任务和请求幂等沿用既有结构。

文件投影位于`<数据根>/resource-library/<kind>/<taskId>/<安全文件名>`，优先软链接，权限不足复制回退。先校验共享对象并完成投影，再提交downloaded=true，最后完成任务。提交阶段中断保持needsRecovery；正常重开可收敛JSON已提交而任务尚在committing的状态。其他中断不冒充完成，显示恢复状态并可新请求重试，可信传输前缀按原引擎继续。旧owner仍保守阻塞，不删除锁。

## 证据

离线测试覆盖严格IPC、来源归属和URL/文件名拒绝、限流、幂等、校验失败不发布、取消等待、重试与worker重开。真实三类官方文件及独立SHA1/大小复核和重开记录见`validation/UI-0.2.0/real-resources.json`。首次样本失败未记通过，后续独立复测通过；不据此声称全平台或所有资源可运行。
