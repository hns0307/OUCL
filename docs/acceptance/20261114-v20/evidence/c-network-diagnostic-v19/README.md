# 单轮网络诊断准备（非取消验收）

2026-11-14。已核对TASK_PLAN/DECISIONS及v18 HANDOFF/REPORT；额度五小时used8%、剩92%。固定v3七产物、已关闭v4-bc合成profile。只新增本目录，不改旧c-cancel-v15、产品、时钟、依赖或契约；未启动GUI。

主协调唯一GUI启动：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\c-network-diagnostic-v19\window.cjs'
```

选A，点一次alpha-provider预览，等自然completed后正常关闭。不要点取消或自动再试。所有网络立即callback(cancel:true)，绝不hold closed对象/放行外网/伪造HTTP。后台结果由原服务决定，本轮不验证运行取消或12秒timeout。

壳逐SHA核对七产物。透明net.request包装记录request编号、finish/close/error/abort及原abort调用。error只取受限code、ERR_固定token和白名单类别，不输出原message/stack/请求体。onBeforeRequest记录details.id、固定endpoint/method、旧hold guard全部布尔值、首对象/最新对象状态；callback严格一次并分别记录调用和返回。保留closed guard，只计算wouldHold，不实际hold。

request与interception仅按创建顺序提供候选，明确不冒充可靠Chromium ID映射。若错误只是ERR_FAILED/blocked且close仍在callback之前，不足以确定first early-close根因：保持UNKNOWN，停止这一轮，不自动重放、不删除closed guard凑pending。明确code也只说明该事件的错误，不自动证明此前close由后来callback造成。

关闭后只读提取：

```powershell
node D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/c-network-diagnostic-v19/verify-result.cjs
```

只输出有限JSON，不写文件。DIAGNOSTIC_CAPTURED只表示目标回调/一次性取消/正常退出证据已取到，不表示原因已查明，更不是cancel PASS。缺日志为PENDING。window.jsonl存在时拒绝覆盖。前后六JAR/五任务和owner释放仍由主协调既有只读工具确认。

准备时只做node --check，不运行窗口/核验器；具体结果待主协调一次真实操作。其它C-R3/R4场景本轮不扩展。
