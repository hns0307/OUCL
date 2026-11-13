# 增量报告 v13：C真实超时过期恢复及有限边界

本阶段没有修改产品。C真实产品窗口在一次 completed 状态回执延迟后自然触发 preload TIMEOUT，保持原身份满15分钟；随后 GUI 查询旧身份取得 PREVIEW_EXPIRED、清除旧活动控件、重新接纳新身份并显示 completed。独立证据核验11项全通过，正常退出0，六JAR/五任务记录不变。

## C同次真实窗口链

使用固定v3七产物、v4-bc合成JAR资料，启动前逐项核对清单；这部分C源码及产物与v11候选相同。测试壳只延迟**第一份真正completed状态回执**900500ms，不替换领域结果、preload、组件、时钟或native API。所有GUI由主协调CUA操作。

- 旧requestId `b2b606bb-9560-4457-8f94-58ed4f4d9425`，previewId `0a50462c-53e5-409f-8adc-191c527ecfca`。真实completed handler UTC06:19:33.952；组件在正常3秒超时后保留原ID、取消/查询入口及禁用新预览按钮，截图和每秒只读DOM均确认。
- UTC06:34:34.454真实计时900501.7557ms后，原回执原样释放，公开只读探针取得旧ID的PREVIEW_EXPIRED。释放不代表preload/UI消费；原调用已TIMEOUT，组件仍保持原活动态。
- 主协调随后在同文件点击“重新查询预览”，真实handler/returned、DOM及截图确认过期提示、原取消/查询入口消失、新预览按钮启用。未用自动探针代替这次组件操作。
- GUI再次点击同文件，新requestId `dd662978-a4f6-4ec7-960c-91af1ccfb111`、previewId `f41f797f-8c1e-4160-b9bb-76b5333757d2`；UTC06:36:07.744 completed，DOM显示存在阻止因素/alpha-dependent缺必需模组，无旧超时或过期告警。
- PID38980/window723700正常GUI Alt+F4关闭，UTC06:36:48.669 window-closed、06:36:48.748 will-quit及exit0；owner.lock不存在。六JAR及五条tasks快照与v11前置、当前在途、最终关闭后三者相同。

实际命令 `node acceptance-results/v11-retention-delay/verify-result.cjs` 输出 [verification.json](evidence/c-delay/verification.json)：11 PASS，0 FAIL/PENDING。核验区分handled、delivered与组件DOM消费，不从脚本设计推断执行成功。CUA生命周期会话15分钟闲置到期后只恢复驱动session元数据，未重开产品或重置时钟。后台无效果点击不计业务执行；滚动参数错误在执行前拒绝，随后使用受支持参数及目标可见后的操作。

## 有限边界测试：实际新增15项，不重跑全套

| 范围 | 实际命令/结果 | 精确关闭项 |
| --- | --- | --- |
| C混合输出预算/内存上限 | v3根 `node acceptance-results/c-boundaries-v13/run.mjs`，9 PASS/0 FAIL/0 SKIP，退出0 | 混合恰512/513、三终态16/17、failed/cancelled TTL、4095/4096 tombstone及重启清空；正式类/投影函数、既有注入clock，无GUI/真实时钟升级 |
| E生命周期组合 | v11根 `node acceptance-results/e-boundaries-v13/build.mjs`；`node --test acceptance-results/e-boundaries-v13/boundaries.test.mjs`，6 PASS/0 FAIL/0 SKIP，退出0 | chooser选中/取消/reject失效后真正settle/槽释放；正式Coordinator+Reader与真实Node Worker的abort先/deadline先、有效消息已收未exit时失效；exit前拒绝重入、exit后新请求成功 |

E受控worker夹具用于生命周期，不读真实mrpack；原固定样本内容验证沿用既有真实worker证据。Worker事件观测仍调用原方法，不伪造message/exit，首因错误保持，无活worker或unhandled拒绝。两组报告、测试、日志、来源SHA均归档，产品输入无漂移；无安装依赖、新IPC或生产改动。完整655项及构建沿用v11真实结果，不将15项相加伪称重跑670项。

## 收敛后的状态与后续

来源[C有限审查](evidence/c-review/C-REMAINING-REVIEW.md)和[E有限审查](evidence/e-review/E-REMAINING-REVIEW.md)明确停止条件。

已关闭C-R1、C-R8、C-R7纯预算部分；C-R2接纳回执丢失真实组件重试、R3取消次序、R4真实scanner/network在途退出、R5三种跨实例迟到回执、R6多声明JAR/平台正式解析组合、R7真实Electron sender/frame仍未全补，不把静态审查当通过。

E-R1服务三个terminal、R2/R3正式类+真实worker组合已关闭；至少一次原生picker在原文档失效、主进程继续存活时实际settled及新可信文档再次可用的接线仍待主协调。独立观测壳准备不等于执行。本轮未发现需要改产品的明确缺陷。

v12选定增量已在干净main本地ff-only接纳ecb40f9，最终EXE已复制、462文件/10证据核对通过，见v12 LOCAL-INTEGRATION。v13为后继证据文档，不改写v12当时未验项目。A最终EXE强制中断恢复仍因驱动边界保留，不绕过。完整历史方案继续IN_PROGRESS，保留未批准业务排除表；不push/发布，不操作原五聊天GUI或共享树源码。
