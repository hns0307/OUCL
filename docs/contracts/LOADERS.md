# 加载器元数据契约（增量 1）

状态：2026-10-26 已批准实现；本文件只覆盖 Fabric/Quilt 官方元数据进入安装编排前的纯解析边界。

## 信任边界

- 目录和 profile 必须由主进程从加载器官方 HTTPS 端点取得；渲染进程不能提供 URL 或原始 profile。
- profile 只声明版本身份、入口、参数和 Maven 坐标。解析器固定校验加载器、Minecraft 版本、profile ID、客户端入口和允许的仓库来源。
- profile 内同时提供 SHA-1 与大小时，两者作为该官方响应的上游证明保存。缺任一项均拒绝。
- profile 未提供摘要时，安装编排必须从同一官方 Maven 仓库取得对应 `.sha1` sidecar，再创建下载任务。下载后的本地计算摘要只用于复验，不得替代 sidecar 或伪装成上游证明。
- 解析器不选择“最新”版本，不执行参数，不访问网络，也不把未验证组合标记为受支持。

## 有界输入

- 单次目录最多 2048 项，profile 最多 256 个库；参数和规则继续使用版本描述符的既有限制。
- Maven 坐标只允许安全的 group、artifact、version、可选 classifier/extension，并由坐标确定相对路径。
- 当前允许仓库：Fabric `maven.fabricmc.net`；Quilt `maven.quiltmc.org` 与其明确引用的 Fabric Maven。禁止 HTTP、凭据、查询串、片段和任意镜像替换。

Forge/NeoForge 安装器、sidecar 获取、下载任务和实例提交属于后续已批准增量，不由本契约声称已完成。
