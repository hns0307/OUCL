# Modrinth 精确文件来源

2026-10-26，四加载器/Mod方案的内部来源适配增量；尚未公开Mod安装接口。

`ModrinthModClient`只构造官方api.modrinth.com/v2端点，使用真实SHA-512批量查询具体文件版本，不通过搜索、文件名或modId猜项目。一次最多64个不同哈希，缺失命中保留缺失；响应不得添加未查询哈希，具体版本必须含匹配文件。保留项目ID、版本ID、发布类型/时间、加载器、MC环境、文件大小/SHA-1/SHA-512与完整API响应SHA-256证据。文件URL只接受Modrinth官方CDN及相同项目命名空间，未知/错误元数据明确拒绝。

依赖保留project_id、version_id与类型（required/optional/incompatible/embedded）；固定版本不退化成项目最新版本。只有filename或空身份不转换成搜索结果。项目候选最多512项，按稳定release优先、发布时间降序、版本ID升序确定顺序；超限停止，不默默截断后声称无候选。排序不是安装决策，下载后仍需真实声明复验，也不升级现有Mod或加载器。

网络并发4、单请求12秒、响应8MiB、严格UTF-8/JSON、禁止重定向/凭据；取消保持取消，429遵循有界冷却，错误不含上游原文。接口目前只读平台元数据，byHashes的POST只发送明确批准的文件摘要，不上传文件、路径或玩家数据。主进程/worker边界和JAR限制另见MOD_ARCHIVES.md。

依据Modrinth官方[哈希查询](https://docs.modrinth.com/api/operations/versionsfromhashes/)、[具体版本](https://docs.modrinth.com/api/operations/getversion/)、[项目版本](https://docs.modrinth.com/api/operations/getprojectversions/)独立实现，无新依赖。354项完整检查352通过/0失败/2原有跳过；测试覆盖真实哈希请求形状、固定前置、候选顺序、项目/哈希漂移、危险URL、损坏证明、速率/并发/体积/取消。

真实候选验证：官方FerriteCore项目uXXizFIs（project/ferrite-core元数据声明MIT许可）。Forge/MC1.20.1候选DG5Fn9Sz为6.0.1，123034字节，SHA-1 417fb6ce8f52abf40bd9d0390371790f9576f8ba；NeoForge/MC1.21.1候选x7kQWVju为7.0.3-neoforge，121559字节，SHA-1 9563692efb708b6b568df27a01ec52f6311928ef。两者平台required前置为空，仅作为独立加载器测试候选，尚非实际游戏加载通过。平台与本地声明合并、冲突判定、递归计划与确认事务仍待继续。

双重检查增量：纯`checkPlatformMods`将实际SHA-512、SHA-1、大小、目标MC/加载器及客户端适用性同平台具体版本对比，冲突附项目/版本及前置身份。平台版本号不替代真实mod版本。禁用文件不满足平台前置；同项目重复版本明确报错，固定version_id不退化为同项目任意版本。未命中来源、Quilt未获平台声明的Fabric兼容组合、未解析内嵌项目和仅文件名身份保留未知。存在未识别本地/内嵌内容时，不断言必定缺少项目并重复自动下载。360项完整检查358通过/0失败/2原有跳过；此增量不创建安装计划、不写文件，尚无公开Mod IPC/UI。

后续真实游戏已完成FerriteCore在独立Forge与NeoForge实例各两次Mods菜单观察与退出0，证据见LOADERS-0.3.0/REPORT.md；不把该测试夹具供应当作玩家确认事务完成。

主进程双重检查编排：`ModInspectionService`先读实际库存，按64哈希分批向官方平台查具体版本，再次完整读取库存并比较指纹及环境修订。网络期间文件变化立即使结果失效；平台失败明确附代码和未知，不抹除本地报告；取消/并发受控，结果不授权写入。364项完整检查362通过/0失败/2原有跳过。本轮独立Forge及NeoForge实例的FerriteCore实际SHA-512均成功关联uXXizFIs/DG5Fn9Sz及uXXizFIs/x7kQWVju，无平台请求失败；此时语言加载器尚未测量，local及combined均如实为unknown（LANGUAGE_REQUIREMENT）。复现入口official-mod-inventory.ts加OUCL_MOD_TEST_PLATFORM=1，仅测试根可用。

语言证据补齐：限定已验证代表系列，Forge1.20.1/47.x从官方javafmllanguage/lowcodelanguage精确路径识别其主版本47（符合Forge文档定义）；NeoForge1.21.1/21.1.x从独立官方fancymodloader/loader/4.0.x精确路径取得完整FML版本，不从NeoForge21.1.x或MANIFEST4.0猜测。每次入上下文前在worker中重新读取共享实际对象，强制SHA-1=官方库规格、SHA-256=受管对象、大小一致。未知系列/组件保持未知，错误对象停止检查。实际debug.log分别报告javafml/lowcodefml=47及4.0.45，证明与本次对象映射一致；来源依据[Forge语言版本定义](https://docs.minecraftforge.net/en/1.20.1/gettingstarted/modfiles/)和本轮官方组件/运行证据，不执行额外Java代码来探测语言版本。

随后同一两个实际FerriteCore文件再次完整双重检查：Forge/DG5Fn9Sz、NeoForge/x7kQWVju的local=satisfied、combined=satisfied、localIssues=[]、platformFailures=[]，源版本均matched。检查通过仅代表这些已知声明满足，不扩大真实游戏或其他组合承诺。完整366项364通过/0失败/2原有跳过，核心99.02%行/96.98%分支/99.54%函数；日志.test-build/mod-runtime-evidence-check.log。
