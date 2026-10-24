# 阶段1A官方版本目录 v1

2026-10-24。按已批准提案§7实现versions:catalog及catalog.v1能力；不是安装/启动成功的声明。handshake major仍1，严格能力集合允许roots.v1/catalog.v1子集，未知或重复值拒绝。preload只新增catalog(query)，没有通用invoke/URL/文件访问。

请求exact为`{contractVersion:1,requestId:UUID,payload:{channel:release|snapshot|old,limit:1–100,cursor?:1–512字符}}`。响应data exact为`{page:{items,nextCursor?},fetchedAt:ISO UTC,cached:boolean}`，每项`{mcVersionId,type,releaseTime,status:verified|candidate|unsupported}`。当前所有条目为candidate：官方元数据有效不等于本机启动实测。old包含old_alpha/old_beta。

响应不含版本URL、摘要、磁盘路径或源JSON；ID不重复，拒绝未知字段、无效时间/错误映射。领域错误network.CATALOG_UNAVAILABLE、network.UNTRUSTED_MANIFEST；通用错误沿用INVALID_ARGUMENT/UNSUPPORTED_CONTRACT/INVALID_SENDER/TIMEOUT/UNAVAILABLE及受控messageKey。调用等待15s，目录读取无副作用任务或订阅。main先验证当前窗口、主frame、完整应用URL及请求，未授权调用不访问网络/缓存。

Bootstrap固定HTTPS `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`；描述仅允许piston-meta.mojang.com/launchermeta.mojang.com的v1/packages/<SHA1>/<受控版本名>.json，拒绝端口/凭证/query/hash/重定向。每份响应总时限12s，最大2MiB，按块计数、fatal UTF8解码；描述必须匹配官方manifest SHA1后才解析。网络可注入mock，无镜像元数据替换信任锚。顶层manifest的信任起点是官方HTTPS，不声称它有独立签名。

目录最多20000条，校验类型/时间/唯一版本身份。真实官方历史ID可含内部ASCII空格（如3D Shareware v1.34），URL按编码片段解码校验；拒绝前后空格、斜杠/反斜杠、冒号、控制符、空值及`.`/`..`。上游版本身份与本地directoryId分离，不能把这份ID直接当用户路径。描述继承最多32层，必须各自来自manifest并逐份验证；纯解析保留原安全规则和每版本元数据SHA1关联。

缓存使用既有RecordStore的catalog.json，原schemaVersion/revision/data envelope不变。data exact为`{fetchedAt,body,sha256}`，worker固定catalog:get/set schema通过原SQLite恢复日志和JSON提交点写入。正文≤2MiB且重新核对SHA256和manifest schema；这份本地摘要不替代来源信任。缓存信任依赖受管元数据和其权威历史，不从任意外部文件导入。未来时间超过1分钟拒绝。

5分钟内复用，过期刷新合并为一次请求；网络不可用可回已验证旧缓存，保留原fetchedAt/cached=true并30s退避。损坏新清单/错误摘要不走失败回退升级信任。分页cursor绑定正文SHA256和channel，旧清单游标/错误偏移拒绝；UI只回传，不解释。只读离线浏览不等于离线可安装所有制品。

本增量没有游戏JAR/assets/Java下载、任务控制或会话。UI仅浏览真实目录，不显示假安装按钮。实际官方响应和源码窗口证据见A1-05-catalog报告，不能用其替代游戏运行验证。
