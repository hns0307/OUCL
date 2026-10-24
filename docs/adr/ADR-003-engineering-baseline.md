# ADR-003：阶段0工程基线

日期：2026-10-24。状态：**设计默认方向APPROVED，工程骨架技术检查通过；阶段0整体待验收**。批准负责人：用户，出处为本聊天直接选择“1”及问题面板答复“批准上述范围，开始工程实践”，详见[决策记录](../../OUCL-Codex/docs/DECISIONS.md)。

## 选择与边界

采用Git根单应用，保留OUCL-Codex资料包；TypeScript strict + Electron + React + pnpm，Vite构建renderer，esbuild构建main/preload，Zustand仅派生连接显示状态。目录保持main/core/services/ipc/shared/ui，main显式注册窗口与唯一握手接口；core/services无业务实现。

对比：资料包内建应用会使根级工具与规则分散；monorepo/通用DI容器暂缺独立发布需求；完整打包框架增加首轮依赖。本轮选择单应用、独立脚本和便携目录，不引入这些替代项。

默认六类设计方向批准与工程运行证据分开。架构、目录、IPC白名单/版本/超时、JSON+SQLite+FS存储、安全基线及联机延期边界沿用现有已审查方案；更深业务字段/schema仍按具体增量冻结。仅实现[空骨架握手契约](../contracts/HANDSHAKE.md)，其余业务通道不注册。联机最终产品明确延期至阶段3前，优先研究EasyTier并不等于已选定依赖。

Electron contextIsolation/sandbox开启，nodeIntegration关闭，拒绝权限、新窗口、导航及webview；renderer CSP无网络，preload仅无参数handshake。窗口会话仅内存，销毁释放，不创建持久账号、实例或下载数据库。日志错误不把raw请求/堆栈传回页面。

存储实验保留在spikes，正式源码不得导入；Node内置SQLite用于验证，不自动成为Electron生产DB方案。首版文件软链接不可用时明确使用复制回退；本机文件软链接场景仍未验证通过。

工具链固定版本、许可证、体积与例外见[依赖评估](../DEPENDENCIES.md)。测试使用内置Node runner，业务core首次增量再落地85%行/分支覆盖目标；本轮无core业务代码，不制造无意义覆盖率。CI包含typecheck/lint/contract/build/spikes/依赖审计/许可检查，远端CI尚未运行。

## 证据与剩余风险

[P0-08验证报告](../validation/P0-08/REPORT.md)包括实际检查、源码窗口、默认便携入口启动、截图、审计。S-05真实HTTPS链及S-06a/S-07/S-10实验结果见[本地实验报告](../../spikes/phase0-local/REPORT.md)。

未证明：Windows 10/11完整支持矩阵、真实断电/磁盘满、TOCTOU防护、并发写入/锁压力、S-08旧版游戏实机、四期凭证、三期联机、生产迁移或正式发布安全。G0技术验收不因空骨架可运行而自动通过，P0-07仍需对这些适用缺项完成处置与验收记录；当前用户已明确允许骨架预先准备，不阻塞本轮独立工程交付。
