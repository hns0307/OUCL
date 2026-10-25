# 阶段0最小工程依赖评估

批准来源：用户已在聊天及问题面板明确批准“现有推荐默认方案、阶段0本地验证、空骨架、默认技术栈最小依赖评估安装”。本表记录该范围内的实施选择，不批准额外业务依赖。核验日期2026-10-24，来源为npm官方registry的版本、engines、license、peerDependencies与dist.unpackedSize。

| 包 / 固定版本 | 用途 | npm解包字节（不含传递依赖/平台二进制） | 许可证 |
| --- | --- | --- | --- |
| electron 45.0.0 | 默认桌面运行时，仅开发与空窗口验证 | 1208255；Chromium/Node二进制另计 | MIT及发行包第三方声明 |
| react / react-dom 19.3.1 | 默认渲染UI | 178663 / 8067632 | MIT |
| zustand 5.0.16 | 默认渲染状态库；仅骨架连接状态 | 95961 | MIT |
| vite 8.3.5 | 默认渲染构建 | 2383283 | MIT |
| esbuild 0.28.2 | 默认主进程/preload构建 | 147361，平台二进制另计 | MIT |
| typescript 6.0.3 | strict类型检查 | 24346827 | Apache-2.0 |
| eslint 10.13.0 / @eslint/js 10.0.1 | 规范与边界检查 | 2950609 / 15687 | MIT |
| typescript-eslint 8.72.0 | TypeScript ESLint规则 | 42686 | MIT |
| @types/react / @types/react-dom 19.3.0 | UI声明 | 408108 / 32862 | MIT |
| @types/node 24.19.2 | 与本机Node 24匹配的声明 | 安装后测量 | MIT |

这些是实际registry版本，不把包版本当成功构建或安全证明。已核对Node 24.21.0满足Electron/Vite/ESLint的engines。typescript-eslint支持TypeScript >=4.8.4 <6.1，因此选择6.0.3，不使用registry当前7.0.2。依赖均来自对应上游维护的官方包；具体漏洞结论依赖安装后的pnpm audit，不以“有维护”代替审计。

替代方案：测试使用Node内置test/assert，避免另装Vitest；空契约采用手写严格schema守卫，业务schema库后续单独评审；SQLite实验复用Node内置node:sqlite，不安装原生绑定；不引入打包框架，先交付便携目录载荷验证，不创建安装器或ASAR。测试runner/打包器如需更换，另行评估。

安装固定版本并生成pnpm-lock.yaml。仅允许electron、esbuild所需安装脚本；Electron下载官方发行二进制并校验发行校验和，esbuild校验版本可执行性。pnpm及包自带安装校验不等于发布签名或完整供应链审计；本轮不发布安装包、不启用应用更新。

实际安装后体积、传递许可、漏洞审计及例外由`scripts/audit-dependencies.mjs`与验证报告记录；本表中npm解包体积不可当成实际最终安装大小。没有SMTP/OAuth/中继/签名密钥依赖。

安装后审查：Vite传递构建依赖lightningcss及其win32二进制1.33.0均声明MPL-2.0，已读取所装包LICENSE与package.json；作为构建工具保留原包声明，不修改或复制其源码，不放入应用运行载荷。许可证检查仅为这两个固定包加入已审查构建例外，不全局放行任意MPL包。发布前仍需对实际分发载荷及Electron第三方声明逐项归档，此次不作为法律审查结论。

Electron45包不再包含自动postinstall，CI和复现需要显式`pnpm exec install-electron`；其install.js使用包内checksums.json校验发行下载。pnpm12的构建许可采用allowBuilds，仅放行esbuild；未使用全局允许脚本。依据：[pnpm构建设置](https://pnpm.io/settings/build)。

## Mod 声明解析依赖（2026-10-26）

用户已在四加载器与 Mod 管理方案中明确批准采用 `smol-toml 1.9.0`，用于解析 Forge/NeoForge JAR 内的标准 TOML 声明，不使用正则模拟 TOML。npm 官方 registry 记录的固定版本解包体积为 139963 字节，许可证为 BSD-3-Clause，无声明的运行时依赖；包由 squirrelchat/smol-toml 上游维护。安装后 `pnpm audit --prod` 报告 0 个已知漏洞，仓库许可证检查识别 128 个包、无待审例外。固定版本的 registry integrity 为 `sha512-hpd+HLON7HdZXqYchMM/+LaTTbdK0AU3NngIJ4KVyWbY9bfQqdL9cD+4yf6dUoU2Ap4VsU0JkQi6FxAI1B2mXQ==`。

本依赖只进入受限 JAR 声明解析路径；安装器执行、压缩边界与递归依赖解析仍由 OUCL 自身的有界 worker 和事务编排控制。上述审计是截至核验时的工具输出，不构成永久无漏洞保证。
