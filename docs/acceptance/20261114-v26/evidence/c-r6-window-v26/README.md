# C-R6 真实窗口展示准备（批准的测试传输替身）

2026-11-14。五小时开始used20%、剩80%。只在本目录新增文件、运行本地prepare/局部检查；未启动Electron窗口，不改冻结产品、依赖、契约或旧profile。主协调唯一操作GUI。

## 实际准备

prepare.mjs从既有v5-global正式安装脚本生成本目录独立prepare-generated.mjs，加入正式Fabric LoaderInstallMetadataService和精确本地loader字节。两个实例均由InstallerService.createLoader真实接纳/物化/收据/ready提交，不补假安装任务。原Mod服务/StorageClient/SQLite/worker生成各自真实报告；关闭重开后正式adapter全局返回2 install+2 mod-check、均completed。准备日志preparation.log，身份及完整报告seed.json。七个产物直接复制并与既有manifest逐SHA一致。

v16 JAR虽未以二进制归档，fixtures.cjs按原modZip/声明重建，并逐sha1/sha256/sha512断言与v16 attempt2 evidence.manifest相同。原两份合法synthetic-response.json原样语义复制。本地fixtures与请求体SHA白名单在fixtures/和whitelist.json；不改v16物证。A嵌套多声明，B精确平台版本不符，只有这两格，不扩大矩阵。

测试传输是明确批准的替身：EventEmitter request / PassThrough response只实现原createDesktopFetch使用的setHeader/write/end/abort及事件；精确URL=https://api.modrinth.com/v2/version_files、method=POST、完整body SHA256在白名单中才返回原v16合成status/body。任何其它请求立即error拒绝，没有调用真实net.request/fetch或公网。原desktop-fetch、Modrinth解析、库存/JAR worker、preview、IPC/preload/React全部保持。matched显示只是该合成事实链成立，不称真实HTTP/公网/Mod兼容。

`node .../prepare.mjs`退出0；`node .../local-check.cjs`验证两个精确请求匹配、坏body及其它endpoint拒绝，生产desktop-fetch/Modrinth client正式解析通过。输出local-check.json/log。仅本地准备/传输局部PASS，窗口展示尚待验。

## 窗口启动参数

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\c-r6-window-v26\window.cjs'
```

新profile位于本目录/profile，不用旧v4 profile；游戏根synthetic-games。客户端和loader都是不可执行合成字节，**不要启动游戏**。

- A名称R6-A Synthetic Fabric，ID `44ba3306-fa96-52be-bff2-f3ad43e96e75`；原报告satisfied，两文件matched。点provider.jar预览：parent_mod、parent_alias及nested_mod应作为同一物理JAR受影响，nested深度不暴露META-INF/private-child.jar；依赖dependent.jar，本地nested_mod/parent_alias关系与平台ProvPr01/ProvVr01分别显示，after缺依赖、blocked。
- B名称R6-B Synthetic Fabric，ID `4b3c676a-ca84-5767-afa5-e5a402819b0a`；本地satisfied，但精确平台pin要求ProvVr02，实际provider ProvVr01，报告unsatisfied。点provider.jar预览：before PLATFORM_PIN_MISMATCH应保留，不能因本地ID/摘要正确就判平台满足；平台关系不能错连ProvVr02，blocked。

各点击一次，等原status completed和实际DOM；保存截图和window.jsonl中公开preview+DOM、synthetic-transport精确body匹配记录。正常关窗exit0，核对自有新profile的JAR摘要/任务不变。壳不自动点击/查询/接纳。window.jsonl存在拒绝覆盖。

当前UI providers只展示声明id/owner/version，没有专门显示provider.embeddedDepth；issues若有嵌套深度会显示。需如实记录哪些信息UI实际展示，不能把公开payload里的depth冒充已显示在页面，也不在本轮热修UI。

若Electron对net.request工厂赋值或Readable响应兼容有问题，保留原错误/未完成，不替换domain或放公网。固定七产物不变和原解析链保持不意味着传输是真实HTTP。最终GUI结论由主协调窗口证据决定。

## 只读状态对照

inspect-state.mjs沿用v4-bc检查器，由本目录seed.json定位本次profile和游戏根，以SQLite readOnly连接读取任务，递归记录JAR文件名、长度和SHA256；只写本目录state-<label>.json。已运行 `node acceptance-results/c-r6-window-v26/inspect-state.mjs before`，退出0，state-before.json共6个JAR（含正式物化client/loader）、4条任务。主协调自然关窗后可运行同一命令将before替换为after，并比较hashes/tasks；不要重跑覆盖before。
