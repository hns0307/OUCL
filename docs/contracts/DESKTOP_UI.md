# 桌面外观与论坛前端接口（2026-10-28）

用户明确批准新增固定外观/草稿记录和受控图标读取，并要求预留论坛前端接口；不连接后台，无新依赖。

## 持久化与受控能力

`desktop.v1`使用版本1信封、UUID requestId、可信主frame/document检查和双向精确schema。renderer仅接收重编码PNG，不接收本地路径或远程图标URL。

| 通道 | 输入 | 输出 / 超时 |
| --- | --- | --- |
| desktop:get | 空 | DesktopSnapshot；8秒 |
| desktop:appearance | expectedRevision、完整Appearance | DesktopSnapshot；8秒 |
| desktop:saveDraft | expectedRevision、ForumDraft | DesktopSnapshot；8秒 |
| desktop:deleteDraft | expectedRevision、draft id | DesktopSnapshot；8秒 |
| desktop:chooseIcon | 空 | icon PNG data URI，取消为空；130秒 |
| desktop:resourceIcon | projectId | 官方项目图标重编码PNG或空；60秒 |

错误为INVALID_ARGUMENT、INVALID_SENDER、UNSUPPORTED_CONTRACT、REVISION_CONFLICT、TIMEOUT、UNAVAILABLE，无原始路径/堆栈透传。写入超时表示结果未知；重新读取真实记录，不当作已取消。所有修改CAS且串行，论坛草稿不覆盖外观，外观不改启动参数；侧栏保存保留尚未提交的外观预览。

固定`desktop.json`沿用现有`schemaVersion:1/revision/data`信封、worker单写者及JSON提交日志。data为`{appearance,drafts}`，缺失时只读返回默认，不重写旧设置。Appearance包含四种六位HEX颜色、重编码icon、sidebarCollapsed、density、layout、完整homeOrder及homeHidden；当前游戏卡不可隐藏。drafts最多50条，每条含UUID、title≤120、category、body≤20000、updatedAt；纯文本不作为HTML渲染。未新增任意JSON/路径读写或SQL入口。

本地图标仅由原生选择器取得路径，限512 KiB，支持PNG/JPEG/WebP，重编码为128×128 PNG。资源图标由主进程根据项目ID重新查询官方项目，限制HTTPS官方CDN、同项目路径、PNG/JPEG/WebP、无跳转/凭据/query。网络响应限512 KiB，三条有界读取队列、去重和128项缓存；错误使用字母占位，不伪造资源自身图标。renderer CSP仍禁止外部连接与外部图片。

## 论坛后端适配边界

`src/ui/forum-source.ts`定义`ForumDataSource`，作为可注入`ForumPage`的前端数据源：

- `mode:local|remote`。
- `list({category?,search},AbortSignal)`返回主题摘要/内容投影。
- `read(id,AbortSignal)`读取详情；新选择/离开编辑时中止旧读取，防止迟到响应覆盖。
- 可选`publish({title,category,body},AbortSignal)`为未来远程发帖入口；默认本地适配器不提供，生产不会发送或声称发布成功。

主题模型为`{id,title,category,body,updatedAt,state:draft|published,author}`。默认`localForumSource`只投影真实主进程持久草稿，分类为综合/游戏帮助/模组/作品，支持过滤、编辑和删除。后续接后台只替换数据源并增加经批准的主进程网络契约；不能在renderer直接fetch、硬编码后台地址/凭据或把本地草稿伪装成线上帖子。实际后台鉴权、分页、回复、管理与服务端实现待独立设计，不以本前端接口推定远程协议已确定。

## 交互

侧栏收起后保留实例图标入口、名称tooltip和展开按钮；配色/间距/左右布局/首页卡片排序可预览、保存、恢复默认。首页卡片把手可拖动，也有上移/下移及显示开关。低频外观、已配置Java/目录、进阶隔离/并发、关于信息采用原生details折叠。

内存范围滑块与精确MiB输入同步，支持键盘；保存仍复用已有主进程物理内存验证及实际启动参数。下载页显示项目自身图片；仅应用内资源卡可拖入详情区，仍明确选择版本与文件后提交下载，不因拖动自动写实例；分栏可拖动并支持方向键，小窗口堆叠。

验证证据见`docs/validation/UI-20261028/REPORT.md`。参考本地PCL设置组织、KAMUCL布局编辑与XMCL外观职责，只借鉴交互设计，不复制实现或素材。
