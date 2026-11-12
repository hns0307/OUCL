# OUCL 跨工作包验收 v7：最终候选EXE

本阶段完成：同一最终EXE在全新空便携目录实际下载运行时并进入产品；固定样本预览、取消、不匹配提示通过。正常关闭后同一EXE热重开，固定样本再次预览通过。两个实际产品进程均退出0，owner锁释放。

## 交付物

- 文件：[OUCL-0.3.0-acceptance-20261112-v3.exe](D:/MC_start/OUCL-acceptance-v3-20261112/release/OUCL-0.3.0-acceptance-20261112-v3.exe)，405,504字节。
- SHA256：`c231342a5e6027b63675d743ce7b7d88e9071c49cd7c07b060980ac52991a009`。
- 候选代码：`bc01f07487ca7e8d76f17115ea148efcafd748c2`，无Quilt路径别名。产品0.3.0，Electron45.0.0，验收版本v7不等于新增产品版本。
- [构建记录](evidence/build.log)、[打包报告](evidence/package.json)、[配置](evidence/configuration)、[应用清单](evidence/app.manifest)、[运行时清单](evidence/runtime.manifest)。未签名、未push或发布，旧交付物保留。

## 实际构建与复验

先用严格[Node预检](evidence/preflight.mjs)核对597冻结文件零漂移、原v3七产物一致，复制既有产物到原先不存在的dist作为打包输入；没有修改业务源码或重新构建另一集合。执行`OUCL_BUILD_TAG=acceptance-20261112-v3 node scripts/bootstrap-package.mjs`，退出0。先前PowerShell预检遇到dist不存在却继续生成空mismatch，**该结果无效**，由[严格预检结果](evidence/preflight.json)替代，未用来宣称打包输入通过。

| 验收场景 | 结果及证据 |
| --- | --- |
| 真实运行时冷下载 | 新目录仅复制同SHA256 EXE，无预置runtime/app/profile；[18MB下载](evidence/cold-runtime-start.png)、[97MB下载](evidence/cold-runtime-progress.png)后进入正式产品。引导器按嵌入官方ZIP摘要验证后解包；没有独立保留ZIP副本，不能声称本轮另一次离线ZIP复算 |
| 固定样本原生选择器 | [选择器](evidence/cold-picker.png)选择原1355字节文件，显示MC1.20.1/Forge47.4.28/Java17/FerriteCore6.0.1及“当前不可安装”，见[结果](evidence/cold-sample-result.png) |
| 取消与不匹配 | 再开选择器取消后[未选择文件](evidence/cold-cancelled.png)；选择一字节变体后[仅支持已选定测试样本](evidence/cold-mismatch.png)，没有创建实例或安装任务 |
| 正常重开 | 同EXE/同profile再次进入产品并[固定样本预览](evidence/hot-sample-result.png)；runtime/app各只有原命名空间，73运行时/9应用文件与打包清单摘要一致，无额外文件或链接 |
| 正常退出与只读保持 | 产品PID36196/1488均实际exit0；[九次审计比较](evidence/comparison.json)中的metadata JSON、tasks/requests/operations行摘要、游戏目录文件清单一致；owner锁在两次关闭后均不存在 |

空便携根的游戏目录真实存在且无游戏文件；tasks/requests为0，operations为启动引导已有2行，预览前后未变。metadata含catalog与installation，摘要一致、默认根身份保持。Chromium缓存/日志不在不变承诺内；没有用空根证明有内容玩家实例全目录不变。审计脚本随后固定唯一打包目录、检查configuration绑定、排除额外文件/链接并要求游戏目录存在；[final-strict](evidence/audit-final-strict.json)通过。详[审计脚本](evidence/audit.mjs)、[比较器](evidence/compare.mjs)及[独立复核](../20261112-v6/PACKAGE-AUDIT.md)。

GUI沿用[cua-driver技能](C:/Users/Administrator/.agents/skills/cua-driver/SKILL.md)，只操作本轮引导器及已核实的产品子进程。首个带调试端口参数的启动被工具拒绝，没有绕过；实际两轮不启用调试端口，只传disable-gpu。像素回退被自动审批拒绝后未重试，之后使用原生选择器语义控件完成；此前语义点击异步打开窗口，不把拒绝动作记为成功。两轮不曾捕获最终EXE公开握手，能力证据为实际入口及同七产物，完整握手仍引用v6未打包壳。

## 增量结论

E最终包代表入口、真冷下载及热重开缺项已补齐；missing-worker继续引用v3独立缺组件构建，未删除最终包worker来制造分支。v4真实选择器期间窗口销毁证据保留，部分迟到回调竞态仍未覆盖。A产品强制中断恢复仍DEFERRED，Quilt索引/隐藏依赖别名及未批准的文件启停/卸载、通用包导入/安装继续排除。

B专属补证现已完成：双域各1000有效计划全worker读取/重开、20页公共读取及1001拒绝通过；当前规范DTO的保守字节上界低于防御阈值，未冒称合法阈值+1测试，详[B-SCALE](../20261112-v6/B-SCALE.md)。最终选择见[清单](MERGE-CHECKLIST.md)。当前主分支尚未合并；实际提交/分支结果另附，不能将本包生成等同全部原方案完成。
