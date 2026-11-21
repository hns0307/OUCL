# N6内部耗时端口取消信号贯通

日期：2026-11-17（Asia/Shanghai）。沿用户持续执行授权，由主协调明确分配此增量。范围仅distribution的execution/transaction及其两个测试文件；未改变公共IPC、持久schema、真实来源/公钥、依赖或native helper。源码现已冻结，等待主协调全库检查/整合；本代理未暂存或提交。

## 原问题与实际修正

最小先验复现 **3项0PASS/3FAIL，exit1**：prepare期间的validate拿不到signal；Transaction.cancel的本地controller无法传给artifact；忽略abort的artifact迟到成功后仍启动一次copy。原始 [red-tests.log](cancellation-evidence/red-tests.log) 与 [status](cancellation-evidence/red-status.json) 保留，不通过修改断言消除失败。

内部类型增加可选AbortSignal：DistributionExecutionOptions.validate/artifact、DistributionTransactionPorts.authorize/artifact。既有忽略额外参数的注入实现仍兼容，不新增外部数据字段。

- prepare/build、confirm的前置authorize使用原请求controller.signal；execution传给transaction的authorize桥接保留第二个signal参数。
- transaction的两次authorize及artifact使用外部signal与本地cancel controller组合后的signal。因此Coordinator.cancel在执行阶段触发的事务本地取消，也能到达实际domain validator和artifact，而非只检查请求signal。
- execution.authorize在读取私有authority/target之后及validate返回后检查取消，阻止取消请求的迟到IO结果再启动validator。
- artifact返回后先检查组合signal，才调用copy；copy实际返回后再次检查。忽略abort的端口不能通过迟到成功启动新的文件复制或journal写入。

**提交/恢复边界不变：** receipt.commit、finish、rollback与recover不接取消signal；原子收据提交开始后仍CANCEL_TOO_LATE，必须等待ack/实际清理。close仍取消可取消部分并drain实际在途job，不把“已发abort”当作worker/IO已经退出，也不提前释放私有Store。

## 实际验证

最终两个专注文件 **48 PASS /0 FAIL /0 SKIP，exit0，3861.1989ms**。其中新增8个用例覆盖约定的六类行为，其余40项原回归保持原断言：

| 行为 | 实际检查 |
| --- | --- |
| prepare校验取消与close | validate收到signal；cancel后aborted；close实际触发abort事件，但在端口显式settle前保持pending，随后完成drain。 |
| authority迟到返回 | 真实Store的readAcceptedRelease受控等待期间cancel，释放后不会启动新的validator，也不产生journal。 |
| artifact组合signal | 直接Transaction.cancel及完整Coordinator.confirm→Transaction→artifact两条路径均观察到组合signal.abort；后者没有journal/receipt/目标/lease。 |
| 忽略abort的artifact | 端口迟到返回有效路径，实际copy调用次数仍0，journal/lease均未创建。 |
| 最后授权取消 | 真实目标已发布后，在Coordinator的最后validate中cancel，观察事务本地signal.abort；实际回滚到rolledBack，无receipt，保留本人rollback字节并释放lease。 |
| 不可取消提交 | receipt.commit已开始但ack仍被gate阻住时cancel明确TooLate；外部signal随后abort也不撤回提交，ack完成后receipt/journal committed、目标nlink1、lease正常释放。 |

日志：[final-tests.log](cancellation-evidence/final-tests.log)、[退出码/命令](cancellation-evidence/final-status.json)。全仓TypeScript `--noEmit`与四个变更文件局部ESLint均实际exit0；[checks.json](cancellation-evidence/checks.json) 同时记录命令和冻结源码SHA256，空typecheck/lint日志表示无诊断stdout/stderr，不能单独代替退出码。

测试使用独占 `D:/MC_start/OUCL/tmp/distribution-cancellation-20261117/{red,final}`，默认测试根与其他代理分离。execution测试真实Ed25519验证和SQLite/OwnerGuard，网络响应是注入内存Response；transaction测试用真实FS与磁盘JSON fixture仓库。真实链接/SQLite运行经自动审核批准的沙箱外执行，只触合成测试数据。没有公网、真实游戏/站点、公钥配置或新增GUI/native试验。

## 可复现方法与证据边界

归档 [run-local.mjs](cancellation-evidence/run-local.mjs) 按已有esbuild固定版本编译两个测试文件；Node内置测试子进程stdout/stderr直接连接已打开的文件描述符保存，避免PowerShell字符转码。实际运行命令为：

```powershell
# 从本工作树根，已有固定依赖，无安装
node docs/execution/20261117/cancellation-evidence/run-local.mjs red
node docs/execution/20261117/cancellation-evidence/run-local.mjs final
```

red日志来自产品改动前；当前源码再跑同三断言应通过，不会重新产生旧失败。新复跑必须更换独占root/evidence名称，不能覆盖本次原始记录。类型/lint命令及退出码另存checks.json。

此片提供的是**协作式取消传播**，不保证任意注入端口一定服从signal，也不为既有不可取消的SQLite/readTarget/fs.copyFile增加硬中断。忽略signal的既有IO仍须等待实际settle再drain；已经开始的copy不能被本片同步终止。公共UI/任务状态、domain适配、真实下载/许可验证和其他取消能力不由48项测试代替。
