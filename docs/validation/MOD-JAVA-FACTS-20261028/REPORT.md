# Mod Java实测事实接入

- `pnpm check`：499项，497 PASS、0 FAIL、2既有环境SKIP；类型、lint、核心覆盖率和构建通过。
- 新增4项测试：已选择兼容候选优先且使用探测结果而非旧登记文本；缺失/探测失败/实际major变化保持未知；取消等待探测结束、并发有界、档案变化失效；Mod context根据真实实例metadata请求major并注入精确版本，无provider继续null。
- JVM探测由现有JavaProbe承担，新增测试注入受控探测适配器；本轮没有运行用户机器的真实Java，也没有把适配器结果当作实机验收。
- `OUCL_SMOKE_OFFLINE=1 pnpm smoke`：正式Electron45入口通过，36白名单方法、15能力、无渲染Node、设置/离线账户等DOM回归通过；本地目录夹具，无公网。详细结果见同目录smoke.json。

主进程Mod context已实际装配该provider；公共安装确认执行器仍未接入，没有新EXE、没有真实MC验收，不动用户数据。当前服务仅复验已登记Java，不扫描系统、不下载、不变更选择；无可用证据则保留未知。后续接持久任务执行器及公共UI。
