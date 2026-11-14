# v30 · 隔离复现、整改候选与统一检查中断

日期2026-11-14。本轮已从静态审查推进到隔离复现和候选修复，稳定main仍262d757、产品fab0ac8，尚未接纳新生产修改。旧v11/v12通过不覆盖本轮候选。

- A-01：正式ObjectStore/OwnerGuard受控Node子进程自行exit73省略close，24断言复现metadata可重取而对象库STORE_BUSY，旧UUID字节保持。root已读设计和对象域实现；metadata OwnerGuard保持原源。对象私有OS租约候选的local-r3扩大局部为26 PASS/0 FAIL、exit0。不是最终EXE强杀或断电验收；初始化未知、旧锁等仍停写。
- A-02：正式安装服务+真实对象库、storage受控替身先复现占用解除后失败Promise仍缓存；候选5项局部通过，包含并发复用、清理等待、清理失败停写和close交错。root已审缓存清理补丁并纳入统一副本，回归测试仅补默认自有临时根，不硬编码机器路径。
- C-01/C-02：实际面板与受控hooks/bridge先失败后9项组件通过。问题行分别标示依赖方/缺失ID/平台project/version，匹配成功终态清旧观察error，失败/不匹配保持告警。root已独立运行9项，通过。原typecheck.log误混入全src解析失败已在分包报告纠正，另local-typecheck-final实际退出0；统一副本初步全项目tsc也通过。
- D-02：正式adapter和受控组件恢复文案优先/不可普通重试，root审两个产品差异并独立运行可迁移夹具退出0。仅当前组件生命周期阻止普通启动，不声称跨重开持久互锁。D-01后继受控LaunchService+任务状态机复现连续应答/读取/保存失败后committing不收敛、spawn替身计数0；尚未实施，非真实SQLite/worker/JVM端到端。D-03降为历史快照限制，见v29理由。
- B-01：原公平候选曾在延迟退订下峰值9，首失败保留。协调选择无公开接口变化的保守槽：同原始bridge身份跨pool保留最多8次未知订阅额度，耗尽改为有界getTask；InstallPanel内部显式传原始bridge身份以免wrapper重建绕过。最新分包报告22 observer +1实际装配局部通过，root尚未审最终完整diff/纳入统一副本。预算只覆盖观察池组，不含LaunchControls等独立消费者，不称全renderer总订阅<=8。B-02未实施。

## 统一检查真实状态

新非Git副本D:/MC_start/OUCL-remediation-20261114-r1，来自main 487文件双读快照，node_modules只读链接v11既有工具链。已加入A-01、A-02、C-01/C-02、D-02候选；B-01未加入。精确差异与原始基线摘要见evidence/candidate-changes.json及source-manifest.json。不要用旧冻结v3/v11做修改。

1. `node node_modules/typescript/bin/tsc --noEmit`：首轮统一候选退出0。
2. `node node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts`：退出1，29项问题在新增C/D便携测试的global/exports/setImmediate全局声明及无用赋值；完整lint-r1.log保留。不得忽略或以移动目录隐藏，后续修正夹具再跑。
3. `node scripts/test.mjs`：未通过且未完成。未设置OUCL_TEST_ROOT，许多存储测试在系统临时目录对应的StorageClient.open即UNSAFE_PATH；直接objects诊断为0通过/7失败，同样在StorageClient.open，尚未进入新对象租约。不能将其直接归因A-01，也不能断言环境为唯一原因。partial full-tests-r1.log保留，无完整计数。
4. 统一exec会话85484在多轮等待后未结束，已通过write_stdin Ctrl+C停止本次自建CLI测试控制器，返回退出1；没有GUI/旧进程终止或旧锁处理。串行后续build尚未运行，不称构建通过。

## 下次恢复的精确顺序

先检查五小时额度，剩余不足20%等待；进行中10%及以下保存。此次剩12%时停止新场景并保存，不使用重置券。五包不再新增验证矩阵，先完成报告并idle。

1. 保留当前目录与所有失败。修便携夹具：用globalThis/显式node:timers导入/module.exports处理未声明全局，保留hook render副作用而移除未使用中间赋值；不能放宽lint或移目录躲检查。适配后的组件用例重新执行。
2. 回收A/B最终报告/候选哈希，尤其B最终保守预算diff与实际装配。只在审完后加入B三处文件；A metadata原始SHA须不变。现在的7个产品源码差异、测试适配均在统一非Git副本，不在main。
3. 设置 `OUCL_TEST_ROOT=D:/MC_start/OUCL-remediation-20261114-r1/acceptance-results/full-r2` 再运行真实scripts/test.mjs，使它创建独占D路径TEMP/TMP；使用新日志，旧r1不覆盖。若仍UNSAFE_PATH定位具体路径/权限，不修改安全检查凑通过。必要只读/正常执行权限按工具审批处理。
4. 再完成类型、全lint、完整test、正式build及C/D组件；只有实际全过且差异/证据审完才精确提交隔离Git、干净main快进。必要新GUI由root唯一控制，分包不启动；不重放旧强杀拒绝，不将服务层/受控组件当EXE验收。

整体IN_PROGRESS，尚有B-02/D-01实现及既有真实EXE强制中断/网络pending/非主frame等缺项。无push发布。独立半小时额度检测继续，本聊天统一维护问题表与下一最小增量。
