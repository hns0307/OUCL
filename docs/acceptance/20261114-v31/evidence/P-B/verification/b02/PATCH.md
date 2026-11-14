# B-02 精确候选变更

候选基线：`D:/MC_start/OUCL-download-main` HEAD `096dd22e402ef6af58e49b7cdb89a1b4fdcdb07e`；候选 `D:/MC_start/OUCL-review-round-20261114/P-B/verification/b02/candidate`。只列出三个拟交协调者整合的生产文件；未修改 B-01 文件。

| 相对路径 | 原 SHA256 | 候选 SHA256 | 改动 |
| --- | --- | --- | --- |
| `src/services/storage/tasks.ts` | `d41a767585ea1ec1f9efdaa78a046d86a75ebb03bc506887e96c1b86802540ce` | `c21e7a016e253ea1adda0b384271a81b2761b534495140d4a569db1311a00a6e` | 私有库存方法接受可选预算回调，在每域、两次固定 SQL 查询前后及每条已取记录处理前检查；默认调用不变 |
| `src/services/storage/records.ts` | `d2d9b32eab8686bd6f084d07c6a131bd9b04505c91715946fa350ecab0513cdf` | `571ab94bd1850967bbc01b5ec344a99e5cb62296b65e0034ee2d73da75ecfe34` | 串行读取传递回调；仅当该回调实际抛错时恢复其原始异常对象，其他错误保持原包装语义 |
| `src/services/workers/mod-targets.ts` | `c84381f0c29d1abfc6140e0e8db257e924cf5f3da5349f69a28b128723108812` | `acc02b9254b20532b2f29f70c5e83f86928cd0e797bd01d2d54f5de5add2df7d` | 将既有 2000ms deadline 检查传到库存，不更改 deadline、IPC 或存储格式 |

精确差异：[tasks.patch](evidence/tasks.patch)、[records.patch](evidence/records.patch)、[mod-targets.patch](evidence/mod-targets.patch)。原始复制源清单共 227 条，见 [source-sha256.json](evidence/source-sha256.json)。所有差异均为只读比较，未执行 Git 暂存或提交。

新增测试 `candidate/tests/b02-deadline.test.ts` SHA256 `3f76a541fc7374491f7e75b136f18e44c81bb644b8522070bb2a0f4839509a48`；独立测试构建器 [build-fixture.mjs](build-fixture.mjs) SHA256 `ebba45317ebbc22b7d852b6dfe386f6608b5fd41b2ebeda530a83c52e75d80ec`。构建器在测试 bundle 注入受控时钟/计数，硬编码本包和既有工具链路径，**不是待合入的生产 worker**；协调者如需纳入可移植测试，应适配路径而不把注入写进产品。候选专用 `tsconfig.b02.json`、证据输出及生成的测试根亦不属于产品变更。

候选局部证据及限制见 [RESULT.md](RESULT.md)。尚未运行完整应用构建/全量回归，也没有真实慢盘实测；不对单次 SQLite 查询提供硬实时中断保证。只有统一协调复核并安排相应整合后才可进入统一候选。
