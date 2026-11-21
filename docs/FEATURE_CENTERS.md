
# OUCL 账号、皮肤、网站与联机

从工具箱切换四个中心。首页账号选择器列出可用的离线、Microsoft 和第三方角色账号。离线档案继续使用原有存储和启动规则。

## Microsoft 正版账号

把本地启动环境的 `OUCL_MICROSOFT_CLIENT_ID` 设为 OUCL 自有并获准访问 Minecraft Java 游戏服务的 Microsoft 公共客户端 ID。应用登记须支持个人 Microsoft 账号，并在移动和桌面应用平台登记 `http://localhost/oauth/callback`。OUCL 在随机回环端口等待一次授权响应，使用系统浏览器与 PKCE S256。客户端 ID 是公开配置，桌面端无需客户端密码。应按 Minecraft 游戏服务运营方的申请流程取得访问权限。

在账号管理中登录、刷新权益、查看外观或登出。游玩权益与永久所有权分别显示，启动还需要 Minecraft Java Profile。OAuth 缓存以 Windows 用户的系统加密能力保护，保存在 OUCL 的应用数据下。

## 皮肤中心

输入站点的 HTTPS 地址并核对最终认证域，添加后用站点账号授权一个游戏角色。对另一个角色重新登录并选择。支持协议的角色可从界面预览、上传并应用皮肤，衣柜等高级操作打开已核对的站点。第三方角色启动需要 GitHub 官方发行制品 authlib-injector 1.2.8，OUCL 按固定 SHA-256 获取和复验。

## 网站中心

浏览公共 HTTPS 网站，标签共享应用运行期间的登录状态，收藏可以跨重启保留。需要系统登录能力的网站可在系统浏览器继续。网页下载需要确认，完成后可导出或使用匹配的原生操作。确认 JAR 对应 Modrinth 版本后进入资源库和现有安装流程。资源包与光影包可写入选中的隔离实例。经过验证的皮肤 PNG 可以交给皮肤中心草稿。支持的 Modrinth v1 整合包导入为独立实例，安装结果以任务中心的终态为准。

## 联机中心

从 [EasyTier 2.6.4 官方发行页](https://github.com/EasyTier/EasyTier/releases/tag/v2.6.4) 下载 `easytier-windows-x86_64-v2.6.4.zip`，在联机中心选择导入。OUCL 校验官方归档摘要，所用引擎由用户从上游取得。主机使用 OUCL 启动 Minecraft 并开放局域网世界。选择受管会话，核对检测到的游戏端口或手动指定。分享房间邀请码后，来宾可在 Minecraft 中连接联机中心给出的本机地址。

默认尝试同一局域网。跨网络时双方须按联机中心要求预配同一获准私有 EasyTier 节点及其固定公钥，并使用获准网络。关闭房间会撤销 OUCL 的连接，Minecraft 自己开放的局域网世界由游戏管理。联机身份与 Minecraft 服务器的账号认证分别处理。

## 依赖与许可

MSAL Node 7.2.1 和 skinview3d 3.4.2 使用 MIT 许可，Windows 打包附运行时依赖的许可文本。authlib-injector 1.2.8 按上游 AGPL 许可与 JVM Agent 例外使用。EasyTier 2.6.4 使用 LGPL-3.0，OUCL 通过独立进程调用用户从上游取得的发行版。

## 本地验收记录

- 26 项定向测试通过，包括离线和线上账号启动参数、加密缓存重开、皮肤站合成协议、归档校验与回滚、网站下载及游戏目录租约、联机房间鉴权与路由。
- Electron 45 实际加载四个中心，离线账号创建和 Windows 凭据加解密通过。网页模块的独立 Chromium 测试完成公共 HTTPS 加载、预加载隔离及下载确认。
- 官方 EasyTier 2.6.4 Windows 二进制完成本机双进程加密会话，合成 Minecraft 状态请求成功往返。跨网 P2P、私有中继和双机实际进世界仍待实测。
- 完整回归首轮在沙箱内报告 Windows worker 和分发原生用例失败。完整回归未通过，定向测试使用有权访问本机回环及硬链接的隔离环境。
- Microsoft 真实账号登录和真实皮肤站登录、换肤及第三方账号游戏启动等待外部验收条件。

## 2026-11-21 补验

- 修正干净检出的临时目录缺失和启动恢复夹具的规划器导出。隔离临时目录下的 `pnpm check` 通过，共 1025 项，1021 通过、0 失败、4 跳过，类型检查、Lint 和 Windows 构建通过。
- Electron 45 通过正式 IPC 匿名发现 LittleSkin 的 Yggdrasil API。可设置 `OUCL_SMOKE_SKIN_PROVIDER=https://littleskin.cn`，用当前构建运行 `scripts/electron-feature-centers.cjs` 复验。
- 生产下载服务从官方发行页下载 Authlib-Injector 1.2.8 并通过固定 SHA-256 核验。MSAL 生成了带随机本机回环端口的 S256 PKCE 地址，取消流程通过。微软验证使用合成客户端标识且截断浏览器打开。
- 复用既有验收缓存，在独立目录重新核验并物化 3641 个官方文件，随后启动 Minecraft 1.20.1 的真实离线 JVM。观测到方块贴图加载，正常关窗退出码为 0。Java 17 安装在中文目录，启动前探测已修复仅因其他属性的本地编码而误拒的问题。另一次实际安装在 190 秒验证时限内停在下载阶段，并已取消。
- Java 路径修复后的最终 `pnpm check` 通过，共 1026 项，1022 通过、0 失败、4 跳过，类型检查、Lint 和 Windows 构建通过。
