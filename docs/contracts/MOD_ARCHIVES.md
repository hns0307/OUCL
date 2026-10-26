# Mod JAR 读取边界

2026-10-26，已批准四加载器/Mod方案的内部worker增量；尚无mods.v1或玩家安装入口。

`ModArchiveReader`由主进程服务选择绝对文件，单owner最多一个活动扫描，不接受渲染路径、URL、脚本或任意条目选择器。worker限128MiB旧生代、30秒；取消和超时必须等待exit才释放占用。输入只读普通文件，拒绝文件/祖先链接，不把链接目标自动当成本地Mod。

输入ZIP最多64MiB、65,534条目；校验中央/本地记录、CRC、路径、重复项、非普通类型和重叠。逐包保留最多64MiB所选内容，跨整个嵌套树累计展开256MiB；最多64个归档、4层嵌套；声明单项1MiB、总文本4MiB、严格UTF-8。全部普通条目解压核验CRC；只保留fabric.mod.json、quilt.mod.json、META-INF/mods.toml、META-INF/neoforge.mods.toml、jarjar元数据及MANIFEST原文。所有内嵌.jar只作发现证据，后续必须核对加载器声明，不能直接计为已满足提供者。未知ZIP、损坏或超限返回受控错误，绝不表示兼容通过。

结果包括实际文件大小、SHA-1/SHA-256/SHA-512和每个归档SHA-256、嵌套条目链、声明原文。摘要只证明实际读取字节，不是上游可信来源；原文不发往渲染层。主进程重验worker回复形状、树关系、摘要格式和文本限额。此增量不解析modId、版本或依赖，不修改文件、不执行JAR，不引入依赖。

后续纯声明解析增量：Fabric/Quilt v1读取实际id、版本、别名、嵌套声明、client条件及必需/可选/冲突关系；Forge/NeoForge采用已批smol-toml读取多Mod、语言加载器、各Mod依赖、Java要求和side。标准TOML中的注释/多行语法交由解析器处理。版本变量保留null及UNKNOWN_VERSION；未知schema、Quilt unless/组限定/依赖备选/插件、未知features与排序均显式报告，不模拟完整加载器或推断兼容。该纯解析增量尚未接入worker输出或UI。单文档1MiB、单文件最多256个Mod、每Mod256条依赖、条件树16层/256节点；后续检查应同时限制全实例规模。完整pnpm check337项/335通过/0失败/2原有跳过；核心覆盖99.39%行/96.73%分支/99.47%函数。

四类声明依据[Fabric规范](https://wiki.fabricmc.net/documentation:fabric_mod_json_spec)、[Quilt规范](https://github.com/QuiltMC/rfcs/blob/main/specification/0002-quilt.mod.json.md)、[Forge1.20.1文档](https://docs.minecraftforge.net/en/1.20.1/gettingstarted/modfiles/)、[NeoForge1.21.1文档](https://docs.neoforged.net/docs/1.21.1/gettingstarted/modfiles/)。只提取事实设计，未复制源码或第三方夹具。

范围语义复核修正：Fabric的caret即使在0.x也按主版本边界，tilde按主次版本保留，排除下一系列的预发布；不使用npm的0.x特殊规则。Fabric空格AND、数组OR；Quilt使用数组OR或any/all对象，单个版本表达式不擅自解释成多条件。`||`、`&&`与拆开的运算符作为不支持语法返回unknown。依据[Fabric规范](https://wiki.fabricmc.net/documentation:fabric_mod_json_spec)、[固定0.16.14运算符](https://github.com/FabricMC/fabric-loader/blob/0.16.14/src/main/java/net/fabricmc/loader/api/metadata/version/VersionComparisonOperator.java)及[Quilt规范](https://github.com/QuiltMC/rfcs/blob/main/specification/0002-quilt.mod.json.md)独立修正，不复制代码。完整检查330项/328通过/0失败/2原有跳过。

验证：完整`pnpm check`329项/327通过/0失败/2原有环境跳过，类型、lint及构建通过。新增测试覆盖四类声明、嵌套树/摘要、CRC损坏、非法路径、重复项、非UTF8、无声明、目录/缺文件、条目/展开/深度/数量限制、伪造回复、并发拒绝、取消、超时、崩溃及空回复。生产构建worker读取本轮独立测试根的NeoForge21.1.265官方共享对象成功：3,559,126字节、SHA-256 `c12cf1a6cb0aa7792b13174b06088a4f54d8bcc92f6a32fcb03310b456936847`，识别NeoForge TOML、jarjar声明与两个内嵌JAR；先对链接视图扫描返回UNSAFE_ARCHIVE符合边界，测试显式选择受管真实对象后成功。
