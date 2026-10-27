# OUCL 0.3.0 便携 EXE 验证

验证日期：2026-10-28（Asia/Shanghai）。

## 交付物

- 文件：`release/OUCL-0.3.0.exe`
- 大小：319,488 字节
- SHA256：`c1ebf29f195c2553386508faaef73dade3a6419928b96d012fc2086789b251cb`
- Electron：45.0.0
- 应用摘要：`afa11a79511d6425f00f70cdd401406fa646d496680e78d6154b2cce6f2b428a`

## 实际验证

- `pnpm check`：458 项，456 PASS、0 FAIL、2 个既有系统能力 SKIP；typecheck、lint、coverage 和 production build 通过。
- `pnpm test:bootstrap`：19 项引导归档、摘要和参数转义检查通过。
- `pnpm smoke:exe final`：真实启动交付 EXE，复用同级 `OUCL.runtime`，隔离用户资料目录；33 个 preload 方法、15 项能力、renderer 无 Node、owner 正常释放均通过。
- 首次隔离启动实际创建 `release/OUCL.games`；它只在没有既有游戏根记录时作为默认根，已有用户选择不会被替换。
- `pnpm smoke`：Electron 安全隔离、四页界面、五种加载器选择、下载设置及小窗口布局通过。
- 主分支 `main` 与 `mod_loaders` 均指向合并提交 `e93adf5` 后再生成本交付物。

## 边界

按用户要求，本轮未执行公网下载测试、未启动真实 Minecraft、未操作用户游戏数据。文件夹快捷入口由严格契约和服务测试覆盖：只接受实例 UUID 与固定文件夹枚举，并拒绝符号链接逃逸。完整 Mod 玩家确认、依赖实际下载和一次安装事务仍未完成，不因 0.3.0 EXE 生成而宣称完成。

机器生成的 `package.json`、`smoke-final.json` 与启动截图保存在同目录。
