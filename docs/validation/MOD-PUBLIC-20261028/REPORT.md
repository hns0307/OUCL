# Mod确认安装公共接入验证

从最新78bb260继续，保留已批准桌面/论坛界面；旧报告失败已由dfff42b修复。本轮连接公共确认、安装状态、任务投影/控制/重连、main真实准备与事务装配和资源库确认按钮。

- 完整`pnpm check`：513项，511 PASS、0 FAIL、2既有环境SKIP；类型/lint/核心覆盖率/build通过。
- `node scripts/mod-transaction-runtime.mjs`：Electron45+正式dist worker，准备、真实依赖传输/JAR检查/一次提交、取消/回退/丢失应答/恢复等29项全部通过。使用生成夹具与本地metadata/HTTP适配器，详见transactions-runtime.json；没有公网或真实MC验收。
- `pnpm smoke:mod-plans`：真实React组件、preload、固定handler、SQLite worker与安装任务服务验证：预览未接纳、确认后才接纳、准备未知不提交、错误持久、刷新同taskId恢复、隐藏原cancelPlan按钮；仍覆盖拒绝/取消、过期计划和720×560无溢出。安装准备在此窗口测试内明确替换为未知失败，不能当作窗口安装成功。任务订阅用受控失败验证getTask回退，真实订阅实现另复用现有任务测试。
- `OUCL_SMOKE_OFFLINE=1 pnpm smoke`：正式入口44白名单方法/16能力、无Node、设置/账户DOM及四加载器选择通过，本地目录fixture。未冒充官方目录联网成功。
- `pnpm test:bootstrap`26项通过；`pnpm audit:licenses`128包、无待审许可，无新增依赖。按用户要求未执行联网漏洞审计。
- 已查看confirmed-failure.png；失败显示停止原因且不呈现“已安装”。最后按Mod场景调整失败文案，并显示精确项目/版本ID，重新进行窗口验证。

UI验收首轮在重载暂未挂载元素时直接访问dataset导致测试表达式抛错，另补充夹具instances:list响应；修正等待后通过。不是产品安装成功证据，不掩盖失败或增加公网测试。

边界：本轮没有真实MC菜单/测试Mod/退出重启矩阵、全量断电/kill、未来签名分发适配器验证；完整原计划仍有验收缺项，不停用自动化。旧EXE和原始zip/txt/stash保留，不push。

交付增量：source0084b08构建release/OUCL-0.3.0-mod-install.exe，363008字节，SHA256 ed97b39bcc3781537848cc7c4feaacbae59ee32ef63baabb6d8b3dba41b03ea5。本地预置固定Electron的真实EXE三场景PASS：首次创建同级OUCL.games/profile、重开保持根身份、同名阻塞文件保留及排除后重试。见../BOOTSTRAP-0.3.0-mod-install/package.json与portable.json；没有公网冷启动/真实MC验证。
