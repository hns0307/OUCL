# D-01 标准回归与 lint 收尾

候选生产文件相对上一版仅补 `AggregateError` 的 `{ cause: error }`，保留直接原始错误；标准探针断言 `cause === errors[0]`，覆盖保存和收敛同时失败及仅保存失败两种路径。未改状态机、公共 runner、依赖、IPC 或持久字段。

- 基线 service SHA256：`1646843329cf4a1b555e0e5d1524074185a994d8a7542eebc05920083c15024a`
- 更新 service SHA256：`214080d91810e4213a715042614e74114314faeb4d0b00b842d7dbb5fa917429`
- 更新 candidate.patch SHA256：`020ffe6a217c6aeee854a490999ca0f45e527673d731ee0b79e8d616ccd83802`

新增文件及 SHA256：

- `tests/launch-storage-recovery.test.ts`: `b29cb80b044cb22e6e20f4e7a5f6b350145c29ea6fccf1193514c10338b1e36d`
- `tests/fixtures/launch-storage-recovery/probe.mjs`: `155c795d179211c2fc9f4250aaca04556a88d0b12b35fcd68e3f3b1fa6fe9209`
- `tests/fixtures/launch-storage-recovery/budget-probe.mjs`: `3d4bd69e26779ff1c4329c6a4f1d16adcd0bb7e8371bee2a60a3fefcc4b661cd`

三个文件均位于本目录 `candidate/` 下，可按以上相对路径复制到统一候选。`.test.ts` 使用 `OUCL_SOURCE_ROOT` 或 cwd 定位源码、用源码根现有 node_modules 获取 esbuild，以 `mkdtemp(tmpdir())` 生成隔离 bundle，调用两个可移植探针并在退出后清理自己的临时目录。测试替换纯启动计划并使用受控存储、进程等替身；不代表真实 SQLite、worker 故障或游戏验收。

局部验证：

- 在 candidate 根执行 `node node_modules/typescript/bin/tsc --noEmit`：退出 0；该候选含 src 和新增测试，没有复制完整仓库 tests，因此不称完整仓库 typecheck。
- 执行 `node node_modules/eslint/bin/eslint.js src/services/launch/service.ts tests/launch-storage-recovery.test.ts tests/fixtures/launch-storage-recovery/*.mjs`：退出 0，无豁免或放宽规则。
- 依仓库测试构建方式 esbuild 编译该单个 `.test.ts` 到独立 `OUCL_TEST_ROOT`，设置 `OUCL_SOURCE_ROOT` 后执行 `node --test`：1 测试通过、0 失败、0 跳过。测试内两探针均运行成功，包含原 D-01、预算、CAS、活动任务及原因断言；未运行完整测试集。

候选通过目录联接只读复用现有 node_modules；无依赖安装。独立候选的 tsconfig、eslint 配置和该联接仅供本地验证，交接只需上述三个新增测试文件和单独提供的生产补丁。唯一 LaunchService 所有权前提和软预算限制仍如 RECOVERY-PLAN.md 所述。
