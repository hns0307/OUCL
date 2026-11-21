# P-E 只读入口准备与内部错误修正

日期：2026-11-11。用户指示“继续”；本次在已授权的固定样本内部预览内修正错误分类，并提出下一产品入口的具体审批稿 [E2方案](E2-INTEGRATION-PROPOSAL-20261111.md)。方案不是公共契约或实施批准。

## 实际变更

`src/services/packs/fixed-worker.ts` 与 `fixed-protocol.ts` 区分 `INVALID_SAMPLE`、`READ_FAILED`、`UNSAFE_PATH`、`WORKER_FAILED`，不返回路径或原始异常。先在16MiB有界普通文件读取内判定样本实际大小和SHA256；固定摘要校验、实际归档检查和最终unknown状态保持。`readRegular` 将超16MiB和不安全路径合并为 `UNSAFE_PATH`，所以界面不能将此码直接解释成发现恶意链接，产品入口仍须解决提示语义。

`tests/fixed-pack-preview.test.ts` 补真实worker对1356字节文件、文件不存在、目录目标的验证；原有固定样本、错误摘要、伪造回执、取消、并发/超时/退出测试保留。没有接入UI、公共IPC、产品worker构建、安装任务或持久格式。

E2方案给出单次 `packs:inspectFixed` 的完整请求、两种成功回复、固定错误表、sender/超时/窗口关闭/并发与文件选择生命周期、拟改公共文件及验收。实际共享工作区中 `src/main/index.ts` 相关构建与UI周边已有其他聊天工作，应协调文件所有权，不得覆盖。原始E1报告描述首次实现；本文件是后续错误分类的更新。

## 本轮实际检查

| 检查 | 结果 |
| --- | --- |
| `node docs/work-packages/P-E/run-fixed-tests.mjs` | 4 PASS / 0 FAIL / 0 SKIP；真实专用worker，包括新增3个错误分支 |
| `node node_modules/typescript/bin/tsc --noEmit` | 通过 |
| `node node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts` | 通过 |
| `OUCL_TEST_ROOT=<本包evidence/20261111> node scripts/test.mjs` | 614项，610 PASS / 0 FAIL / 4 SKIP；两项新worker测试在全量命令无专用worker环境变量时跳过，已由专用命令执行。完整输出 [e2-test.log](evidence/20261111/e2-test.log) |
| `OUCL_BUILD_ROOT=<本包evidence/20261111/e2-build> node scripts/build.mjs` | 通过；默认产品构建仍没有装配本包独立worker |

测试和构建发生在共享工作区存在其他未提交改动的情况下；结果证明本轮运行的工作区组合，并非其他工作包最终验收。所有测试/构建输出在P-E内；未运行公网、游戏或产品界面测试。未修改公共计划/审批记录、依赖或锁文件。
