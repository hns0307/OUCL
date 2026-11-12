# B/C 验收闭合清单

日期：2026-11-12。候选 `bc01f07487ca7e8d76f17115ea148efcafd748c2` / v3固定七产物。已读取TASK_PLAN、DECISIONS、AGENTS及v3–v6相关报告；本次仅静态复核并新增本文件，没有重跑测试、GUI、产品变更、提交或操作打包。开始五小时已用16%、剩84%，满足工作门槛，未使用周额度门槛。

本清单的PASS只适用于所列层级和输入；DEFERRED表示当前证据尚未覆盖、继续保留，不代表批准免验或已验证失败；EXCLUDED表示本候选范围不包含。最终合并/发布由主协调决定。

## v6原始证据与提取结果复核：PASS

直接解析 `evidence/window-extraction.json` 指向的原始JSONL行，未运行提取器或窗口：

| 项目 | cold | hot |
| --- | --- | --- |
| 公开listTasks证据行 | window-cold.jsonl:5 | window-hot.jsonl:5 |
| 四卡片completed/confirmed证据行 | window-cold.jsonl:15 | window-hot.jsonl:14 |
| 公开任务ID与seed/提取器预期集合 | 完全相同，4项 | 完全相同，原4项 |
| kinds/state/分页 | 2 install + 2 mod-check，均completed，无nextCursor | 相同 |
| DOM任务ID/状态/确认 | 4项集合相同，均completed/confirmed | 相同 |
| 原日志时间和卡片DTO与提取结果 | 逐项匹配 | 逐项匹配 |
| renderer无Node | nodeAbsent=true | nodeAbsent=true |
| harness-error | 0 | 0 |
| 正常关闭链 | 各1条window-closed、will-quit、exit0 | 相同 |

`evidence/evidence-hashes.json` 的11项文件逐文件SHA256均匹配，无不符。提取文件中的PASS与原日志支持一致，不依赖截图中文字猜测状态。本次未重新视觉审图；实际GUI操作/截图观察由[v6主报告](REPORT.md)及主协调原证据负责。

四个taskId：安装 `1d5ca48b-de12-480a-b84a-e44b61a7f005`、`c925a628-bea3-4e3a-98af-308648ee2689`；Mod检查 `b1cd9fd4-93ef-41f4-aa2c-c1dec4f76486`、`f236be40-ca29-4952-bb96-1b146f3af798`。它们由正式InstallerService.create、ModTaskService及真实worker/SQLite产生，非手写任务状态。客户端与声明JAR仍为本地合成不可执行输入，completed不是真实MC运行/Mod兼容或平台已知来源证明。

## B闭合情况

| 状态 | 项目 | 实际证据与层级 |
| --- | --- | --- |
| PASS | 全局任务中心生产壳与持久正常重开 | 本次v6逐行复核：正式安装+Mod任务，冷/热四卡片confirmed、正常exit0。补齐v3清单当时“全局产品壳未验”的缺项 |
| PASS | A活动时选B，B不取得A任务 | [v5报告](../20261112-v5/REPORT.md)及其b-final-proof.json：真实A任务`815889c6-00d8-4ccf-be5f-3efea8d55456`，B读取前后getTask均running，选择/报告均B，B仅原任务。是正式服务/公开IPC的顺序夹验，不是原子快照或真实上游延迟 |
| PASS | A/B历史报告/目标正常重开归属 | [v4报告](../20261112-v4/REPORT.md)的真实Mod服务、worker/SQLite和生产壳两实例切换/重开，实例身份一致；和v6全局正式安装profile是两套独立证据，不拼成单一全流程 |
| PASS | 缺失/外改计划、未来格式、跨根、确认摘要不符拒绝 | [B-BOUNDARIES](../20261112-v3/B-BOUNDARIES.md)及v3原tests.log：真实worker/SQLite；同步测试日志只为越过通用完整性检查触达领域校验，非产品迁移 |
| PASS | worker/main计时与pending槽 | worker2000ms为测试时钟注入，真实worker未强杀；main2500ms真实计时、受控存储替身，超时后槽保持、迟到结果不造快照。不能合称真实慢盘性能验收 |
| PASS | 101行分页、limit变化、重放及2001行拒绝 | v3 `tests/task-target-adapter.test.ts:15,22,47`，已有完整回归日志615/618行通过；**生产adapter+合成任务投影**：101先取100再limit1、重放同页；2001拒绝。不能称真实worker的101/2001全链 |
| PASS | 单域库存1000/1001拒绝边界 | v3 `tests/task-target-inventory.test.ts:51`，实际是内存SQLite/TaskTable、单mod-check域；先已有1行，再在n=999时断言总1000，循环到n=1000后总1001拒绝。不是完整持久计划/worker双域 |
| PASS | main快照/游标总容量 | B新增测试：16份各2000行合法合成DTO，总序列化14,113,008字节；第17快照逐出；256游标上限/旧引用失效。检查资源计数和序列化上界，不是堆内存/精确16MiB占满 |
| DEFERRED | 双域各1000条完整计划全worker链 | 没有1000 mod-check索引+1000 mod-install正式确认计划同时贯通StorageClient/SQLite/JSON/worker/公共分页的规模物证；v6只有4任务，不能据此关闭 |
| DEFERRED | 精确公开1MiB/私有2MiB边界与超限 | 尚无合法边界输入的≤阈值成功/阈值+1失败两侧物证。2001行属于数量拒绝；14,113,008总量属于容量样本，均不能代替字节超限 |
| DEFERRED | 完整规模下101/2001与各域上限贯通 | 已有adapter101/2001、TaskTable1000/1001各自PASS；真实worker全链组合、跨域总量/体积交互尚缺，不能将分层结果合称完整矩阵 |
| DEFERRED | 真实慢盘/共享队列下全部时间与生命周期组合 | 已有固定预算、迟到/代次/逐出定向验证；不覆盖每种IO/队列等待、游标TTL/容量组合或窗口销毁在途时序 |
| EXCLUDED | 旧v4profile全局列表作为有效任务中心验收 | v4手工合成ready缺install admission，TASK_NOT_FOUND事实保留；未修产品或补假任务。改用v5-global正式安装profile后v6通过，不删除旧失败 |

v3“651项647PASS/0FAIL/4SKIP”是其固定候选历史完整回归；本次只读核查对应测试名称/断言及日志，不改写为本轮重跑。既有seq/revision、sender/过滤、读取屏障等回归继续按原证据层级引用，不因产品窗口样本而扩大为所有竞态通过。

## C闭合情况

| 状态 | 项目 | 实际证据与边界 |
| --- | --- | --- |
| PASS | 公共IPC/preload/main/ModPanel接线 | 固定候选已接线，v4真实生产壳使用真实报告执行预览。旧“公共IPC/界面未实现”报告是过时快照，不作为当前结论 |
| PASS | BC-02问题定位与展示 | v2整改后v3组件探针通过；v4生产窗口UIA观察A provider blocked/alpha-dependent、B before要求>=2/实际1及after缺依赖。真实服务+合成声明，不是平台兼容保证 |
| PASS | BC-01过期恢复的受控组件路径 | v3固定整改及专属探针：TIMEOUT保持身份、status/cancel/取消后补查过期可新ID重试。生产组件+受控hooks/mock transport；未声称在GUI等待真实15分钟 |
| PASS | 只读字节保持与任务写入区分 | v4六JAR SHA256前后一致、预览前后原任务行一致；后来明确点击检查新增任务另记，不误称预览写入。持久恢复的是mod-check报告，不是previewId |
| DEFERRED | 生产窗口真实15分钟过期及全部回执竞态 | 本候选有服务/组件定向证据，未见真实窗口计时到期/取消全部时序的完整矩阵；不将hook探针升级为该层级PASS |
| EXCLUDED | 文件启停/卸载、持久previewId/可执行计划 | 此次只读观察明确不含，不以ready/blocked/unknown展示作为写入授权或游戏兼容担保 |

## 供最终包清单引用

B/C在选定只读/任务管理范围的代表生产壳、实例归属、只读预览及正常重开证据已经补齐；**双域1000全worker链、精确字节超限等上表DEFERRED仍须显式保留**。这不是“B规范§9全部通过”声明，也不是放宽既有验收条件的批准。

本清单不覆盖主协调正在生成的最终包tag/EXE及其冷热、运行时下载、签名或发布；v6冷/热是生产壳profile首次/正常重开。原版/Fabric游戏代表证据、Quilt别名排除及其他工作包缺项由其独立报告负责，不并入B/C合成任务证据。
