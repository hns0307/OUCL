# D-01：提交许可回执丢失与状态收敛

结论：受控夹具复现任务停留 `committing`，存储恢复及 LaunchService 重建后仍未收敛；没有进入替身的 spawn 分支。该结果证明指定控制流及内存替身中的持久事实，不代表真实 SQLite、真实 worker 崩溃或实际 JVM 的端到端结果。

## 方法与结果

`build.mjs` 从 `OUCL_SOURCE_ROOT` 打包正式 `LaunchService` 和真实任务状态机；只替换纯启动计划函数，安装器、配置、存储和进程为受控替身。替身先保存 `verified` 导致的 `committing` 更新，再抛出回执丢失错误；随后 get 与会话保存均失败一次，之后恢复。调用真实 finalize 和 commitPermit；许可成功返回之后的计数模拟 spawn。`probe.mjs` 断言通过，完整输出见 `probe.log`。

- 丢失回执 1 次，随后 get 失败 1 次、会话保存失败 1 次；spawn 计数 0。
- 恢复后持久替身任务为 `committing`、revision 4；会话为 `spawned: false`、`unknown`，没有错误记录。
- 原服务查询和重建后的查询均返回上述状态；两次取消均返回 `INVALID_TASK_STATE`；相同请求重试均返回原任务 ID；原服务正常 close。
- 本次只模拟存储可用性恢复和服务对象重建，没有重启真实 worker 或数据库进程。

直接原因：提交许可更新的回执丢失后，`change` 尝试读取但读取失败；外层异常处理先保存会话错误，保存失败使后续 `interrupted` 状态转换未执行，job 最终移除。初始化仅处理会话 running/stopping，不处理遗留提交态任务。

## 建议设计（未实施）

异常处理应将会话错误保存与任务收敛解耦：即使会话保存失败也保留待收敛事实，在存储可用时重新读取权威任务，按现有状态机保守转 `needsRecovery`，使用 revision 比较写入并处理冲突；不要在无法确认时声称成功或允许运行。重启时对已登记会话对应的非终态启动任务进行有界、幂等的同类收敛。必须结合现有唯一服务所有权与实际活动任务核验，防止将仍由其他有效服务执行的任务错误中断；真实进程是否存活不应由 `spawned: false` 单独推断。保存再次失败保持可重试，不以界面提示代替持久收敛。

建议不增加 schema 或 IPC，但它改变恢复时序和启动服务行为；本文件仅为设计建议，需协调者核对已批准 P-D 首片和恢复边界，若超出现有批准则先取得明确批准。需补充真实 worker/SQLite 故障注入、并发所有权、回执丢失前后及多次重启的验证，再考虑产品整改。

## 复现

PowerShell 设置 `OUCL_SOURCE_ROOT` 为被测源码根、`OUCL_TOOLCHAIN_ROOT` 为含现有 esbuild 的工具链根，在本目录依次运行 `node build.mjs`、`node probe.mjs`。构建产物写入本目录；不安装依赖或修改产品源码。
