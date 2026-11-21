# v13 接续点：额度等待，未启动原生场景

2026-11-13 UTC06:45，实际五小时已用87%、剩13%，低于新工作20%门槛。所有本轮自有产品/游戏窗口均已正常关闭，不再沿用旧在途PID，不需用户关窗。

本地main `D:/MC_start/OUCL-download-main` 已为 `ae291dbb8fd88311637c10dc7d72d8ee247d4c10`，工作树干净。v12选定A隔离代码及同EXE四菜单/exit0已接纳；v13的C真实超时过期恢复、C9项/E6项有限测试及42份原始归档SHA均已同步验证。不push/发布。v12 LOCAL-INTEGRATION中的ecb40f9为当时整合点，后继ae291db仅证据文档。

E原生真实接线尚未启动，准备已完成于：

`D:/MC_start/OUCL-acceptance-v11-20261113/acceptance-results/e-boundaries-v13/`

- native-window.cjs、snapshot-native.mjs、NATIVE-PLAN.md、native-app/package.json已保存。审查聊天报告语法检查通过；主协调此前静态阅读的版本后又修正了app路径，后续以NATIVE-PLAN及最终文件为准。
- **必须启动native-app目录**，不要直接启动window.cjs；小package使app路径与新数据根并列，避免误触产品路径守卫。未调用私有setAppPath，不放宽产品守卫。
- 额度实际>=20%后，先读NATIVE-PLAN和最终脚本，再由主协调CUA用现有v11/node_modules/electron/dist/electron.exe加载native-app。启动前七产物校验、全新native-case资料、禁外网；首次原生picker pending1.5秒后测试壳仅一次reload制造主文档失效。只观测原dialog/Worker/IPC，不自动选择或取消。
- 等真实navigation/reload后主协调CUA取消首picker，确认真实choose-settled、旧请求INVALID_SENDER且旧worker数0，再由新文档真实选择固定样本并确认新请求成功、真实worker exit及DOM。若自动取消则记录实际分支，不伪造迟到选择。
- before/after-late/after-preview/closed快照按使用说明执行，不造ready或SQL记录；正常退出0/owner释放后才归档。case/log存在则不覆盖、不复用。被平台或驱动拒绝时保留事实，不绕过。

ADE聊天 `01a1cbcd-2f19-72c1-af8e-7bd60562e0dc` 已停止新增并idle，游标 `98c95a42-b3b2-400c-9825-ca625720cc7f:24`；BC `01a1cbcd-2062-7630-b618-a708b58a8741` idle，游标 `a4f9dcd3-648f-4abb-9339-0e842897c814:14`。不要重复创建或让它们操作GUI。

其他C有限未验项见本版报告/审查表。A最终EXE强制中断恢复仍DEFERRED，不绕过驱动对bootstrap派生进程终止归属的拒绝。完整历史方案仍IN_PROGRESS。

此接续文件在ae291db之后保存于活跃树的文档目录，尚未包含于该提交，下次可精确同步文档；不以此对已提交证据或产品作新PASS声明。
