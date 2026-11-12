# OUCL 增量报告 v8：选定功能本地整合

选定增量已合入本地main，未push/发布。完整历史原方案仍有待补证项，不能标为全部验收完成。

## 实际结果

- 代码候选`bc01f07487ca7e8d76f17115ea148efcafd748c2`；独立验收文档提交`1b06f6bcb0b7ec53265e6887dd4541726539bd9b`，117个文档/证据文件。
- `D:/MC_start/OUCL-download-main`在确认main、干净b87be9d基线后执行`git merge --ff-only codex/acceptance-20261111`成功。源码/测试/构建及依赖文件与bc01f07无差异，main工作树干净。
- 活跃`D:/MC_start/OUCL`的mod_loaders仍为b87be9d，原交织改动保持，没有整体暂存、提交、切换、强制对齐或清理。隔离Git树未跟踪历史P-A/tools继续保留且不进入提交。
- 新增v4–v7证据关闭Git换行转换，保证其SHA256可在检出后复核。117项隔离索引与实际文档逐文件匹配，无实质差异；少量历史文本仅CRLF→LF，见[索引检查](evidence/index-content-check.json)。原始失败记录未删除。
- 最终EXE已另复制到[main交付目录](D:/MC_start/OUCL-download-main/release/OUCL-0.3.0-acceptance-20261112-v3.exe)，405,504字节，SHA256 `c231342a5e6027b63675d743ce7b7d88e9071c49cd7c07b060980ac52991a009`，与已实测原件一致；旧交付物保留。

## 本阶段验证

v6完成正式安装四任务的真实生产壳首次/重开；B补证完成双域各1000有效计划真实worker/重开和公共20页及1001拒绝，合法DTO字节防御阈值不可达性有上界证明。v7完成同一最终EXE真实运行时冷下载、固定样本/取消/不匹配及正常热重开，两个产品进程exit0。完整v3回归仍为651项/647PASS/0FAIL/4SKIP及既有专用检查，不重复写为本轮重跑。

精确选择及全部边界见[v7合并清单](../20261112-v7/MERGE-CHECKLIST.md)，历史方案/批准记录已追加本次核对，不覆盖旧失败。新代码/契约/依赖/存储格式没有超出已批准范围。

## A中断验证的实际阻塞

为补A代表性真实产品中断恢复，本轮新建`v6-package/crash-case`，仅复制最终EXE和已核对Electron运行时，无app/profile/游戏或玩家数据。通过最终EXE首次启动，由GUI创建专属离线档案，准备完成，任务/请求0、游戏目录为空；只读核对产品PID34312来自该引导器35760，记录新格式owner及guard文件身份。

随后CUA `kill_app(pid:34312)`返回 **“standard mode may terminate only a process proven to have been launched by this Cua runtime”**，未发生终止。没有改用shell、间接进程或权限设置绕过。文件名`crash-after-kill.json`仅指调用尝试后的采样，**不是成功kill/崩溃物证**。本轮没有强制中断或恢复通过。

测试窗口随后用正常Alt+F4关闭，owner.lock释放；档案、根记录、表行摘要保持。[调用前](evidence/crash-before.json)、[被拒后](evidence/crash-after-kill.json)、[正常关闭后](evidence/crash-normally-closed.json)及[截图](evidence/crash-before.png)只支持上述事实。该阻塞与原A聊天遇到的派生进程驱动限制一致，A产品强制中断验收继续DEFERRED，不能通过重复同类调用关闭。

## 后续

已选功能可在main独立审阅和体验。A真实强制中断恢复需安全的、具备目标归属证明的受支持操作路径；C/E部分真实计时/回调组合仍按清单保留。Quilt索引及隐藏依赖双摘要属于原A后继批准增量，排除本候选，旧失败现场保留。当前不把这些未覆盖项当成缺陷或通过，也不以无变化重跑完整检查代替它们。
