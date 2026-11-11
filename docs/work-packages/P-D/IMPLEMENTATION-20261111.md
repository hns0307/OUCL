# P-D 首片实施与验证记录

状态：2026-11-11，已按2026-11-10用户明确批准实施；最终完整检查见本报告末尾。本次在共享工作区进行，保留其他工作包既有修改；未切换分支、提交、发布、操作玩家实例或旧EXE。

## 实际改动

- `src/services/java/selection.ts`统一登记候选顺序与8秒测量预算；`mods/java-facts.ts`和`java/runtime.ts`使用同一规则。运行准备登记前后的实测版本必须一致；登记时受控检查档案快照并支持取消。
- `launch/service.ts`保存本次实例、档案、设置、Mod库存和准确Java版本事实；`launch/process.ts`持有原有gameDir锁时再次测量相同Java，在锁内只读验证并检查本地Mod依赖；已知不满足或无法判定均阻止启动。
- `install/launch-inputs.ts`、`launch-snapshot.ts`和`installer.ts`分离准备与只读复核，重新检查启动文件及native树、Mod库存、实例修订；同gameDir的Mod事务与启动继续竞争同一现有锁。
- 提交许可与取消通过同一持久队列裁决；提交应答丢失时在队列内读取原任务，拒绝启动并保守处理中断；锁释放仍验证本次token。许可后的失败沿既有状态机保留needsRecovery。
- 原错误码保持，`messages.ts`修正启动依赖提示，使未知Mod兼容性不会被误说成必须重新安装。两个既有验证脚本改用必填锁内复核接口；`scripts/test.mjs`和`build.mjs`支持指定独立输出根，默认输出保持原位置；ESLint边界测试以指定源码根检查。
- 新增/调整的测试位于`tests/game-process.test.ts`、`tests/installer.test.ts`、`tests/java-runtime.test.ts`、`tests/mod-transaction.test.ts`及`tests/lint-boundaries.test.ts`。后两个文件还含其他工作包改动，不将它们归属于P-D。

## 分层证据

- [状态机验证](evidence/20261110/state-machine-result.json)：4项纯状态机用例通过，不代表真实持久任务。
- [真实Java属性](evidence/20261110/real-java-result.json)：独立历史官方测试缓存中Java 8 `1.8.0_51`、Java 17 `17.0.15`、Java 21 `21.0.7`的真实进程属性读取通过；没有注册到玩家档案或运行游戏。
- [真实Mod事务测试](evidence/20261110/transaction-unrestricted.log)：21项通过，含真实存储/Mod事务与模拟游戏子进程在相同gameDir双向争锁；这不证明真实Minecraft进程加载了Mod。
- [首轮受限测试](evidence/20261110/integration-tests.log)多项事务失败；隔离定位显示系统在本地夹具硬链接处返回`EPERM link`。获得运行权限后复跑上述21项通过，失败日志保留。
- [11月10日完整检查](evidence/20261110/check-final.log)：独立测试和构建输出，600项中598通过、0失败、2跳过，类型、lint、测试和构建通过。两项跳过分别是缺少文件符号链接权限，以及Windows拒绝重命名打开的SQLite数据库；不改变系统策略。该次使用的是当时共享工作树，不声称与其他对话后来新增改动完全一致。
- 真实storage/启动服务夹具还覆盖实例修订变化、库存/原生文件变化、档案变化、unknown拒绝、提交前取消、提交许可应答丢失、许可后变化与锁释放，以及禁用materialize/extract的只读复核。游戏spawn由测试替身模拟；结果见完整检查日志。

## 边界和后续

本轮没有新建公开IPC、持久格式或第三方依赖，没有把服务夹具当作真实游戏验收。尚需在用户授权的独立测试实例通过实际产品入口验证Java/Mod/游戏菜单与重开；本聊天此前要求不操作玩家实例或旧EXE，保留该限制。外部程序不遵守OUCL锁，末次文件检查到操作系统实际打开文件之间仍存在外部修改窗口，不能声称完全隔离。

锁内两次重读并逐文件检查可增加大型实例的启动时间；单次有界Mod扫描遇并发会受控失败，可取消阶段等待工作完成。提交许可后的故障可能保守进入needsRecovery；目前没有新增公开恢复诊断字段。完整有效Java显示/公开接口不在本次批准范围。

## 2026-11-11 最终完整检查

从仓库根设置`OUCL_TEST_ROOT=docs/work-packages/P-D/evidence/20261111/full-run`、`OUCL_BUILD_ROOT=docs/work-packages/P-D/evidence/20261111/product`后执行仓库实际`pnpm check`，独立输出见[检查日志](evidence/20261111/check.log)。类型检查、lint、测试和构建均通过；612项中608通过、0失败、4跳过。两个跳过涉及符号链接权限和Windows拒绝重命名打开的SQLite数据库；另两项为其他工作包的专用worker未配置。结果包含当时共享工作树中其他工作包的改动，不代表后续变化已被复验。

这次检查覆盖用户提示文案改动；测试/编译产物只写入P-D目录，保留先前失败及重跑日志。对应产物不是EXE，也不代表产品实机游戏验收。
