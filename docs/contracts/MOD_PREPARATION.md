# 确认计划的可信下载准备

2026-10-28。原批准Mod安装方案的私有服务增量；尚未开放公共确认接口或安装按钮。

`ModInstallPreparation.prepare`只接受exact的planRequestId UUID、planId SHA256和confirmed=true，以及由未来任务编排器提供的受控consumer UUID/AbortSignal。重新读取既有固定计划记录，检查preview/ready状态、当前注册根、目标实例/修订/MC/加载器及无活动/未知会话、无外来session锁；重新生成当前计划并核对planId，双重检查当前库存指纹。未来公共确认入口必须先持久接受任务，再调用此服务，不允许renderer传下载URL、对象位置或目标目录。

根Mod由真实`ModLibraryReader`复验；依赖只按计划中的固定versionId查询官方版本元数据，精确核对project/version/filename/SHA1/SHA512/大小，下载地址必须是该项目的受控Modrinth CDN路径。复用现有transferResource、摘要信任根、权威传输记录和可信对象仓库；不经搜索关联modId，不替换版本，不选择可选依赖。每个下载返回的对象需匹配sourceKey和大小，再经有界JAR worker核对三摘要/大小与真实声明。根或依赖中的多Mod、别名及嵌套事实沿用统一投影；内嵌项目来源关系尚未证实时直接保留未知，不重复下载。

在内存中构造预期安装结果，以现有各加载器严格规则执行真实声明与平台双重检查。启用的已有依赖必须精确复用；改名但摘要相同的已安装JAR保持原名，禁用文件不供给依赖。同名/大小写别名冲突拒绝；未知Java/版本条件、重复modId、缺失/不满足范围、平台矛盾、客户端无适用Mod都不会得到ready结果。

限制：单个活动准备、最多256库存加新增文件、累计8MiB事实、沿用计划256项目/扫描worker嵌套与解压上限。按计划逐文件准备，物理下载复用既有有界传输。取消将信号传递给metadata/传输/worker，并等待当前工作退出。准备结束前重新读取计划取消状态、整个已安装库存指纹、环境/修订、注册根、对象文件身份与会话锁。

返回值是私有的对象引用、原始可信spec、真实JAR事实、检查证据及观察指纹。它不包含发布承诺，不写mods目录、不登记资源库、不改实例修订。下载缓存作为恢复材料保留。未来事务提交仍必须独占gameDir并重新核对所有实际哈希和外部变化；准备结果不能替代提交前检查。生产context当前不能测定Java精确版本时继续保持null/unknown，后续应接实测Java事实，不按MC/加载器版本猜测。

增加受控错误CONFIRMATION_REQUIRED、INSTANCE_BUSY、MODS_INCOMPATIBLE、MODS_UNDETERMINED。后两者可在私有错误中携带本地/平台检查证据，未来任务层须使用公开报告投影，不能直接把私有source URL/原文返回renderer。

验证见[MOD-PREPARATION-20261028](../validation/MOD-PREPARATION-20261028/REPORT.md)。仍待公共确认任务、持久确认记录、一次实例提交/恢复和最终产品/EXE验证。

后续2026-10-28已有私有[新增事务与恢复服务](MOD_TRANSACTION.md)，可对准备结果执行真实文件发布和唯一JSON提交点；尚未接公共确认任务，产品安装按钮继续不开放。
