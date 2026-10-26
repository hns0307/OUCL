# Modrinth 精确文件来源

2026-10-26，四加载器/Mod方案的内部来源适配增量；尚未公开Mod安装接口。

`ModrinthModClient`只构造官方api.modrinth.com/v2端点，使用真实SHA-512批量查询具体文件版本，不通过搜索、文件名或modId猜项目。一次最多64个不同哈希，缺失命中保留缺失；响应不得添加未查询哈希，具体版本必须含匹配文件。保留项目ID、版本ID、发布类型/时间、加载器、MC环境、文件大小/SHA-1/SHA-512与完整API响应SHA-256证据。文件URL只接受Modrinth官方CDN及相同项目命名空间，未知/错误元数据明确拒绝。

依赖保留project_id、version_id与类型（required/optional/incompatible/embedded）；固定版本不退化成项目最新版本。只有filename或空身份不转换成搜索结果。项目候选最多512项，按稳定release优先、发布时间降序、版本ID升序确定顺序；超限停止，不默默截断后声称无候选。排序不是安装决策，下载后仍需真实声明复验，也不升级现有Mod或加载器。

网络并发4、单请求12秒、响应8MiB、严格UTF-8/JSON、禁止重定向/凭据；取消保持取消，429遵循有界冷却，错误不含上游原文。接口目前只读平台元数据，byHashes的POST只发送明确批准的文件摘要，不上传文件、路径或玩家数据。主进程/worker边界和JAR限制另见MOD_ARCHIVES.md。

依据Modrinth官方[哈希查询](https://docs.modrinth.com/api/operations/versionsfromhashes/)、[具体版本](https://docs.modrinth.com/api/operations/getversion/)、[项目版本](https://docs.modrinth.com/api/operations/getprojectversions/)独立实现，无新依赖。354项完整检查352通过/0失败/2原有跳过；测试覆盖真实哈希请求形状、固定前置、候选顺序、项目/哈希漂移、危险URL、损坏证明、速率/并发/体积/取消。

真实候选验证：官方FerriteCore项目uXXizFIs（project/ferrite-core元数据声明MIT许可）。Forge/MC1.20.1候选DG5Fn9Sz为6.0.1，123034字节，SHA-1 417fb6ce8f52abf40bd9d0390371790f9576f8ba；NeoForge/MC1.21.1候选x7kQWVju为7.0.3-neoforge，121559字节，SHA-1 9563692efb708b6b568df27a01ec52f6311928ef。两者平台required前置为空，仅作为独立加载器测试候选，尚非实际游戏加载通过。平台与本地声明合并、冲突判定、递归计划与确认事务仍待继续。
