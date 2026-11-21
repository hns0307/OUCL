# N6 已配置 Electron 本地验收

2026-11-19，Windows x64、Electron 45.0.0、Node 24.21.0，生产源码基于 `36904111`。分发来源、Ed25519 公钥、发行和制品均为合成数据。

1. 使用真实存储写入一条已接纳、尚未投影的任务。应用启动后公告 `distribution.execute.v1`，真实 preload 读回已有 ID `5a1abb3c-55b0-4946-944f-38415263a82c` 和 `queued` 状态。关机后复核投影完成、没有文件事务日志、相应 JAR 未创建。
2. 在真实工具箱输入合成包版本，读取一项新增、零项冲突，再经真实界面确认。preload 的列表、详情及任务中心显示 `fbf464cb-fa4c-4670-83f8-c70829c2ce5b`「安装完成」及「已确认任务状态」。原确认 ID `7584002b-ca5d-4e97-a169-5b31366f4112` 重复提交返回同一任务。关闭并启动新 Electron 进程后，再次重复原请求仍得到同一任务。
3. 两次应用进程均退出为 0。独立进程重开两个真实存储，验得两条分发投影（启动补齐的排队任务和界面发起的完成任务）、原请求接纳别名、`committed` 日志和第 1 版收据。原生助手写入 `mods/fixture-managed.jar`，SHA256 `f0dedfd059f681c751199c86447525956f9585e25cbd605cb119600e443f0848` 与输入及收据一致。

[机器验证结果](verified-result.json) · [差异确认](prepared.png) · [任务记录](task-completed.png) · [重启回读](task-reopened.png)

## 复现和检查

在仓库根运行 `node scripts/distribution-configured-smoke.mjs`，输出落在独占 `.test-build/distribution-configured-*`。追加 `--record` 会更新本目录的四份运行证据。验收命令内部运行 `node scripts/build.mjs`，在临时构建目录为主进程打包时只替换配置函数。产品 preload、界面、工作进程和原生助手由正常构建产出。验收检查上下文隔离和渲染沙箱启用、Node 集成关闭。发行请求由内存响应，目录清单由既有测试拦截器提供，测试期间未触发其他外部网络请求。

本轮执行了实际构建、两次 Electron 启动以及独立存储校验。`tsc --noEmit` 和 `eslint src tests scripts vite.config.ts` 均通过。全量单测沿用 [X 的回归记录](../../20261118-x/checks-evidence/tests.log)。

最初普通执行环境下的 Electron 在加载前退出，十进制代码 `2147483651`，使用本机执行权限后进入应用，未调整产品沙箱。初次真实执行的任务详情已完成，但列表被缺少对应安装任务的实例夹具阻断。夹具现通过真实 worker 持久化该安装任务并将实例摘要关联到它。中间失败目录留于 `.test-build/distribution-configured-YvJ52t` 和 `.test-build/distribution-configured-s6ORkE`，最终成功目录为 `.test-build/distribution-configured-YC2dUw`。

此轮覆盖启动元数据对账与单项新增顶层 JAR。配置函数只在独占构建里注入夹具，生产源码、候选 EXE 与真实信任配置不变。公开 HTTPS、真实发布者与制品权限、真实实例兼容性仍待外部材料。恢复执行链的独立证据见 [W 的验收报告](../../20261118-w/REPORT.md)。
