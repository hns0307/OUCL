# 工具隔离与社团包只读预览 v1

共同信封为 `{contractVersion:1,requestId:UUID,payload}`。仅已登记本地主窗口精确文档和主frame可调用；结果严格schema校验，错误固定code/messageKey/traceId，不返回原始异常。字段定义以 `src/shared/contracts/online-tools.ts` 和 `distribution-preview.ts` 为准。

| 能力/通道 | 输入payload | 成功输出 |
| --- | --- | --- |
| tools.isolated.v1 / tools:state | {} | 固定tools元数据与revision/phase/toolId/code快照 |
| tools:open | {toolId} | 同上；不接受URL、脚本、bounds或权限 |
| tools:retry、tools:close | {} | 同上 |
| distribution.preview.v1 / distribution:sources | {} | 固定sourceId列表 |
| distribution:preview | {rootId,instanceId,sourceId,packageId,packageVersion} | 只读摘要、前200个相对路径归属、总数/截断、最多256变化/冲突 |
| distribution:cancel | {previewRequestId} | cancelled布尔值；等待原任务结束，不表示撤销玩家文件 |

工具RPC超时15秒，不自动重开或取消；state可查询当前状态。没有主进程事件订阅：UI仅在可见在线标签每1500ms单飞轮询，卸载停止轮询并close。一个文档最多保留128个工具修改请求，同ID异输入REQUEST_CONFLICT；容量满仍允许close。在线view关闭后等待destroyed及专用session清理，失败隔离、不再创建新view。主窗口CSP和preload不向在线页面扩展。

分发sources超时3秒，preview/cancel超时45秒；超时不自动生成新请求。一个文档保留最多16个预览身份，同ID同输入恢复同结果，异输入拒绝；达到上限返回PREVIEW_LIMIT，需重新加载文档建立新观察生命周期。cancel只作用同文档拥有的ID。文档失效取消全部观察，应用退出等待读操作收尾。主进程从当前登记根及ready实例恢复目标目录/环境，渲染不能提供观察或收据作为权威输入。

默认站点/信任源为空，按用户明确留空要求返回空配置；能力存在不表示有可用站点或签名包。收据解析只影响只读分类，不产生执行许可。未新增包写入、迁移、安装或更新通道，未启用远程分发。
