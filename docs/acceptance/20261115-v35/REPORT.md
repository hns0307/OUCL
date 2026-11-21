# v35：选定增量验收与本地整合收尾

2026-11-15（Asia/Shanghai）。**本轮已批准的选定增量可在已记录限制下接纳，技术验收及本地整合收尾。** 原版、Fabric/FerriteCore、Quilt及正常重开后的Quilt共四次真实主菜单、游戏内Quit Game自然退出0，四个launch任务completed；最后启动器正常退出0，metadata/对象/gameDir租约释放、guard保留已核。不是全部历史场景、全格式整合包或后续阶段验收完成。

## 本次补齐的证据

同v32最终EXE `OUCL-0.3.0-acceptance-20261114-v32.exe`，410112字节，SHA256 `ba24713708030ba8b96a65858305fb4593d6e3fb0b2afc0ef83e6a4258904be7`；产品代码0c2a889ccea544d3294136a80c74ac8a5e6f348f，公开契约/依赖/持久业务格式未新增。新包热运行时及九条内嵌摘要/七产物身份由v32固定，本版再次核实际提取七产物与EXE摘要一致。完整回归沿v31：691项687PASS/0FAIL/4既有SKIP、类型/全lint/build及专项均通过，源码未变因此不重跑。

v33三个游戏后，用户实际正常关闭PID3884/HWND262364。先前只读观察器记录UTC04:59:54.6250290Z结束，但数值exitCode=null；本版保留为未观测，不把观察CLI退出0当应用退出0。窗口消失、metadata和objects owner标记均不存在，通过before-reopen-v35.json保存。

随后主协调通过CUA启动同EXE，传同v33 profile `D:/MC_start/OUCL-acceptance-v33-20261114/game-data/profile`，bootstrap39736派生正式launcher8676/HWND590502；只读核准确image和profile。界面重现三实例。分别选择Quilt、再按稳定画面启动，新增session `52adee6a-c570-4395-988a-db6452abecc8`，开始UTC05:02:54.770Z，Java19824/HWND920108父进程8676，准确复制Java/实例匹配。实际新截图显示Minecraft1.20.1/Quilt Loader0.29.2主菜单，统一协调已逐张查看；通过Quit Game自然退出，正式snapshot exited/revision3/exitCode0、spawned=true、无stop任务，launch任务completed。

工具关窗再次受Windows焦点限制，未发出AltF4；用户直接正常点×关闭。新的只读观察器提前持有该精确进程句柄并查询真实退出码，记录UTC06:34:07.6684038Z、nativeQuerySucceeded=true、exitCode0。目标窗口消失。没有强杀、shell发GUI关闭或删除所有者证据。

final-audit-v35.py实际exit0：四新session及完成任务、源21历史task与原session保留、18源JSON/三实例record不变、旧/别名双索引SHA1不变、实际七产物和EXE一致。metadata/objects owner不存在，目标games无oucl.session.lock；metadata及对象域guard SQLite文件仍存在。原four-games审计为关闭前快照，launcherStillOpen=true保留历史；最终审计以final-audit为准。首次launcher退出码未观测与最终exit0分别记录，不统一包装为两次exit0。

## 有限接纳决定

| 项目 | 本轮结论与依据 |
| --- | --- |
| A必要基础、资源/隐藏依赖隔离 | 接纳既有已批实现及A01/A02最小整改；新包三实例共存/正常重开和所有者正常释放通过。对象域正式服务异常退出/受控边界与真实产品正常路径分层记录 |
| B任务观察/只读目标 | 接纳B01公平/保守订阅预算、B02逐记录deadline整改，统一回归及真实worker/SQLite受控预算证据；不承诺整个renderer总订阅数或单SQL硬实时中断 |
| C只读维护预览 | 接纳已批只读契约与C01/C02修复，组件/真实受控窗口和可达生命周期有有限证据；不以r2窗口冒称最终整包的全部交互或公网溯源 |
| D内部Java/启动一致性 | 接纳批准首片及D01/D02；实际同包四次游戏支持正常路径，CAS故障为受控模型。唯一LaunchService、软预算、组件生命周期和外部不遵守锁窗口保留 |
| E固定样本只读入口 | 接纳仅1355字节固定样本及已约定有限生命周期；正式最终worker4项通过，原生GUI历史证据保留版本，不扩大通用导入安装 |

本轮31文件精确源码已在0c2a889c本地整合，v34独立复核13生产源LF归一摘要/七产物到EXE链一致，未发现新实质源码缺陷。没有逐源独立metafile/sourcemap，不声明逐段代码均实际运行、可复现构建或数字签名。工作包真实批准是执行依据；本版是技术取舍记录，不新增用户批准。

## 保留的待补证与排除

- A真正最终EXE强制中断恢复仍DEFERRED：工具未认可bootstrap派生PID的终止归属。正式服务异常退出回归已通过，真实产品正常开关/重开已通过；未测产品强杀不改写通过。本轮本地接纳保留该层级风险，不以shell kill/清旧UUID补证。
- C公网pending取消仍NOT_EXERCISED，首早close根因UNKNOWN；真实worker取消等待退出及受控生命周期已验证，公网特定前提未形成不据此推断产品故障。正常安全配置不可达非主frame探针保留未验，不开子frame Node或降低sandbox。
- 此类缺证保留为后续有新安全测试条件时的独立项，不把所有断电/机器/加载器/世界及完整旧玩家资料矩阵无界提升为本轮必测。本轮有限接纳不等同上述格已通过，历史报告原样保留。
- C文件启停/卸载、D公开Java面板、E通用整合包导入安装、额外认证/联机/后台、新依赖/公共IPC/业务格式或发布均排除。

所有新产品/游戏窗口均已关闭；无活跃游戏或人为遗留所有者。主协调完成分包审查、八整改、统一回归、新包身份、代表实机与正常重开、最终租约核验。当前不再有可自动推进的本轮验证步骤，结束本轮验收轮询；独立半小时额度监测保持。新外部测试条件或追加已批增量另开后继版本。未push/发布，活跃mod_loaders未清理、切换或整体暂存提交；未跟踪P-A/tools保留。
