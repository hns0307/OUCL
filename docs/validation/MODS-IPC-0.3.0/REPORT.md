# Mod 检查公共接口增量

2026-10-26（北京时间）在mod_loaders实现；G2四加载器/Mod完整方案授权内，无新依赖。

mods:list/check/report三个严格v1入口和preload接通，拒绝路径/额外字段、非法sender/版本/UUID，主进程再次验证输出并脱敏错误。只有ModTaskService初始化与通用任务适配都成功才广告mods.v1；未知或损坏Mod记录使Mod能力不可用，不阻断原有安装/启动。取消/退出等待扫描worker退出，存储最后释放。

公共请求进入真实持久任务，复用tasks.v1查询/列表/订阅/退订/窗口重连/取消。集成测试验证同请求幂等、断开旧sender失效、新sender重新订阅和取消后状态/原因已持久；只读检查，无Mod安装或修改。

pnpm check：383项，381 PASS、0 FAIL、2原有环境SKIP，typecheck/lint/build通过；日志check.log。受限环境首次运行存在既有链接/本地网络测试权限失败，最终使用正常本地权限与仓库内独立TEMP完成。新增接口断言曾错误预期非法额外字段保留requestId，已修正为严格信封拒绝后使用traceId；最终通过。

pnpm smoke：独立用户配置、实际Electron45.0.0/Node24.22.0通过；smoke.json列出30方法/13能力（含mods.v1）、无Node、安全窗口、无root的受控错误、非法路径拒绝、原版+四加载器选项、四页与小窗口。截图为此轮独立运行，未操作用户游戏。此验证不是EXE交付或已完成的Mod界面/依赖事务。

仍待：实例Mod列表/检查报告界面、依赖确认下载与提交恢复、Fabric/Quilt完整真实矩阵、原版实际回归、分发契约/适配器及0.3.0小EXE。原两份暂存资料保留，不push。
