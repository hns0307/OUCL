# Forge / NeoForge 客户端安装器 spike

日期：2026-10-26。范围：只读核验官方安装器格式，不执行安装器或处理器，不写玩家游戏目录。

## 固定样本与信任证据

| 加载器 | 代表环境 | 官方制品 | 大小 | SHA-1 |
| --- | --- | --- | ---: | --- |
| Forge 47.4.28 | MC 1.20.1 / Java 17 | `maven.minecraftforge.net/.../forge-1.20.1-47.4.28-installer.jar` | 8,859,760 | `585dd6071897becaed3b09bff4c3d9559e0cbc75` |
| NeoForge 21.1.258 | MC 1.21.1 / Java 21 | `maven.neoforged.net/.../neoforge-21.1.258-installer.jar` | 6,972,022 | `4e873ba909cd4d2c0818517f479a69a655097691` |

摘要均来自同一官方 Maven 路径的 `.sha1` sidecar，并与下载字节独立计算结果一致。Forge 官方下载页把47.4.28同时列为Latest和Recommended；NeoForge 21.1.258本轮作为格式样本，正式稳定矩阵仍须在发布前依据官方目录冻结并实机验收。

## 实际结构

- 两者均含根级 `install_profile.json` 与 `version.json`，profile `spec=1`，版本分别继承1.20.1与1.21.1；启动入口均为`cpw.mods.bootstraplauncher.BootstrapLauncher`。
- Forge profile含36个安装库、29个运行库、10个处理器，其中客户端执行6个；NeoForge含70个安装库、47个运行库、10个处理器，其中客户端同样执行6个。
- 客户端链依次需要映射提取、Mojang mappings、映射合并、jar拆分、重命名、二进制补丁。服务端专属的脚本提取和bundler步骤必须排除，不能直接运行安装器的通用`--installClient`并把其写入范围当成安全边界。
- 所有安装库均在profile中带精确HTTPS URL、SHA-1、大小和相对路径。处理器主JAR及classpath均引用这些已声明库；内嵌`/data/client.lzma`来自已校验安装器本身。
- Forge给出部分处理器`outputs`及最终`PATCHED_SHA`，NeoForge 21.1.258没有这些输出摘要。故生产实现必须保存每个处理器输入、工具版本和本地输出SHA-256，但不能把本地摘要称作上游证明；有上游输出SHA-1时另行强制核对。
- 两个样本的`version.json`都没有独立`javaVersion`字段，Java 17/21要求必须来自OUCL冻结的代表矩阵与父级Mojang版本，不可从缺失字段猜测。

## 生产边界结论

1. 下载器先核验安装器sidecar，再由有界worker只读抽取两个JSON和明确引用的`data/client.lzma`；拒绝ZIP越界、重复项、超限项及未知profile spec。
2. profile解析生成声明式处理器计划：受控工具坐标、已验证classpath、固定参数令牌、客户端侧筛选、显式输入输出。渲染进程不能传路径、URL或参数。
3. 处理器只能在独立暂存实例树中用已选择的受管Java运行；逐步等待退出，取消先发终止并等待，超时才受控强停。任何处理器失败、输出缺失或摘要不符都不发布ready。
4. 最终`version.json`、下载库和处理器产物一起进入现有实例事务；恢复必须按记录重建相同计划，外部变化使旧提交计划失效。
5. 本spike没有执行任何处理器，因此不构成Forge/NeoForge安装、启动或兼容通过。

复现：先把上述两个官方JAR放入`.test-build/installer-spike-20261026/{forge,neoforge}.jar`，再运行`node spikes/loader-installers/analyze.mjs`。脚本固定校验大小、SHA-1、身份、库证明、处理器引用、客户端筛选和参数边界，仅输出报告到标准输出。
