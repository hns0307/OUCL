# 执行首轮：既有 25 项失败的局部定位

日期：2026-11-15（Asia/Shanghai）。范围：交接文档任务 A，只读诊断；不修改生产源码、测试断言、依赖或测试跳过条件。依据为 main `05309ed7` 的服务与测试，原 `mod_loaders` WIP 不参与。已先读取本工作树 TASK_PLAN、DECISIONS、AGENTS 及 RECHECK。

## 结果与边界

| 既有失败组 | 本次证据 | 结论 |
| --- | --- | --- |
| 回环 HTTP/Range，2 项 | 两项原样复现失败；观测复跑取得原生 `connect EACCES 127.0.0.1:<port>` | 当前进程连接本机回环端口被拒绝，映射为 NETWORK_FAILED；不是已证明的下载算法缺陷，也不代表其他网络环境通过 |
| 链接准备，8 项 | 八项观测复跑均取得 `link` / `symlink` 的 `EPERM` | 测试准备所需的真实链接能力被拒绝，尚未进入欲验证的安全断言 |
| Mod 准备/事务，14 项 | 每项均在 `.oucl-mod-staging/<id>/root.jar` → `mods/root.jar` 的正式 `fs.link` 取得 EPERM；代表项原样复现 SCAN_FAILED | 这 14 项的本次直接失败点已定位为发布硬链接受限；后续事务、回滚、提交点断言因此没有按预期执行，不能标 PASS |
| Mod 真实进程终止恢复，1 项 | 本次不运行；既有日志为 `linked: child checkpoint missing` | 与链接失败相符但只是推断，保留未定位/未重新执行，不能并入已证实的 14 项 |

原样代表复现：3 项、0 PASS / 3 FAIL，未注入观测。随后仅选择既有失败中的非强杀用例：24 项、0 PASS / 24 FAIL / 0 SKIP / 0 cancelled，19.504 秒。此选择不是完整回归，也不是修改测试为跳过。最后一项按本轮不强杀约束未选择，不重新启动此前取消的强杀补证。

没有证据要求为 N1 UI 改动重写事务发布语义。当前硬链接发布不是与共享对象直接链接：正式代码先将对象复制到私有暂存，再链接到实例 mods。未经专门设计不能把它直接改为覆盖式复制或 rename，避免破坏独占创建、文件身份、回退证明及外部修改保留规则。

## 定位方法

使用 Node `v24.21.0`、已安装父目录 `node_modules/esbuild`，不经 pnpm 安装流程。通过原脚本相同的 `bundle:false / node24 / esm / outbase:.` 参数，将服务及测试编译到独占目录：

`D:/MC_start/OUCL/tmp/execution-baseline-20261115/.test-build`

独占 OUCL_TEST_ROOT 及 TMP/TEMP 避免 Windows 系统临时路径影响；未写共享 dist/.test-build。检查时 `git diff --name-only -- src/services tests/download-http.test.ts tests/download-parallel.test.ts tests/mod-preparation.test.ts tests/mod-transaction.test.ts` 为空；这些服务和测试仍是 HEAD 内容。

原样三项命令（先运行 compile.mjs）：

```powershell
$env:OUCL_TEST_ROOT = 'D:/MC_start/OUCL/tmp/execution-baseline-20261115'
$env:OUCL_SOURCE_ROOT = 'D:/MC_start/OUCL/本地资料/OUCL-download-main'
$env:TMP = "$env:OUCL_TEST_ROOT/tmp"
$env:TEMP = $env:TMP
Set-Location $env:OUCL_TEST_ROOT
node --test --test-name-pattern='production HTTPS policy|real HTTP parallel|add-only transaction' .test-build/tests/download-http.test.js .test-build/tests/download-parallel.test.js .test-build/tests/mod-transaction.test.js
```

观测脚本 `observe.mjs` 只包装 fs/promises 的 link/symlink 和 global fetch：调用原函数；发生错误时记录原始 code/syscall/cause；原样重新抛出同一错误。没有响应替换、结果替换、参数重写或成功回退。使用 `syncBuiltinESMExports` 让原生错误日志覆盖已有命名导入；不会把观测结果当未注入运行。24 个完整名称由历史失败日志提取，精确选择见 selection.json；实际命令参数及退出码见 observed-status.json。

生产映射路径：`src/services/mods/transaction.ts:184` 调用发布 link；`:218` 将未分类底层错误映射 SCAN_FAILED。14 项均已在这次观测日志中逐项取得 EPERM，而不是只靠错误码猜测扫描失败。8 项链接安全测试取得各自准备路径的 EPERM。两个 fetch cause 明确为 connect/EACCES，而非 DNS、TLS、Range 或哈希错误。

初次临时辅助脚本曾将 Windows 盘符路径直接用于 ESM import/--import，报 ERR_UNSUPPORTED_ESM_URL_SCHEME；改为 file URL 后执行。保留初次 observer 路径错误日志；这是诊断脚本启动问题，不计产品测试失败。后续脚本/原始日志均保存在下方目录，路径属于本次可复现证据，不是产品硬编码。

## 证据与下一步

后继复核补充：归档 `compile.mjs` 只编译服务/测试，不会复制 observer。首次从归档复现时，须在仓库根先运行 `node docs/execution/20261115/baseline-evidence/compile.mjs`，再执行 `Copy-Item -LiteralPath 'docs/execution/20261115/baseline-evidence/observe.mjs' -Destination 'D:/MC_start/OUCL/tmp/execution-baseline-20261115/observe.mjs'`，然后再运行归档 `run-observed.mjs`。这些脚本固定了本次本机路径，不是通用跨机器工具；迁移时须调整路径并保持独占目录。该补充没有重跑或覆盖原诊断日志。归档日志部分控制台符号/中文路径有转码，英文用例名和数字仍可核对；不应依赖损坏符号重新推导通过结论。

归档runner会写回其固定evidence目录；实际新一轮复跑必须先复制runner并将root/evidence改为新独占目录，保留本轮归档。上述顺序说明缺失的准备步骤，不是要求直接覆盖历史证据。

- [原样三项日志](baseline-evidence/untouched-repro.log)
- [24 项原生观测日志](baseline-evidence/observed-repro.log)
- [分类计数](baseline-evidence/classification.json)、[选择列表](baseline-evidence/selection.json)、[实际参数与状态](baseline-evidence/observed-status.json)
- [编译脚本](baseline-evidence/compile.mjs)、[观测脚本](baseline-evidence/observe.mjs)、[复跑脚本](baseline-evidence/run-observed.mjs)
- [初次 observer 路径错误](baseline-evidence/initial-observer-path-error.log)

本次没有新增 GUI/游戏、完整回归或 EXE 验收，也没有修复后全绿结论。原 RECHECK 的 691 项 662 PASS / 25 FAIL / 4 SKIP 及历史有限验收继续保留。N1 可按既有 DTO 独立实施并运行不依赖上述受限能力的相关测试。以后若需关闭这些失败，应在明确允许本机回环和真实链接的验证环境中重跑相同断言；不能通过改断言、全组 skip 或换用不具同样语义的生产路径取得绿色结果。
