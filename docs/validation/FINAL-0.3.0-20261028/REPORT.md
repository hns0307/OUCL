# OUCL 0.3.0 最终整合与验证

日期：2026-10-28。状态：**增量整合与EXE交付完成；完整实机矩阵待验收**。

## 构建与范围

基线 b551864 已包含全部既有0.3增量，main/mod_loaders原已相同，不制造重复合并。保留四加载器、Mod确认/持久任务/事务恢复、便携游戏根及目录入口、下载源设置、桌面定制和本地论坛草稿。DistributionSource仅契约/测试适配器，无后台或实际签名源启用。版本0.3.0，无产品代码、业务接口、依赖或存储格式改动。

交付：release/OUCL-0.3.0-final.exe，363008字节（354.5 KiB）。SHA256：3a63f5d7aaff7a7b7d5f3560b9925d75158310bcba76943f1d683a703686ec80

运行时代码来自b551864；验证改动5270bd2及后续可复现运行器提交。包appHash fffb66f9702d4764fd67f0858076f8374a4cda4091052d1a4d3ac7c4877e6d8e。最终构建前后appHash相同，但EXE包含构建时间而摘要不同，最初候选保留为OUCL-0.3.0-final-initial.exe。最终摘要以BOOTSTRAP-0.3.0-final/package.json与cold-final/package.json为准。

## 本轮通过

| 验证 | 结果及证据 |
| --- | --- |
| pnpm check | 517项，515 PASS / 0 FAIL / 2既有SKIP；typecheck/lint/build通过。check-final.log；core行98.88%、分支96.53%、函数99.58% |
| pnpm test:bootstrap | 26项PASS，bootstrap.log |
| pnpm audit:licenses | 128包，无待审许可，licenses.log/json |
| pnpm audit --json | 全部级别0漏洞，audit-network.json |
| 正式Electron worker | 30/30 PASS，包括真实文件/SQLite、准备/一次事务、取消、丢失应答、重开与进程中断；worker-final.log |
| 桌面交互与重开 | 两轮PASS；侧栏、配色、图标、内存保存、拖动、论坛草稿、窄窗；interaction目录 |
| 公共Mod确认UI | PASS：显式确认、未知阻止提交、取消、同任务恢复。mod-ui目录；准备阶段是明确失败夹具，不算公网产品安装成功 |
| 四加载器选择 | PASS：当前main/preload、旧响应隔离和窄窗；loaders目录，为本地元数据夹具 |
| 最终EXE冷/热启动 | 官方Electron官方下载校验，中文空格目录，冷40.1秒、热约1秒；cold-final目录、cold-final.log/warm-final.log；44方法/16能力、无Node、owner释放 |
| 最终EXE便携三场景 | PASS：自动同级OUCL.games/profile、重开根身份稳定、阻塞文件保留及移除后重试；portable-final-fixed/smoke.json |

两个原有SKIP：Windows无文件软链接权限；Windows拒绝改名打开的SQLite文件。没有修改系统权限；对应其他确定性覆盖仍运行。

## 本轮真实游戏观察

全部为历史独立验证实例，用当前正式服务重新校验；不触碰玩家实例。不把缓存复验写成全新官方下载。

| 组合 | 本轮观察 | 结论 |
| --- | --- | --- |
| Forge47.4.28 / MC1.20.1 / Java17 | 无网启动前复验，主菜单两次；Mods列表FerriteCore6.0.1；两次退出码0 | 运行/重开通过；截图forge-menu-1/2.jpg及forge-mods-1.jpg、forge-launch-1/2.log |
| NeoForge21.1.265 / MC1.21.1 / Java21 | 无网启动前复验，主菜单两次；Mods列表FerriteCore7.0.3；两次退出码0（第二轮窗口关闭） | 本轮通过；不抹除历史间歇退出异常；neoforge截图及launch日志 |
| Fabric0.16.14 / MC1.20.1 / Java17 | 既有ready实例无网复验、两次Fabric Modded主菜单、两次退出0 | 基础运行通过；本轮FerriteCore下载NETWORK_FAILED，未验测试Mod |
| Quilt0.29.2 / MC1.20.1 / Java17 | 新建下载NETWORK_FAILED，保留缓存重试CATALOG_UNAVAILABLE | 安装及菜单/Mod/退出矩阵未通过 |
| 原版MC1.20.1 | 新独立根安装进入downloading后NETWORK_FAILED | 新装/启动回归未通过 |

Fabric新建官方安装也因maven.fabricmc.net连接超时失败：fabric-install.log包含UND_ERR_CONNECT_TIMEOUT；不以历史ready实例运行覆盖本次失败。Quilt两次失败见quilt-install.log/quilt-retry.log；原版见vanilla-install.log。官方Electron下载成功不代表所有Minecraft/Maven端点稳定，未推测网络根因。

## 进程中断与故障记录

新增测试在staged、linked、instance-published三个正式事务检查点真实终止独立进程及其worker，验证JSON/日志和外部sentinel不变、已发布文件数为0/1/2，重开因原owner锁拒绝STORE_BUSY，无重复写入、不抢占锁。此项证明安全阻断；不声称自动清除失效所有者锁或全量断电恢复。优雅重开、丢失应答和事务日志恢复另有既有测试。

首轮默认系统TEMP下多个存储用例失败且runner未自然退出；将TEMP/TMP限定至仓库独立.test-build/final-temp后局部通过，受限运行仍出现链接/本地HTTP操作失败。获准在正常权限下复跑后完整通过，未放宽产品安全断言；首轮遗留测试进程已清理。check.log保留受限失败，check-elevated.log为初版516项通过，check-final.log为新增中断测试后517项通过。

重打包最初被RELEASE_ALREADY_EXISTS阻止，随后将本轮候选保留为final-initial再生成最终文件，未覆盖旧交付。便携验证两次遇到Execution context was destroyed；只给首次只读ready探针增加30次有界等待后通过，不重放任何写操作。保留portable-final.log和portable-final-retry.log。原版旧下载验证目录不存在而STORAGE_IO，随后改为全新独立根实测并记录网络失败。

## 重现与剩余验收

先pnpm check生成.test-build模块与dist；Windows正常权限下设TEMP/TMP至仓库自有临时目录。然后pnpm test:bootstrap、pnpm audit:licenses、pnpm audit --json；OUCL_VALIDATION_DIR指向新证据目录后运行node scripts/mod-transaction-runtime.mjs、node scripts/interaction-smoke.mjs、pnpm smoke:mod-plans、node scripts/loader-local-smoke.mjs。

官方加载器可用node scripts/official-loader-runtime.mjs install或launch或test-mod；OUCL_LOADER_TEST_KIND选四加载器，install默认新建.test-build/official-loader-*，返回workspace后用OUCL_LOADER_TEST_WORKSPACE指定同一测试根；OUCL_LOADER_TEST_REOPEN=1只做离线重开复验。每次仅启动一个可观察游戏，正常退出后记录真实状态。安装可能耗时30分钟，失败保留目录。

EXE：OUCL_EXE_TEST_PATH指向最终文件，OUCL_VALIDATION_DIR设为新目录；node scripts/portable-smoke.mjs。冷/热脚本还需该目录的package.json包证据，独立目录内首次不预置运行时，node scripts/bootstrap-smoke.mjs cold，随后同一EXE运行warm。

未完成：Quilt完整实机矩阵、Fabric测试Mod加载、原版新装闭环、从真实资源库窗口确认下载依赖并提交的公网成功场景、全量真实断电矩阵。完整产品验收仍开放，不将本轮标为全部通过。不push、不发布、不迁移旧profile，不删除旧EXE、原始zip/txt或stash。
