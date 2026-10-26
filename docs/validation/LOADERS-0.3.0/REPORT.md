# 四加载器与 Mod 管理验证（进行中）

日期：2026-10-26。源码分支 `mod_loaders`。本目录记录逐增量实际证据，不代表0.3.0已交付。

## 官方 Forge 安装

代表组合：MC1.20.1 / Forge47.4.28 / Java17。独立根 `.test-build/official-loader-qAJLBD`，没有使用或修改玩家游戏目录。

官方安装器 SHA-1/大小和 Maven sidecar 均验证通过；原版/运行库/处理器输入全部经共享下载校验，计划751,348,666字节。六步客户端链已实际完成，其中 Mojang mappings 由OUCL按原始Mojang版本描述的SHA-1/大小下载，未让Java工具自行下载。

最终实例 `07ee75a2-fa9f-5969-86bd-01bcdb478dfb` 为ready、修订64。再次执行 `prepareLaunch`，重新核验安装器对象及提取文档、已发布下载依赖、全部七个派生产物、native和实例记录，通过。机器路径未纳入导出证据；摘要见 `FORGE.json`。尚未启动至主菜单、未加载测试Mod、未完成退出/再次启动，因此Forge运行验收仍未通过。

官方NeoForge21.1.265/MC1.21.1/Java21也已实际完成939,575,527字节计划、六步客户端链与七项产物校验，实例 `44b298d7-9351-5f8e-b68f-3112437e1d23` 为ready、修订69。摘要见`NEOFORGE.json`；该profile没有上游产物SHA-1，因此本地SHA-256明确只作派生证据。

两者均关闭服务与存储后，另起进程重新打开同一测试根，并将`fetch`替换为必定失败，分别完成`prepareLaunch`，无联网依赖。该结果只覆盖实例重开及启动前复验，没有启动JVM游戏进程。

真实失败也保留：两次下载分别在约79MB和748MB处遇到 `NETWORK_FAILED`；另有目录网络请求 `CATALOG_UNAVAILABLE`。一轮处理器因旧128KiB日志总量限制触发 `OUTPUT_LIMIT`，没有发布ready。修正为32MiB累计限制，原始文本只排空不保存，复测通过；网络元数据仅针对固定网络错误最多尝试三次。所有失败暂存和已验证对象保留。

## 自动化验证

`check-20261026.log` 是使用独立TEMP、正常文件权限运行的完整 `pnpm check`：323项、321通过、0失败、2项原有环境跳过；类型、lint、构建均通过，核心覆盖99.27%行/96.35%分支/99.42%函数。包含提取排队、元数据有限重试、可信映射下载、32MiB处理器输出限制、继承JAR模块排除及公共入口的回归，最终交付前仍会检查后续变更。

`pnpm audit --prod` 无已知漏洞；`pnpm audit:licenses` 检查128包，无待审项；`pnpm test:bootstrap` 的19项通过。未生成或覆盖任何0.3.0 EXE。

## 尚待完成

四种加载器的公共查询/创建入口和下载页已接入；Forge仅开放MC1.20.1系列，NeoForge仅开放MC1.21.1系列，其他组合明确返回尚未接入。新加载器实例固定隔离，所有候选仍标记运行未验证。独立Electron烟测确认27方法/12能力、原版+四加载器选项、无根时禁止安装、四页、设置保存/冲突及小窗口布局通过。

Fabric/Quilt真实矩阵、四加载器主菜单/测试Mod/退出与再次启动、Mod检查与确认安装事务、0.3.0交付仍待完成。

复现入口：先 `pnpm build`，将 `tests/runtime/official-loader-install.ts` 用esbuild打包为Node ESM，再运行。默认新建独立根并验证Forge；`OUCL_LOADER_TEST_KIND=neoforge`验证NeoForge，`OUCL_LOADER_TEST_WORKSPACE`只接受仓库`.test-build/official-loader-*`下已有的测试根以复用可信缓存。测试保留所有材料，不清空已有实例。
