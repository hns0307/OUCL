# E1 固定样本内部只读预览

2026-11-11。本聊天在明确询问“是否批准按该规格实现固定样本的正式只读预览，包括新增解析模块、专用 worker 协议和测试”后，用户回复“继续”；据此实施该有限增量。范围不包括公共IPC、原生选择器、导入、实例写入、ready提交、下载或游戏启动。公共TASK_PLAN/DECISIONS由共享工作区整合方处理；本记录保留真实原文，不替其他工作包改公共记录。

## 实现

- `src/core/packs/fixed-preview.ts`：固定样本事实与严格 `unknown` 结果，不能授权安装。Java17仅为目标要求，不声称本机已验证。
- `src/services/packs/fixed-protocol.ts`：私有绝对路径请求、严格回复字段及固定事实校验；路径不进入返回值。
- `src/services/packs/fixed-worker.ts`：校验受管路径祖先/普通文件句柄、1355字节和固定SHA256，再复用现有归档结构/CRC检查，核对客户端配置摘要；不写出文件、不执行归档内容。
- `src/services/packs/fixed-reader.ts`：单活动worker、有限期限、结构复验；取消、超时和错误等待worker退出。
- `tests/fixed-pack-preview.test.ts`、本包 `run-fixed-tests.mjs`：独立打包真实worker并测固定样本、不同内容、伪造回复、并发、重复消息、非零退出、超时及取消。

固定摘要先于ZIP解析，任何不同包均拒绝。因此这不是通用mrpack解析器；不同恶意包被摘要门禁拒绝，不据此声称已按E1全部归档预算逐项验证其他输入。回复固定为 `unknown/ENVIRONMENT_AND_MOD_NOT_VERIFIED`。结果没有planId、来源在线复验、磁盘容量、游戏环境/JAR闭包或确认权限。

生产默认构建尚未装配该专用worker或UI；独立验证用esbuild只输出到本目录。此实现可供后续集成审查，不宣称玩家可从产品界面使用。复用的现有ZIP解析上限更宽；本片仅能接受指定的1355字节及固定摘要，不能据此将其用于任意mrpack。未来扩大范围前须实现并验证提议的逐条独立预算、特殊ZIP/路径及完整协议。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `node docs/work-packages/P-E/run-fixed-tests.mjs` | 4 PASS，真实固定worker执行；没有跳过 |
| `node node_modules/typescript/bin/tsc --noEmit` | 通过 |
| `node node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts` | 通过 |
| `OUCL_TEST_ROOT=<本包evidence/20261111> node scripts/test.mjs` | 611项，607 PASS、0 FAIL、4 SKIP；新测试的2项依赖专用worker环境变量，在本轮全量命令中跳过，已由上述专用命令实际运行；其余2项为已有环境跳过 |
| `OUCL_BUILD_ROOT=<本包evidence/20261111/build> node scripts/build.mjs` | 通过，输出仅本包目录；默认构建未装配新worker |

`pnpm typecheck` 与 `pnpm exec eslint` 曾尝试触发共享node_modules重装/清理，在非交互环境中主动中止；未允许删除或重装。随后直接调用仓库已安装的同一TypeScript/ESLint入口完成检查。未修改依赖/锁文件，未触碰公共dist或公共.test-build。

未对玩家实例或旧EXE操作，未进行联网/游戏窗口、产品入口或故障恢复验收。本片目标是固定样本内部只读能力，1E完整导入仍未完成；后续公共接口、可信来源刷新、完整计划与安装事务须分别完成设计及授权。
