# 固定计划的可信下载与真实JAR准备验证

日期：2026-10-28（Asia/Shanghai）。本次是原批准Mod安装方案的私有准备服务增量，未开放公共确认或安装按钮。

## 实际验证

`pnpm check`：480项，478 PASS、0 FAIL、2个既有系统能力SKIP；类型/lint/coverage/production build通过，core覆盖率行98.83%、分支96.84%、函数99.56%。首轮新增测试夹具的Buffer通用类型与Response类型不匹配，改为明确Uint8Array后完整检查通过，没有降低生产校验。

新增9项测试使用：真实StorageClient/SQLite/JSON提交、HashPool、ObjectStore、ArtifactTransfer、HttpTransfer及ModArchiveReader worker；JAR由测试生成，官方metadata和HTTP只由本地注入适配器提供，不调用公网。planner刷新输入在该局部测试中明确使用固定快照夹具，不能视为真实公网来源或完整产品安装。

- 实际将固定依赖字节写入可信对象仓库并重算摘要，实际读取并解析根/依赖JAR；预期本地与平台检查满足。JAR声明的library_mod版本1.2.3保留，不使用平台显示标签99.99.99；可选项目没有被请求。实例游戏目录和资源库清单均未被写入。
- 未确认、错误planId、已取消计划、旧修订或外来session锁在依赖下载前拒绝。
- 启用的精确依赖可复用改名文件、零依赖下载且不覆盖；禁用文件保留并不供给依赖。内嵌来源关系未明直接保留unknown，不重复下载。
- 不满足真实版本范围、重复modId、无法解释的要求及无客户端适用Mod均拒绝；私有错误保留双重检查证据。
- 同名/大小写别名冲突拒绝，原文件字节不变；刷新计划身份变化使原准备失效。
- 固定版本元数据SHA512变化在下载前拒绝；元数据与计划一致但实际下载SHA512矛盾在真实worker复验时拒绝，即使SHA1传输校验通过也不发布。
- 取消等待实际在途传输返回/清理，同一准备器拒绝并发请求；下载期间的计划取消、外部Mod变化和未知会话均在返回ready前阻止结果。外部新增测试文件保留原字节。

正式main入口使用`OUCL_SMOKE_OFFLINE=1`及独立profile运行`pnpm smoke`通过：36方法/15能力、renderer无Node、设置与四页界面保持。manifest明确为本地fixture，所有其他fetch请求在测试中拒绝；见`main/smoke.json`和截图，不标公网验收通过。

## 未完成范围

没有新增依赖、公开确认接口或持久确认格式；本服务尚未接main确认任务，也不改实例修订或mods目录。尚需持久任务/确认与取消互锁、实测Java事实、gameDir独占、全部文件哈希和修订再检查、一次提交/恢复。当前生产context不能提供精确Java版本时仍为unknown。没有重新打包EXE、启动真实Minecraft或操作用户游戏数据；完整四加载器与Mod目标继续进行。
