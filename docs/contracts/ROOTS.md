# 阶段1A受控目录入口 v1

2026-10-24。按已批准提案§7实现roots:list/roots:choose，不新增通道语义或接受渲染路径。handshake协商major=1，能力白名单增加roots.v1；只有存储服务成功初始化时才声明。旧空能力数组仍有效，未知能力拒绝。

两个通道共用exact请求`{contractVersion:1,requestId:UUID,payload:{}}`；额外字段、路径及无效UUID拒绝。响应共用requestId/contractVersion/ok/data或固定AppError，无堆栈/本地路径。

| 通道 | 成功data | 等待 / 取消 / 重试 |
| --- | --- | --- |
| roots:list | `{items:[{rootId:UUID,label,available:boolean}]}`，最多100、ID不重复 | 3s，只读，无任务/订阅 |
| roots:choose | `{selection:cancelled}`或`{selection:chosen,rootId:UUID,label}` | 原生选择器120s，用户可取消；超时结果未知，同一requestId重试 |

label仅允许本地化“游戏目录 <编号>”，不回传用户名称/盘符/路径。领域错误为disk.ROOT_UNAVAILABLE、permission.ROOT_OUT_OF_SCOPE、permission.PERMISSION_DENIED，分别对应受控messageKey；通用INVALID_ARGUMENT/UNSUPPORTED_CONTRACT/INVALID_SENDER/TIMEOUT/UNAVAILABLE沿用原映射。拒绝注入未知错误/敏感details。

首次选择固定OUCL数据目录，后续根/共享store布局仍按STORAGE_LAYOUT。服务只登记位置，不导入现有启动器/创建游戏实例/移动玩家文件。检查本地规范路径、各级链接、应用/源码/userData及其上级/子级范围；对选定目录做随机排他写探针，结束即移除。渲染端只能触发native picker，不能自行传目录。

登记保存为现有RecordStore的installation.json（原schemaVersion=1/revision/data envelope），data exact为`{rootId:UUID,dataDirectory:主进程规范本地路径}`。只允许一次create，迁移和覆盖不开放。私有worker仅增加installation:get/set固定schema，不是通用JSON接口。操作通过已有SQLite日志与JSON提交点，重启稳定rootId；记录不存在才允许选择，已有位置返回原登记。断开的磁盘保留记录且available=false，不静默换盘。

同时请求共享一个原生选择Promise，关闭窗口后复核sender，不提交来自已失效文档的选择；重复/超时请求恢复原登记，不重复创建根。当前首个固定数据目录对应一个游戏根；多个游戏根的管理及数据迁移未在本增量开放。原生选择器自身没有任务订阅，取消选择不写登记。

main每次校验当前webContents、mainFrame和完整应用file URL；preload只暴露handshake/listRoots/chooseRoot三个方法，无通用invoke。主进程显式装配StorageClient/RootService，正常退出先关闭worker释放本人lease。单实例锁保护同一应用profile；异常进程遗留owner仍按既有安全停写策略，不自动清除。

验证见A1-04d报告。Native dialog实际用户操作尚未自动化，服务测试用注入的选择回调，不将它冒充真实系统选择器操作成功。游戏下载与启动能力未声明。

2026-10-28便携修订：小EXE默认向Electron传入同级`OUCL.runtime/profile`作为userData，显式隔离测试参数仍优先。引导同时提供EXE目录，主进程无既有登记时自动创建同级`OUCL.games`。在便携模式下`roots:choose`成为该固定位置的重试入口，无须原生选择；开发/直接Electron入口继续兼容原生选择。默认创建失败返回固定根错误且允许重试，不中止目录、设置、实例等其他服务初始化。旧全局profile与其中占用标记不自动接管或删除；同一profile已有根仍保持原登记。公开schema不变。真实EXE自动建立、重开及失败重试证据见`../validation/PORTABLE-ROOTS-20261028/REPORT.md`。
