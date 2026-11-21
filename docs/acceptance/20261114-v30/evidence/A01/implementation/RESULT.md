# A-01 最小对象根租约实现交付

2026-11-14。状态：**独占非Git候选实现及必要局部检查完成，待统一管理者全量审计/构建/接纳**。没有修改main、C隔离Git、活跃共享树、旧锁或旧游戏根，没有GUI；A-02未修改。

## 基线、范围及交付

`candidate/`为main `262d757ecad08add5a0db16817b2adab01b98149` 的392份源码/测试/工具配置普通文件副本，初始逐文件SHA见 `BASELINE.json`。只改变五份交付文件：

1. 修改 `src/services/objects/store.ts`：取得对象域租约、排队前后及关键异步/发布边界核验、关闭排空并拒绝新接纳。
2. 新增 `src/services/objects/owner-lease.ts`：Windows对象根专用SQLite OS排他、guard及根身份绑定、固定域和兼容标记、新格式恢复、旧/未知证据停写；非Windows保持UUID wx互斥，不无故禁用。
3. 新增 `tests/object-owner-lease.test.ts`。
4. 新增 `tests/fixtures/object-owner-child.ts`。
5. 新增 `docs/contracts/OBJECT_OWNER_LEASE.md`，解释私有协议和初始化边界。

`PATCH.diff`为以上五文件的标准统一差异；`CHANGES.json`、`CANDIDATE-HASHES.json`明确基线/候选SHA及其余文件保持。metadata `src/services/storage/owner-guard.ts`、InstallerService/runtime缓存、IPC/JSON/表/依赖均没有变动。只新增对象域严格薄实现，没有抽取/参数化metadata机制。

## 实际局部验证

| 运行 | 真实结果及证据 |
| --- | --- |
| r1 | 未完成。main顶层缺smol-toml导致类型/worker环境失败，夹具等待；取消自建控制命令exit1，目录和command保留。未落盘stdout的限制见local-r1/INTERRUPTED.md，不伪造失败输出 |
| r2 | 控制器Windows --import路径缺file URL，两个测试文件加载失败，exit1；local-r2/stdout.log保留，不算服务断言结果 |
| r3 | 初版实现的对象租约+既有对象存储局部测试26PASS/0FAIL/0SKIP，exit0；local-r3/execution.json与stdout.log |
| r4 | 最终对象身份/sidecar修订后的六组局部测试57PASS/0FAIL/0SKIP，exit0；local-r4/execution.json与stdout.log。包含新对象租约、objects、file-views、install-downloads、download-artifact及既有metadata owner-guard测试 |
| 类型检查 | `node node_modules/typescript/bin/tsc --noEmit` 全候选配置，最终exit0，typecheck-final.log；首轮TS2307另保留，私有补用同版本后typecheck-r2亦exit0 |
| 局部lint | `node node_modules/eslint/bin/eslint.js src/services/objects/store.ts src/services/objects/owner-lease.ts tests/object-owner-lease.test.ts tests/fixtures/object-owner-child.ts`，最终exit0，lint-final.log |

运行工具链为Node24.21.0；编译使用既有esbuild，不安装依赖。最终candidate/node_modules联接统一管理者指定的 `D:/MC_start/OUCL-acceptance-v11-20261113/node_modules`。之前补用的本机已有smol-toml@1.9.0副本只在implementation私有工具目录，未改package/lock。run-local.mjs记录每轮命令、临时目录及实际退出；r2以后日志即时落盘，120秒自超时器若触发会exit124，r3/r4未触发。

**执行偏差明确保留**：r4扩展列表误带入基线 `tests/owner-guard.test.ts`，其中“new-format guard can be reacquired after real owner termination”在本轮独占临时根中调用既有`child.kill()`结束它自己新建的Node子进程。这超出本轮仅自行exit的约束，不应纳入本片新增自退出证明；未针对GUI、产品、旧进程或旧根，也未绕过CUA对bootstrap派生进程的拒绝。其余新增进程退出模型全部使用握手后的自身process.exit(73)。不隐去该既有测试或改写57的实际计数；没有为此追加重跑矩阵。

## 新对象域已实际覆盖

- 新对象marker严格前缀，metadata与对象域独立；不同profile的metadata可同时持有但同store竞争者仍STORE_BUSY。
- 新受控子进程成功open后自行exit73，metadata和对象guard均可重取；对象marker身份/字节保持，恢复后可实际创建staging，正常关闭可再次打开。
- 旧UUID、未知及新前缀截断、marker缺guard、空guard、guard内容损坏、同字节guard替换、guard硬链接均停写并保留证据。
- 迁移同guard inode到不同根仍拒绝，独立证明根身份不能被guard身份替代；复制guard/marker到新根也拒绝。
- 孤立-journal/-wal/-shm，以及运行中出现-journal，均保留阻断；不盲删或让SQLite自动回放未知guard sidecar。
- 运行中guard多链接、真实hash等待边界的marker移走/同字节替换，均停止后续对象发布；staging保留、对象未发布、没有index remember，lease失效后继续拒绝。
- close等待真实commit/checkpoint退出后才释放所有权，closing期间新接纳被拒，竞争者不能提前取得。
- 正式HashPool/StorageClient/对象提交在object-committed与proof-committed子进程自退出后恢复，孤儿对象不自动获得信任；rebuildIndex只恢复已有合法proof。既有objects/file-views及下载服务回归保持通过。

## 限制及交接

- 只承诺成功open之后的退出恢复；第一次空guard尚未完成schema、marker写截断和任何guard sidecar均安全阻断，未实现这些初始化格的自动恢复。
- 新根仍无法接管既有UUID对象锁，包括当前基线生成的旧锁；不以新guard可取得、时间/PID或metadata所有权猜测。
- 每次操作及关键await边界复验能检测已观察到的外部变更；文件API的check/use间仍非原子，无法保证任意外部非协作进程的隔离。
- marker在持锁时删除、OS句柄随后释放；兼容旧客户端wx窗口以取得前后的marker二次校验处理。本片未用真实旧EXE做竞争，属于待统一管理者评估的兼容层级。
- 非Windows仅保留原功能的代码路径，未运行非Windows平台测试；本片不声称其自动恢复。
- 未做全量单测、生产build/package、Electron/最终EXE强制中断或真实游戏回归，由统一管理者安排。原CUA归属拒绝继续有效。
- r1控制器中断、r2加载失败、r4误选既有child.kill用例均保留。原A-01复现文件与26断言前的历史报告未覆盖修改，本实现仅在implementation内。

交付即停止，等待统一管理者审阅及安排；不顺手处理A-02。
