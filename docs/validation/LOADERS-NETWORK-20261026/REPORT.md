# Fabric/Quilt官方网络诊断（2026-10-26）

恢复原四加载器/Mod计划，使用已有固定官方元数据与Maven校验，不改变信任边界。probe-concurrency4.json表明Fabric官方profile和8库证明全部可读，Quilt官方profile可读，但Maven部分HEAD/sha1连接超时；随后单并发probe.json中Fabric再次通过，而Quilt profile发生UND_ERR_CONNECT_TIMEOUT，不能归因为确定解析错误或声称调整并发已修好。

新独立测试根official-loader-1bwU65，只复制本轮main下载回归根的不可变objects并重建索引，绝不读取用户游戏数据。实际安装trace精确捕获meta.fabricmc.net官方profile连接超时，Mojang版本/资产清单均200，因此此前CATALOG_UNAVAILABLE有本次可证的具体来源。旧失败不一概归因相同。

修复仅针对后台Fabric/Quilt profile读取：CATALOG_UNAVAILABLE最多3次，每次沿用12秒reader限制；不可信/坏JSON/非法身份不重试，任务取消后不再开始下一次。当前在途读取仍按既有reader超时收尾，不宣称瞬时取消。目录catalog行为不变，无新IPC/依赖/磁盘格式。

409项407PASS/0FAIL/2原有SKIP，类型/lint/build通过；新增4项测试验证暂时失败成功、坏数据不重试、预算恰3次、取消阻止后续请求。测试入口新增可选公开host/path固定错误码trace，未写生产原始日志；新增测试源选项official/bmclapi，不能接受任意URL。

修复后实际官方安装已进入downloading，但asm-commons官方GET连接超时，任务未完成、缓存保留。再次选已批准BMCLAPI加速（官方profile/摘要仍是信任根）后，已下载校验739685297字节并进入materializing，最终ready/启动待证据；不能提前标Fabric或Quilt游戏矩阵通过。

## Fabric实际安装完成与实机未通过（最终状态）

本轮新根official-loader-1bwU65，Fabric0.16.14/MC1.20.1已实际完成739685297字节可信下载、物化、ready提交及prepareLaunch复验，实例1971f881-fa70-5385-9eb2-55a6b862a0cf；选BMCLAPI仅加速字节，profile/sidecar/摘要仍为官方，证据fabric-install-completed.log。FerriteCore官方固定unerR5MN（平台声明fabric/quilt、required为空）实际125197字节，SHA512及真实fabric.mod.json再次核验，测试夹具已供应，见fabric-test-mod.jsonl。测试供应不是产品确认安装事务。

测试入口误加不存在的ModArchiveReader.close导致一次清理失败；已删除错误调用。该reader每次read已join worker退出，没有close接口。失败/随后STORE_BUSY均保留；已确认自有测试进程退出后，只对本轮根的精确owner350d4c06-aeb3-4874-a8c1-1a0d65d4efc6及objects.owner f2df0a2b-14d5-4273-bf77-d5f2d5ea9e47改名保留恢复材料，不改生产外来锁规则、不删用户数据。

实际运行日志确认Loading Minecraft 1.20.1 with Fabric Loader 0.16.14、Loading 5 mods、ferritecore6.0.1。Computer Use观察到首次欢迎/继续界面，但后续核实主菜单时用户按物理Esc停止；立即停止所有窗口操作，没有继续输入或强杀。随后既有监督器日志显示自然close且exitCode4294967295，最终GAME_EXIT_NONZERO。原因未定位，不推断为Esc造成，不标菜单/正常退出/重开矩阵通过。监督器最终退出1并正常关闭其存储/对象拥有者，不存在待强制结束的本轮游戏。

用户停止界面自动化后本轮保存交接；Quilt仍无真实安装/运行通过。后续需在用户允许重新操作窗口时复验Fabric退出异常，再补Quilt，不把本轮部分证据改成四加载器或0.3.0交付。
