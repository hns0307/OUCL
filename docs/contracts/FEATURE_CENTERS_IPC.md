# OUCL 0.5.0 四系统 IPC 接口

适用于启动器自有页面的 `window.oucl`。先调用 `handshake()`，再按返回的能力启用功能。下表对应当前 preload，网站页面使用隔离的 WebContentsView 和 Session。

| 能力 | preload 入口 | IPC 通道 | 请求内容字段 | 等待上限 |
| --- | --- | --- | --- | --- |
| `skin.v1` | `skinList` 等 11 个固定方法 | `skin:*` | `payload` | 70 秒 |
| `accounts.online.v1` | `onlineAccounts(action)` | `accounts-online:request` | `action` | 登录 185 秒，刷新 95 秒，其他 12 秒 |
| `web-extensions.v1` | `webExtensions(action)` | `web:request` | `action` | 20 秒 |
| `multiplayer.v1` | `multiplayer(input)` | `multiplayer:request` | `payload` | 导入引擎 60 秒，其他 8 秒 |

preload 为请求添加 `contractVersion: 1` 和 UUID `requestId`，并校验响应的关联 ID。返回值均包含 `ok`，成功读取 `data`，失败读取 `error`。网站和在线账号返回字符串错误码；皮肤与联机返回含 `code` 的对象。等待超时后先刷新状态，再决定是否重试写操作。现有 `accounts.v1` 继续负责离线档案。

## 皮肤中心

| 方法 | 输入 | 成功结果 |
| --- | --- | --- |
| `skinList()` | 无 | 已保存的站点和角色账号 |
| `skinDiscover(url)`、`skinAddProvider(discoveryId)` | HTTPS 地址、确认后的发现 ID | 发现结果、保存后的站点 |
| `skinRemoveProvider(providerId)`、`skinOpenSite(providerId)` | 站点 ID | 空对象 |
| `skinLogin(input)` | `{ providerId, username, password }` | `ready` 和账号，或 `select` 和候选角色 |
| `skinSelectRole(loginId, roleUuid)`、`skinCancelLogin(loginId)` | 临时登录 ID、所选角色 UUID | 保存后的账号、空对象 |
| `skinPreview(accountId)`、`skinLogout(accountId)` | 角色账号 ID | 贴图与上传能力、远程撤销结果 `{ revoked }` |
| `skinUpload(input)` | `{ accountId, model, png }`，PNG 为 `Uint8Array`，最大 1 MiB | `{ applied: true, preview? }` |

发现 ID 和选角色 ID 有效期 5 分钟。上传成功后若预览刷新失败，仍以 `applied` 表示写入结果。密码仅用于当前认证请求，令牌在主进程处理和加密存储。详见 [skin.ts](../../src/shared/contracts/skin.ts)。

## Microsoft 与在线账号

`onlineAccounts` 使用 `kind` 分派。 `list` 返回 Microsoft 配置状态与 Microsoft、Yggdrasil 账号列表。 `beginMicrosoft` 打开系统浏览器，`cancelMicrosoft` 取消。 `refreshMicrosoft`、`removeMicrosoft` 和 `textures` 接收 `accountId`。贴图单独返回为已校验的 PNG Data URL。

权益状态包括 `owned`、`playable`、`none`、`reauth`。选择启动账号前检查 `ready`，主进程启动时仍会复核。Microsoft 登录需配置获准的 `OUCL_MICROSOFT_CLIENT_ID`。详见 [online-accounts.ts](../../src/shared/contracts/online-accounts.ts)。

## 网站中心

`webExtensions` 使用 `kind` 分派，成功返回带 `revision` 的快照。 `state` 可在面板可见时轮询，`layout` 上报原生网页边界，`deactivate` 隐藏网页。导航与标签页操作包括 `newTab`、`open`、`navigate`、`select`、`closeTab`、`back`、`forward`、`reload` 和 `zoom`。收藏、弹窗和下载使用各自的快照 ID。

下载先进入 `confirmation`，用户确认后调用 `download`。 `prepareMod` 将验证后的 Modrinth 工件加入资源流程。 `importAddon` 需要 `downloadId`、`instanceId` 和实例 `revision`。 `installPack` 创建隔离实例，使用返回的 `packTaskId` 查询最终状态。 `skinDraft` 只生成待确认的皮肤草稿。退出应用或执行 `clearSession` 会结束网站登录 Session。详见 [web-extensions.ts](../../src/shared/contracts/web-extensions.ts)。

## 联机中心

`multiplayer` 使用 `action` 分派。 `snapshot` 读取引擎、受管游戏和房间状态。 `importEngine` 通过原生文件选择器导入固定摘要的 EasyTier 2.6.4 官方 ZIP。 `host` 接收 `sessionId` 和可选 `port`；`invite` 返回邀请码，`join` 接收邀请码，`leave` 撤销会话。 `configure` 设置或清除私有中继，配置字段为 `address`、`publicKey` 和 `stun`。

创建或加入后继续查看快照。来宾在 `connected` 阶段使用 `localPort`，房间状态可报告 `lan`、`direct`、`relay` 或 `unknown`。详见 [multiplayer.ts](../../src/shared/contracts/multiplayer.ts)。

外部配置和已验证范围见[四系统说明](../FEATURE_CENTERS.md)。
