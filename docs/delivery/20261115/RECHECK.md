# 技术方案重建与本轮复核

日期：2026-11-15（Asia/Shanghai）。用户先要求重新验收，随后明确“按照已交付的内容重新生成技术方案”。本轮完成已启动检查、产物复核和文档重建；不再扩展新 GUI/游戏测试，不恢复此前取消的强杀/公网取消补证。

## 1. 交付

- [OUCL 0.3.0 技术方案](../../TECHNICAL_PLAN_0.3.0.md)：已交付能力、职责、存储、IPC、安全、下载/启动/Mod 链路、产物与验收边界；参考设计仅列待批准候选。
- 本轮读取 main 为 `05309ed7`。在 git archive 冻结副本上检查，未把 mod_loaders 未提交工作树当成交付基线。
- 未修改生产源码、依赖声明、契约或数据格式；未新打包、替换正式 EXE、运行游戏或公开发布。

## 2. 实际结果

| 检查 | 结果 | 解释 |
| --- | --- | --- |
| 正式 EXE SHA-256/大小 | PASS | 410112 字节，`6d4f7f25d29a06b4d3730fd79ad64a160dbcdb28f747e20eda1ce05f98cc690e` |
| EXE 内嵌 ZIP 九文件 | PASS | 通过 .NET 只读资源提取逐项计算长度/SHA-256，全部匹配既有交付审计 |
| TypeScript | PASS，exit0 | 直接调用已安装 TypeScript 6.0.3，`--noEmit` |
| ESLint | PASS，exit0 | `src tests scripts vite.config.ts` |
| 完整单测与覆盖率脚本 | FAIL，exit1 | 691 项，662 PASS / 25 FAIL / 4 SKIP / 0 cancelled，约 71.71 秒 |
| 构建 | PASS，exit0 | Vite/esbuild 完整构建七个产品文件 |
| 构建文件与交付摘要 | 5/7 字节一致 | main 和 entry worker 摘要不同；进一步逐注释行比较仅依赖位置注释不同，移除 `// ` 行注释后文本完全相同；不称逐字节可复现 |
| 引导器检查 | PASS，exit0 | 34 项归档、摘要和参数转义检查 |
| 新 GUI/游戏验收 | NOT_RUN | 用户后续转为技术方案交付，本轮未启动窗口或 Java 游戏 |

历史 v31 的 687 PASS/0 FAIL/4 SKIP 与本轮结果是不同环境/运行记录，均保留。不得把历史全绿覆盖本轮失败，也不得仅凭本轮受限失败判定正式 EXE 已损坏。

## 3. 失败与环境限制

main 整理后的 node_modules 不完整。最初 `pnpm check` 在测试启动前返回 `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`；后续 `pnpm test:bootstrap` 尝试恢复依赖并遇到 npm DNS/网络失败，已停止。未通过放宽权限、联网安装或更改锁文件解决。

在独立源码副本中直接使用已存在的父目录依赖，不再经 pnpm 启动安装。运行 Node v24.21.0；TypeScript 6.0.3、ESLint 10.13.0，构建日志记录 Vite 8.3.5。

25 个失败包括：

- 2 项真实回环 HTTP 适配/并行 Range 测试报告 `NETWORK_FAILED`，本轮未进一步定位根因。
- 8 项链接安全测试在准备软/硬链接时明确报告 `EPERM`；本轮环境也不能创建用于依赖复用的 junction，保留失败，不改测试为跳过。
- 15 项 Mod 准备/事务测试出现 `SCAN_FAILED` 或终态/异常断言不一致；一些流程依赖硬链接，但本轮未证明全部根因，不能将这组统一记作环境问题或产品已修复。

本次不做业务修复、不改断言，不因为用户转为文档任务而擦除失败记录。如后续要求继续验收，应在明确测试环境中首先局部复现这三组，再决定是否需要修复或完整回归。

## 4. 可复现命令与证据

冻结来源：`git archive 05309ed7 --format=zip`，解压后在独立副本执行：

```powershell
$env:OUCL_TEST_ROOT = (Get-Location).Path
$env:OUCL_BUILD_ROOT = Join-Path (Get-Location) 'dist'
node <已有依赖根>/typescript/bin/tsc --noEmit
node <已有依赖根>/eslint/bin/eslint.js src tests scripts vite.config.ts
node scripts/test.mjs
node scripts/build.mjs
node scripts/bootstrap-test.mjs
```

`<已有依赖根>` 是实际已安装的 node_modules 路径占位，复现时须选择与固定版本匹配的真实依赖，不能照字面执行。正式 EXE 审计只读取托管资源 application，不执行其 Main；比较对象为本目录既有 package-audit.json。

原始证据保存在 [recheck-evidence](recheck-evidence/)：typecheck.log、lint.log、test.log、build.log、bootstrap.log、package-verification.json、rebuild-comparison.json、bundle-difference-review.json，以及首次 pnpm 失败日志。空日志代表工具没有 stdout/stderr，exit 状态以上述实际执行记录为准。

## 5. 结论

技术方案可以以现有交付为依据使用，后续扩展仍须明确批准。本轮正式包完整性、类型、lint、构建与引导器检查通过；完整单测未通过，不出具“重新验收全部通过”结论。历史有限接纳和明确保留项不被改写。
