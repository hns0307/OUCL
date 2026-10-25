# 启动界面与任务/会话整合

`pnpm check`退出0：248测试246 PASS/0 FAIL/2原有环境SKIP，类型/lint/build通过，见[check.log](check.log)。新增两个实际StorageClient/ObjectStore/文件安装→启动任务整合，进程明确为替身：一个store拥有者、幂等/改变payload拒绝、现有订阅传送launch终态、自然close与session退出码、正常重开历史、取消太晚、强停确认/等待close及同请求不重复kill。新增4组游戏契约/任务kind结果/私有session校验。

初次整合测试暴露Windows临时目录短路径与canonical投影目标比较不一致，导致两流程needsRecovery；现通过guardDirectory规范化两者，局部15测试与完整检查复核通过。原kind:launch负例继续通过，因为launch不得使用downloading阶段，未删除安全断言。

`pnpm smoke`正式Electron窗口通过九能力/18方法白名单、真实DOM离线档案与官方目录，renderer无Node/contextIsolation/sandbox保持，见[smoke.json](smoke.json)。未实操系统Java或目录选择器，不宣称native E2E。

`node scripts/install-window.mjs <可信已有Java17>`使用正式main/preload/React，实际点击安装两次（首批4制品、次批0新增），再DOM点击启动。Java明确预登记并实际探测；fixture JAR/DLL是非可执行字节，真实JVM缺少Main类按预期退出1，UI观察exited，正常app退出/临时数据清理通过。见[installer-window.json](installer-window.json)。**这是实际进程/退出UI接线验证，不是MC菜单成功**；报告gameLaunched=false、fixture=true。既有官方1.20.1源服务菜单证据另存，新的exe默认入口真实下载/启动、世界、退出/重启仍待验证。
