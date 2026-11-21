# Node→C# 原生文件适配独立评审与真实集成测试

2026-11-16。子任务独占 `tests/distribution-native-files.test.ts`、本报告和 `native-review-evidence/`；不修改wrapper、事务、C#helper或构建脚本，不提交Git。真实用户目录/游戏、正式EXE与原WIP均未参与。

## 当前结果：不能接纳为产品执行能力

最终在 **ShareRead-only目录guard源码** 下重新构建helper后，完整wrapper测试实际 **12项：6 PASS / 6 FAIL / 0 SKIP，exit1**。没有修改失败断言、没有增加跳过或通过回退共享权限制造绿色准入。原始记录：[测试输出](native-review-evidence/native-wrapper-tests.log)、[退出码/来源摘要](native-review-evidence/status.json)。

当前失败helper为17408字节、SHA-256 `9e789a6df4f067c272cf92bb4cffe99fa480bc4d6a415674de6a9dc826b347d0`。guard源SHA-256为 `be938779d475ced978bae8abb3dcf1545da3afff048778fb5de6fb449b96f380`；Program、Node wrapper、测试源摘要均在status.json。编译在测试进程中调用真实构建脚本，输出只到独占root，没有使用旧EXE假冒此次源码结果。

**明确阻断：**ShareRead-only虽为阻止目录reparse写入提供了准入方向，却使当前路径型native link/rename正常操作返回失败。Node wrapper将其映射为NEEDS_RECOVERY；占位目标用例预期FILES_CHANGED但获得NEEDS_RECOVERY，正常factory、两个恢复场景和loader成功用例也失败。native作者的独立原生测试同时得到13项8PASS/5FAIL，并报告占位rename的原始helper code=FILE_BUSY，证据位于其 `native-helper-evidence/`。这不是只在Node wrapper出现的异常，也不是本轮已证明的沙箱权限问题。

发现后已即时通知主协调和helper作者，未继续盲跑参数组合。主协调后续决定冻结失败证据、仅回退目录shareflag保存功能候选，并继续独立的逐级relative-handle安全方案。本报告不把后续回退候选当作ShareRead-only通过，也不在该决定后追加wrapper重跑。该候选状态应保持 **NOT_ADMITTED_REPARSE_ATOMIC**，未接main执行能力。

## 12项真实测试与层级

| 组别 | ShareRead-only最终结果 | 边界 |
| --- | --- | --- |
| 正常link→delete→rename→delete→release | FAIL | 首个正常流程不能取得成功回执，后续步骤不计通过 |
| 已有目标的rename/link不覆盖 | FAIL | 失败分类与预期不同；不能把未运行到的后续保留断言称为通过 |
| wrong inode/dev/hash/size | PASS | 真实helper拒绝，源内容保留，目标没有生成 |
| wrong root identity/lease token | PASS | 拒绝发布，现有lease保持 |
| 原root改名后新建同路径namespace | PASS | 旧dev/ino不能授权新目录修改，旧/新文件保留 |
| helper binary hash mismatch | PASS | Node PIN检查拒绝，原本有效发布没有效果 |
| 路径与DTO | PASS | escape、saves、其他tx staging、ADS、设备名、未知字段、非法release/source、额外destination拒绝 |
| 真实native factory文件流程 | FAIL | 当前helper无法支撑正常发布/回滚移动整条路径，不能记native事务闭环通过 |
| published中断后新service恢复 | FAIL | 在预期中断点前已NEEDS_RECOVERY，未得到当前helper的恢复通过证据 |
| receipt-committed中断后新service恢复 | FAIL | 同上，不能把未到达的提交后恢复记为通过 |
| 打包metadata loader正常加载并执行 | FAIL | metadata加载可继续，但当前原生正常发布失败，整项不通过 |
| metadata/二进制篡改拒绝 | PASS | 未来版本/未知字段/文件名越界/错hash/错size/坏JSON/同长度EXE字节篡改不能获得factory |

测试均使用真实Node进程、真实框架csc编译、真实C#helper进程、真实NTFS普通文件及Node `lstat({bigint:true})` 的dev/ino和SHA-256。调用为stdin固定JSON，非shell命令，没有网络。发布内容为明确synthetic普通文字，不是Minecraft JAR、Mod许可或游戏验收。

两个恢复用例使用正式TransactionService、v2 journal和真实gameIdentity，明确指定 `createWindowsDistributionFiles` 工厂；记录工厂在初始commit与新service recover各调用一次，recover传入持久journal的原root identity。journal/CAS/receipt和canRecover为明确注入的内存fixture，不冒充真实私有OwnerGuard重建证明。当前ShareRead-only失败导致两用例未到达断言；此前ShareRead|ShareWrite版本的9项曾通过（含published恢复），那是不同源码版本的历史功能证据，不能转移成当前安全准入。

## 只读代码评审

已核对Node wrapper固定操作白名单、精确context/proof字段、区域/tx staging路径、单次stdin尺寸、helper字节hash、无shell/隐藏子进程、有限stdout/stderr，以及超时后等待本人子进程close再拒绝的语义。loader只接受固定文件名和exact版本化metadata，并复核字节数与hash；其信任前提是metadata和EXE共同属于受保护、已验证的应用载荷，不是允许用户指定任意helper目录。

C#使用当前文件handle读取/验hash，Node proof没有先转成有损Number；持有source和祖先handle以将验证与mutation约束在同一对象，rename请求不替换标志、link不覆盖既有目标、delete/release绑定同handle。**但当前sharing与正常路径型mutation不兼容，源码设计不能替代失败运行结果。**源作者已把UUID允许版本对齐Node的1—8，避免先前v4-only解析差异；本轮不以此小修复覆盖目录准入失败。

未发现需要本子任务擅自修改产品的其他已复现问题。未来relative-handle方案必须在明确新源码/二进制身份下重新验证正常操作、占位保护、外部reparse/目录替换、所有权与恢复，不能复用本轮失败候选的“正常运行”结论。

## 命令与静态检查

独占root为 `D:/MC_start/OUCL/tmp/native-adapter-review-r2`。编译测试用已安装esbuild bundle=true/platform=node/format=esm/target=node24，输出 `distribution-native-files.test.mjs`；实际执行：

```powershell
$env:OUCL_TEST_ROOT = 'D:\MC_start\OUCL\tmp\native-adapter-review-r2'
node --test "$env:OUCL_TEST_ROOT/distribution-native-files.test.mjs"
```

每个测试进程首次helper请求会实际调用 `node scripts/build-distribution-files.mjs`，OUCL_BUILD_ROOT指向本root下 `native-files/build`。此次需要硬链接的运行经require_escalated自动审查批准，只触及合成fixture与独占证据目录。构建成功不代表mutation通过。

最终本测试源局部ESLint **exit0**，整仓 `tsc --noEmit` **exit0**；它们不掩盖真实12项6失败。统一完整回归、最终源码选择和本地提交由主协调处理。本子任务已停止扩大测试范围。

## v4 相对句柄后继轮：原12项全部通过

在helper作者明确production转换完成、源码冻结及其独立14项通过之后，按主协调新指令，仅对**新的v4相对句柄实现**重建一次并复跑原12项wrapper测试；没有改变测试文件、正常/占位/错误身份/根绑定断言，没有新增case或修改产品。

实际 **12 PASS / 0 FAIL / 0 SKIP，exit0，3168.0891ms**。新证据为 [v4原始输出](native-review-evidence/native-wrapper-relative-v4-tests.log)、[v4退出码及源码/二进制摘要](native-review-evidence/status-relative-v4.json)。旧 `native-wrapper-tests.log`、`status.json`、`checks.json` 的ShareRead-only 6PASS/6FAIL历史保持原样；本节记录不同源码的后继结果，不将旧失败改为PASS。

本轮测试根为 `D:/MC_start/OUCL/tmp/native-adapter-review-r2-relative-v4`；测试进程实际调用构建脚本生成21504字节helper，SHA-256 `2cf0bcbc887386adc46bc73802fd9ac268318cf9ce7c8bde14b369bfa7927b96`。guard源码SHA-256 `547143af5a6d24469208c5808fd4b0bdcbf828ccf401911557e6e4de8379657f`，Program源码SHA-256 `aba0b8632d4de64d548e358c7f8eabc103d241c2e668ffcf1f5d918aa651705d`；测试源SHA与旧轮完全相同 `c45a1bc2c72cd69f6c5aaa42414bfb486aa7a24b7f82b8a22717bc7e8674a315`，Node wrapper源SHA也未改变。

新实现采用NT相对目录handle打开与目标leaf变更接口；独立原生作者负责实际FSCTL攻击/祖先guard准入测试。本子任务只按原范围验证Node→helper接线：正常link/delete/rename/release、先占目标保护、wrong inode/dev/hash/size/token/root拒绝、同路径新namespace拒绝、helper pin、路径/DTO及loader metadata/EXE篡改拒绝，全部实际通过。

两个正式TransactionService恢复场景也确实到达预定注入点并完成：published后丢失服务时，新的service通过native factory恢复为rolledBack，目标移入本人rollback保留、目标路径消失且lease释放；receipt-committed后丢失服务时，新service恢复为committed、目标内容保留、暂存链接删除、nlink=1且lease释放。两者v2 journal均持久记录真实gameDir inode，recover工厂收到相同expectedRoot；metadata/CAS/canRecover仍是明确的内存测试端口，不冒充真实OwnerGuard接管验收。

本轮局部ESLint及整仓TypeScript静态检查再次运行，结果归档为 `checks-relative-v4.json`。当前只闭合本子任务的真实wrapper/恢复/loader层级；完整回归、独立native攻击审查、打包及是否开放产品执行由主协调统一判断，不由12项测试替代。真实来源/公钥仍为空，没有新增公共执行能力或真实游戏验收。测试文件现已冻结，未自行提交Git。
