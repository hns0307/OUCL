# 真实私有权威 × native factory 跨 owner 恢复

2026-11-17。基线main `65777881`，沿持续执行授权完成独立验证增量。只新增 `tests/distribution-native-authority.test.ts`、本报告和 `authority-evidence/`，未修改产品、旧断言、公共IPC、依赖或Git提交。

## 结果

**4 PASS / 0 FAIL / 0 SKIP，exit0，1643.296ms**。本测试源局部ESLint与整仓TypeScript检查均exit0。原始 [tests.log](authority-evidence/tests.log)、[status.json](authority-evidence/status.json) 和四份逐场景JSON均保留。

本轮补齐此前两个分离层级：`distribution-execution.test.ts` 使用真实SQLite但cooperative文件适配；`distribution-native-files.test.ts` 的恢复使用真实native factory但内存authority。本轮在同一流程实际使用 `DistributionStore`、Windows `OwnerGuard`、SQLite journal/receipt/high-water/archive、临时Ed25519真实验签，以及 `loadWindowsDistributionFiles` 加载的真实C#相对句柄工厂。

**没有真实kill。** 中断由正式事务检查点抛出 `SimulatedDistributionCrash`，使该次服务跳过常规回滚；随后真实关闭旧Store/OwnerGuard、确认metadata owner.lock消失，再重新打开SQLite/获得OwnerGuard并创建新的TransactionService恢复。它证明正常close/reopen后的跨owner恢复，不冒充OS进程被强杀、断电或正式EXE中断验收，也不把同一Node进程内的新owner对象说成独立进程重启。

## 四项实际断言

| 场景 | 已观察到的行为 |
| --- | --- |
| published后中断 | 目标已发布、暂存与目标同inode且nlink=2，receipt未提交。活owner的canRecover=false，真实第二Store.open报STORE_BUSY，新service用原活owner恢复报NEEDS_RECOVERY。journal/receipt/根identity/目标/玩家文件/lease前后完全相同。实际关闭重开后canRecover原token=true、错token=false；新service native回滚为rolledBack，目标消失，原字节及inode保留在本人rollback路径，lease释放，高水位不回退。 |
| receipt-committed后中断 | 真实SQLite收据已提交且revision=1。活owner同样拒绝第二open与恢复且现场不变；关闭重开后新service native finish为committed，目标内容/inode保留，暂存链接删除、目标nlink=1，lease释放，receipt与journal.afterReceipt精确一致。 |
| gameDir被替换 | 中断后关闭旧owner，将原目录改名，在同路径建立新目录及玩家文件/外来lease。新owner可以识别旧journal，但恢复被持久gameIdentity拒绝FILES_CHANGED；新旧目录、原lease/外来lease、journal、receipt和高水位均保留。 |
| gameDir出现外来lease | 中断后关闭旧owner，仅用合成外部写入替换游戏lease内容。重开owner仍只认旧journal token；恢复报INSTANCE_BUSY，未删除外来lease，目标、玩家文件、journal、receipt和高水位与尝试前完全一致。 |

两个成功恢复场景还实际重复调用terminal recover，结果相同且journal revision/receipt完全不变；factory记录恢复时收到的expectedRoot为原v2 journal的真实dev/ino。玩家自有文件始终保留，未用文件名、裸gameDir收据、PID或时间推断恢复所有权。

逐场景证据：

- [published回滚](authority-evidence/published-39740d2b-2f46-4771-b6df-b6d2f4a42cfb.json)
- [receipt提交后完成](authority-evidence/receipt-committed-76c7b69e-e7cc-49f0-af08-1d104246e513.json)
- [同路径namespace替换拒绝](authority-evidence/replacement-root-9b05fe57-e8f7-446f-b583-04564a7b8042.json)
- [外来lease保留](authority-evidence/foreign-lease-9423697b-16b6-4031-a70a-b23361d5a1b5.json)

其中before/afterReopen/terminal等值来自实际SQLite读取、实际文件摘要和inode；活owner第二open的STORE_BUSY等结果由测试源中的严格错误码断言执行，成功记录见tests.log，不另造一份未实际捕获的原生异常日志。

## 来源与命令

测试源已冻结，SHA-256：`dc6a15113e7718e6e14dccbdc5bedaa34c3c664c6be4125f09c6bd49f6ec073e`。

本次实际重新编译helper为21504字节，SHA-256 `926d119d16ce203000f395dba01db92edd4d1e7187ce471703840c40f6bef559`。guard源SHA-256 `547143af5a6d24469208c5808fd4b0bdcbf828ccf401911557e6e4de8379657f`、Program源SHA-256 `aba0b8632d4de64d548e358c7f8eabc103d241c2e668ffcf1f5d918aa651705d`；Store、TransactionService、Node factory源码摘要见status.json。

独占根 `D:/MC_start/OUCL/tmp/native-authority-20261117`。esbuild使用bundle=true/platform=node/format=esm/target=node24编译新增测试，运行：

```powershell
$env:OUCL_TEST_ROOT = 'D:\MC_start\OUCL\tmp\native-authority-20261117'
$env:OUCL_AUTHORITY_EVIDENCE = Join-Path $PWD 'docs/execution/20261117/authority-evidence'
node --test "$env:OUCL_TEST_ROOT/distribution-native-authority.test.mjs"
node ../../node_modules/eslint/bin/eslint.js tests/distribution-native-authority.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit
```

测试内实际调用现有helper构建脚本，输出仅到本独占root的 `native-authority/build/native/`；通过已验证metadata loader装配工厂，不换成cooperative适配。需要硬链接的运行通过require_escalated正常自动审查。临时Ed25519私钥只存在内存，信封获取为注入Response，无真实网络；制品是synthetic普通文字，不是合法JAR、Mod许可证、Minecraft运行或外部真实发行的验证。

没有产品缺陷或失败需整改，未重跑完整回归或扩展场景。真实来源/公钥仍为空；主协调负责统一完整检查、打包与提交，不由本轮4项测试自行开放公共执行。

独立只读复核确认真实Store/OwnerGuard/native接线与4项原始结果一致。拒绝前后不变限已断言的journal/receipt/high-water/root/target/player/lease事实，不宣称全目录或SQLite页级零写审计。
