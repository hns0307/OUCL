# A-01 精准服务层复现结果

2026-11-14（Asia/Shanghai）。状态：**缺口已由隔离服务层进程模型复现；安全修复尚未实施**。

## 本轮边界与代码身份

按统一管理聊天派发，只在本目录建立夹具、临时根和文档；没有修改生产候选、冻结源码、共享WIP、Git或旧数据。没有GUI、下载、游戏、shell kill或进程强杀。A-02未进入本轮。

来源：`D:/MC_start/OUCL-download-main`，运行前后HEAD均为 `262d757ecad08add5a0db16817b2adab01b98149`，工作树干净，`fab0ac8` 至HEAD的 src/tests/scripts/bootstrap/package/lock 差异为空。产品仍为 `fab0ac873f34d8581bf065e14fa7a9aa93c0baa3`。

`dependencies.ts`直接导入main的正式OwnerGuard/ObjectStore；esbuild编译进两个夹具，不复制或改写实现。Index/Hasher只提供“调用即失败”的占位依赖：本轮open/close没有实际索引、哈希或IO下载调用。Windows SQLite OS锁和文件API均为真实实现。`source-hashes.json`记录9个实际编译输入（6份正式源码、3份夹具），`source-after.json`确认运行前后全部不变；`compiled-source-audit.json`另比较source map内嵌实际输入字节与来源文件，避免仅记录未被编译的源码摘要。

关键正式源码SHA256：

| 路径（main下） | SHA256 |
| --- | --- |
| src/services/objects/store.ts | d00a9c8f5fc41d7da5369e198cbe64ae22806518148cd0f6bc4ed454f8e9c43b |
| src/services/storage/owner-guard.ts | 511447036a83470c08fb7e7f409f3869d1d615ea4e99089d605713e34a87f85c |
| src/services/storage/files.ts | f665a93efba82a5fd5bbaad58d50bfc9719339dc5264bc7f3c61effd114c4a17 |

## 实际命令和环境

```text
cwd D:/MC_start/OUCL-review-round-20261114/P-A/verification/a01
node D:/MC_start/OUCL-review-round-20261114/P-A/verification/a01/build-run.mjs
```

Node v24.21.0 / win32 / x64，既有esbuild 0.28.2，无安装依赖。编译目标node24/ESM；父夹具实际命令见 `invocation.json`：`D:/nodejs/node.exe .../compiled/verify.mjs`。父进程UTC 08:21:40.365开始、08:21:40.803结束，exit0，stderr为空；对应北京时间16:21:40。见 `execution.json` / `stdout.log` / `stderr.log`。后继物证只读快照命令为 `node .../snapshot.mjs`，不重跑服务场景。

新临时根：`case-HdNxwY`。受控子进程PID19640经IPC发出ready，证明已成功持有两个正式服务对象。父进程发送固定IPC `exit-without-close`，子进程再次确认对象可达后自行 `process.exit(73)`；其close事件exitCode73、signal=null。没有发送OS信号、终止其他进程或调用两个服务的close。子进程设有仅约束自身的20秒退出上限，本次未触发。

## 24项断言与核心物证

原始逐项结果：`case-HdNxwY/result.json`，24/24通过。这里“通过”表示缺口被预期复现及控制组成立，不表示修复通过。

| 精确场景 | 实际结果 |
| --- | --- |
| 子进程持有metadata guard及对象锁时，父进程竞争同metadata | STORE_BUSY |
| 同时竞争同store | STORE_BUSY |
| 不同profile取得独立metadata guard，随后竞争同store | 独立metadata可取得，store仍STORE_BUSY |
| 子进程自行exit73后重新取得同metadata guard | 成功，token与退出前完全一致，证明该OS锁已释放并可恢复 |
| 已重取metadata guard后打开同ObjectStore | STORE_BUSY，复现A-01 |
| 被拒后读取原对象锁 | 36字节，字节与退出前相同，未删除或改写 |
| 正常close控制组连续两轮 | 两个竞争者均拒绝；按store→metadata关闭后两个标记均消失，第二轮可重新open |
| 旧UUID及未知字符串，分别写入新临时metadata/store根 | 两类服务全部STORE_BUSY，四个标记字节全部保留 |

保留的对象锁为 `case-HdNxwY/abrupt-store/objects.owner.lock`，SHA256 `27b50f08f4f3f65fc6337fc6bfda3d5ce573315aad070353939605c6040e39e7`。子进程ready/exiting两次IPC、token及退出状态均在result.json。metadata恢复后仅由其新合法持有者正常close，故metadata owner标记已删除；guard数据库仍保留。其余旧/未知标记与失败对象锁作为物证保留，没有清理临时根。

`ARTIFACT-SHA256.json`列出夹具、bundle/source-map、原始结果、保留锁/guard数据库和本文及设计的SHA256、文件身份与链接数；清单自身明确排除。没有把随机锁摘要当成持有者失效证明，失效证明来自本轮自己创建并等待close的子进程生命周期及后续实际取得SQLite排他事务。

## 结论及限制

A-01从静态风险升级为**本地正式服务层已复现**：metadata的OwnerGuard可恢复不意味着ObjectStore可打开。当前ObjectStore仍新建无身份的UUID锁，成功open后进程异常退出即可遗留阻断；不仅是古老版本迁移问题。

本模型是显式process.exit省略清理的受控Node进程退出，不是真实最终EXE强杀、断电或游戏生命周期；不包含对象写入/来源证明提交中的崩溃。因此A最终EXE强制中断仍DEFERRED，CUA归属限制未变化。本轮也没有复现A-02、实现新租约、运行完整回归或重新验收v11/v12。

修复建议和阶段边界见 `DESIGN.md`，等待统一管理者审阅后再派实现。
