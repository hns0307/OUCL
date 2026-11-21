# Mod 确认接纳与取消互锁

本页记录原批准安装流程的私有存储增量。尚未开放公共确认 IPC、按钮或自动执行器。

## 决定点

`mod-confirm:accept` 仅接受 `planRequestId` UUID、`planId` SHA256 和字面量 `confirmed:true`。主进程不能通过通用 `accept` worker 命令绕过该入口创建 `mod-install`。worker从固定installation读取owner，不接受调用方路径或owner。

首次接纳要求持久preview/ready计划、正确根、精确planId以及当前ready加载器实例的修订、MC和加载器一致。然后在既有SQLite事务内同时保存request和task。requestId固定复用计划UUID，payloadDigest固定绑定计划UUID、planId及确认值；重试返回原任务，即使任务已进入恢复状态，也不重新分配或执行。接纳不等于重新检查文件、游戏占用或安装成功，执行器仍必须调用准备与事务服务复验。

worker按消息顺序串行完成接纳或取消：取消先保存则确认失败CANCELLED；接纳先保存则取消失败CANCEL_TOO_LATE。ModPlanService保持该受控错误，不误报取消成功。已接纳任务的取消应走任务控制，不能再用取消计划入口承诺撤销提交。

## 恢复清单

`mod-confirm:list`仅列出当前根的mod-install接纳，返回计划UUID、精确确认digest和StoredTask。固定SQL最多读取1001行，超过1000受控停写/停读，绝不静默截断；新接纳达到1000返回QUEUE_FULL。重试现有接纳仍可恢复。worker逐项复核不可变计划证据；缺失、被取消或关联矛盾返回NEEDS_RECOVERY。没有新增SQL表、JSON索引或易丢失的双写目录。

现有任务恢复把在途任务标记needsRecovery，不能根据该清单自动重放下载或文件提交。后续执行器应结合mod-txn日志及唯一实例modCommitId完成恢复；没有事务证据时保持未知，不猜成功。

## 未完成

公共确认/任务快照与UI、关闭时等待执行器、Java实测事实和提交后状态恢复仍待实现。当前服务未在产品中产生mod-install任务。本次不更改旧EXE或声称完整Mod安装交付。
