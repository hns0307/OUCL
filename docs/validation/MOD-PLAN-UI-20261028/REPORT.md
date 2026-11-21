# Mod 安装计划界面预览

日期：2026-10-28（Asia/Shanghai）。

资源库中已校验下载完成的 Mod，在选中 ready 的 Fabric、Quilt、Forge 或 NeoForge 实例后显示“生成安装计划”。按钮调用严格 `planMod`，使用当前实例修订与资源库项目/版本/SHA1身份；同一请求超时可复用requestId，切换实例或修订会清除旧预览。

界面只展示计划状态、文件数和待下载总量，并明确说明当前是安装前预览、不会写入实例。vanilla实例、非Mod资源、未下载完成项目或缺少`mods.v1`时不显示按钮。冲突和无法判定计划不会显示为可安装。

验证：`pnpm check`共459项，457 PASS、0 FAIL、2个既有系统能力SKIP；typecheck、lint、coverage和production build通过。按用户要求未联网、未启动Minecraft、未操作用户游戏数据。

本增量仍不包含玩家确认/拒绝、计划持久化、依赖实际下载或一次安装事务。
