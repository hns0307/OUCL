# OUCL 0.5.0 Windows x64

- 构建命令为 `pnpm package:exe`。EXE 大小为 825344 字节，SHA-256 与 [打包清单](package.json) 一致。
- `pnpm smoke:portable` 使用预置并校验的 Electron 45.0.0 通过三个场景。覆盖中文目录首次启动、重开保留根目录登记、目录冲突后重试。各场景验证四系统能力和正常退出时释放存储锁。
- EXE 为本地未签名制品。外部账号与跨网实测边界见[四系统说明](../../FEATURE_CENTERS.md)。
