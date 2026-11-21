# 已下载 Mod 的真实来源前置

2026-10-27，G2原方案范围，私有ModLibraryReader；无新依赖/公共接口/存储格式。

完整pnpm check433项431通过/0失败/2原有环境跳过，类型/lint/build通过，check.log。5项新增测试覆盖真实JAR声明而非平台版本号、实际文件/平台摘要冲突、观察期间源记录/文件变化、不完整下载/错误对象归属/身份替换、受控取消/并发及字节不变。

用户要求跳过联网测试前，独立新根中的真实ResourceService下载与Reader复验已结束：rootId7a880384-9fdb-4800-bf92-8407425e7469，官方FerriteCore项目uXXizFIs，版本unerR5MN、DG5Fn9Sz、x7kQWVju，真实声明分别Fabric6.0.1、Forge6.0.1、NeoForge7.0.3；与平台Neo7.0.3-neoforge保持区别。资源对象SHA1/SHA256/SHA512/大小/精确身份均通过，实例写入为false，结果official-library.jsonl。首轮资源NETWORK_FAILED保存first-failure.log；之后同固定官方CDN只读探测200，有限重试成功，不推断第一次失败原因，不放宽校验。

后续遵用户新指令不再外网复测，优先四加载器接入。本组件只读来源前置，没有公开计划/确认、依赖下载或安装事务，不标Mod安装/0.3.0完成，不操作用户游戏。
