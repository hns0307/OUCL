# 四加载器与 Mod 管理验证（进行中）

日期：2026-10-26。源码分支 `mod_loaders`。本目录记录逐增量实际证据，不代表0.3.0已交付。

## 官方 Forge 安装

代表组合：MC1.20.1 / Forge47.4.28 / Java17。独立根 `.test-build/official-loader-qAJLBD`，没有使用或修改玩家游戏目录。

官方安装器 SHA-1/大小和 Maven sidecar 均验证通过；原版/运行库/处理器输入全部经共享下载校验，计划751,348,666字节。六步客户端链已实际完成，其中 Mojang mappings 由OUCL按原始Mojang版本描述的SHA-1/大小下载，未让Java工具自行下载。

最终实例 `07ee75a2-fa9f-5969-86bd-01bcdb478dfb` 为ready、修订64。再次执行 `prepareLaunch`，重新核验安装器对象及提取文档、已发布下载依赖、全部七个派生产物、native和实例记录，通过。摘要见 `FORGE.json`。后续真实主菜单、游戏内退出0、再次主菜单、再次游戏内退出0均通过，截图`forge-menu.png`及`forge-menu-relaunch.png`；仍未加载额外测试Mod，因此Forge完整矩阵未完成。

官方NeoForge21.1.265/MC1.21.1/Java21也已实际完成939,575,527字节计划、六步客户端链与七项产物校验，实例 `44b298d7-9351-5f8e-b68f-3112437e1d23` 为ready、修订69。摘要见`NEOFORGE.json`；该profile没有上游产物SHA-1，因此本地SHA-256明确只作派生证据。

两者均关闭服务与存储后，另起进程重新打开同一测试根，并将`fetch`替换为必定失败，分别完成`prepareLaunch`，无联网依赖。

## 实际运行与失败保留

使用`tests/runtime/official-loader-launch.ts`通过生产LaunchService/JavaRuntimeService启动，Computer Use只定位并操作本次游戏窗口。Forge修正后两个成功会话为`28910c89-0459-4630-98d5-d2401de09d04`与`319274e1-07fc-43b4-a83f-6f33b398704d`，均看到主菜单后通过Quit Game正常退出0。

真实重开发现官方JVM参数将JNA临时DLL、LWJGL/Netty解包缓存指向受校验natives目录；首次运行后严格目录检查拒绝启动。807e85c将运行写入分到实例`.oucl-launch/jna`与`native-cache`，不放宽原native校验。只将本轮测试实例的两个旧目录保留为`natives-recovery-20261026`及`natives-recovery-lwjgl-20261026`，再从可信输入重建；没有删除、修改用户原有游戏目录。

NeoForge会话`34d44c9e-9d54-4ee4-b120-71e1e31c3cdf`看到主菜单后Quit Game退出0；会话`ca8ec273-f793-464f-be69-d71053e94925`再次看到主菜单，但点击Quit Game后退出码为3221226505（0xC0000409）。截图`neoforge-menu.png`、`neoforge-menu-relaunch.png`。第二次正常退出验收失败，原生日志与现场保留待排查，不推测根因，不标完整运行通过。退出后监督进程与存储均已正常收尾，没有遗留测试游戏进程。

额度重置后原实例未改启动参数，连续重试会话`1823b4cf-1c9f-462c-acc5-24f252816479`和`4b43e4c0-9db8-4a95-8c3a-e6974b453f10`均看到主菜单并通过Quit Game退出0，截图`neoforge-menu-retest.png`及`neoforge-menu-retest-relaunch.png`。按原失败时段筛选Windows应用错误事件未找到Java崩溃条目；原失败未定位，保留为已知间歇退出问题，不能以重试抹掉。

真实安装/启动入口现接受四种加载器，固定Fabric0.16.14、Quilt0.29.2/MC1.20.1。Fabric首次扩展入口缺少元数据服务装配，未开始下载即失败，已补齐；随后Fabric与Quilt都在metadata阶段失败，尚未形成ready实例。Fabric分阶段诊断确认官方profile有效，Maven证明请求NETWORK_FAILED；不改用镜像或本地摘要绕过。入口`pnpm typecheck`通过，真实Fabric/Quilt安装仍待补证。

真实失败也保留：两次下载分别在约79MB和748MB处遇到 `NETWORK_FAILED`；另有目录网络请求 `CATALOG_UNAVAILABLE`。一轮处理器因旧128KiB日志总量限制触发 `OUTPUT_LIMIT`，没有发布ready。修正为32MiB累计限制，原始文本只排空不保存，复测通过；网络元数据仅针对固定网络错误最多尝试三次。所有失败暂存和已验证对象保留。

## 自动化验证

`check-20261026.log` 是使用独立TEMP、正常文件权限运行的完整 `pnpm check`：324项、322通过、0失败、2项原有环境跳过；类型、lint、构建均通过，核心覆盖99.28%行/96.37%分支/99.42%函数。包含提取排队、元数据有限重试、可信映射下载、32MiB处理器输出限制、继承JAR模块排除、运行native缓存隔离及公共入口的回归，最终交付前仍会检查后续变更。

`pnpm audit --prod` 无已知漏洞；`pnpm audit:licenses` 检查128包，无待审项；`pnpm test:bootstrap` 的19项通过。未生成或覆盖任何0.3.0 EXE。

## 尚待完成

四种加载器的公共查询/创建入口和下载页已接入；Forge仅开放MC1.20.1系列，NeoForge仅开放MC1.21.1系列，其他组合明确返回尚未接入。新加载器实例固定隔离，所有候选仍标记运行未验证。独立Electron烟测确认27方法/12能力、原版+四加载器选项、无根时禁止安装、四页、设置保存/冲突及小窗口布局通过。

先排查NeoForge重开后的非零退出，再补Fabric/Quilt真实矩阵、四加载器额外测试Mod、Mod检查与确认安装事务及0.3.0交付。

复现入口：先 `pnpm build`，将 `tests/runtime/official-loader-install.ts` 用esbuild打包为Node ESM，再运行。默认新建独立根并验证Forge；`OUCL_LOADER_TEST_KIND=neoforge`验证NeoForge，`OUCL_LOADER_TEST_WORKSPACE`只接受仓库`.test-build/official-loader-*`下已有的测试根以复用可信缓存。测试保留所有材料，不清空已有实例。
