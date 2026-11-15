# 历史25项失败：环境对照与原断言复跑

日期：2026-11-15（Asia/Shanghai）。本次为主协调分配的独立验证，未修改生产代码、原测试、断言、跳过条件或依赖，也未安装依赖。工作树为本报告所属 main 工作树；独占测试根 `D:/MC_start/OUCL/tmp/baseline-resolution-20261115`，与其他代理输出分离。

## 结果

| 环境/检查 | 实测结果 | 证据 |
| --- | --- | --- |
| 默认沙箱：私有普通文件硬链接 | `EPERM`，syscall=`link` | resolution-evidence/probe-sandboxed.json |
| 默认沙箱：本机127.0.0.1临时HTTP端口 | `connect EACCES` | 同上 |
| 自动审核批准的沙箱外：相同探测脚本 | link PASS，HTTP 200，原样返回固定测试文本 | resolution-evidence/probe-unsandboxed.json |
| 自动审核批准的沙箱外：历史25个失败用例，原断言 | **25 PASS / 0 FAIL / 0 SKIP / 0 cancelled，exit0，23236.1829ms** | resolution-evidence/selected-unsandboxed.log、selected-status.json |

选择列表来自原 `evidence/test-summary.json` 的全部25个失败名称；覆盖回环HTTP/Range、链接准备、Mod准备/事务、所有者guard、目录安全和真实测试子进程的三提交边界终止恢复。没有将任何失败用例排除或替换为模拟成功。该进程终止测试只终止其自己创建的测试夹具子进程，未触及用户游戏或正式启动器，也不是恢复此前取消的最终EXE强杀验收。

这些对照结果定位了本轮历史25 FAIL的环境阻断：当前沙箱不允许用例所需的本机连接/链接能力；同一套原断言在获准环境全部通过。不改变此前沙箱内25 FAIL的原始记录，不将本次单测结果说成GUI、完整游戏、全平台或全历史验收。

## 方法与复现

运行时Node v24.21.0；使用现有固定 `D:/MC_start/OUCL/node_modules/esbuild`，按仓库test脚本相同的 `bundle:false / platform:node / format:esm / target:node24 / outbase:.` 编译src及tests到独占 `.test-build`。执行时设置 `OUCL_TEST_ROOT`、`OUCL_SOURCE_ROOT`、`TMP`、`TEMP`，保持根目录隔离。

归档 `resolution-evidence/run-selected.mjs` 固定记录本次路径、原25名称和10个测试文件，通过 `node --test --test-reporter=spec --test-name-pattern=...` 原样运行编译后的测试。原生stdout/stderr由Node按UTF-8写入日志，避免PowerShell控制台字符转码。

```powershell
# 从本工作树根，使用支持相同真实loopback/link能力的已获准环境
node docs/execution/20261115/resolution-evidence/run-selected.mjs
```

此归档脚本按固定路径写回本轮证据；新的复跑必须先复制脚本并更换独占root/evidence，不能覆盖本次记录。探测脚本见 `probe.mjs`；两种环境运行的脚本相同。自动审核两次允许实际探测及原25用例运行；本轮没有自动审核拒绝。

## 限制

此页首先关闭25项历史失败的局部环境定位与原断言验证，尚未据此宣称最新源码完整回归通过。全套应由协调者在其他产品变更稳定后使用独占根统一执行，避免将不同源码时刻的测试拼接成单一候选结果。历史完整710项681PASS/25FAIL/4SKIP的记录保持不变。
