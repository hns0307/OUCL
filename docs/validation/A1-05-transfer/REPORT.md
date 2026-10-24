# A1-05可信物理传输与续传子增量

2026-10-25（Asia/Shanghai；证据时间使用UTC）。用户恢复原目标，允许子agent并行并要求逐增量Git提交与交接文档。沿用阶段1A批准，无新依赖、无新增渲染IPC，不改变既有tasks.sqlite格式；新增传输元数据仍采用已批SQLite事务方向。约定见[DOWNLOAD_TRANSFER](../../contracts/DOWNLOAD_TRANSFER.md)。

并行分别实现HTTP执行器和独立SQLite续传库，主agent集成worker与ArtifactTransfer、复核并补端到端故障场景。HTTP限官方HTTPS、严格Range/If-Range/长度/编码、先fsync后登记前缀；权威库使用marker防丢失，并在每次访问核对backing身份。字节完整不等于可信，最终仍通过对象仓库的官方摘要/大小与本地SHA256验证。

交叉审查修复：清零检查点之后立即清空内存偏移，防止truncate后fsync失败再登记旧偏移；缓存查找后复核取消；缓存不能掩盖权威committed摘要矛盾；SQLite旧句柄不能掩盖路径丢失/替换。补齐最终提交前/后确认丢失的两种恢复测试，且不重写不可变终态。

`pnpm check`退出0：typecheck、lint、110项测试及build完成，108 PASS / 0 FAIL / 2 SKIP。core行100%、分支98.92%、函数100%仅为core范围。[check.log](check.log)来自实际完整输出，仅规范行尾空白。

两项跳过：本机缺少文件软链接权限；Windows拒绝重命名正在打开的SQLite，实际backing替换分支不能完成。未修改系统策略。已有junction拒绝测试、独立stat适配器对缺失/变身份/链接/目录的确定性覆盖仍执行；不把模拟覆盖称为真实OS替换通过。最终完整检查曾遇自动权限审查超时，未运行的命令没有算测试失败；重试后取得上述结果。

`node scripts/verify-download.mjs`在`pnpm test`生成.test-build后，使用正式服务和真实官方描述下载1.21.1 client.jar，主动取消、正常关闭/重启worker后续传：

- 官方预期26,836,906字节，SHA1 `30c73b1c5da787909b2f73340419fdf13b9def88`。
- 持久前缀15,812字节，随后Range为bytes=15812-，服务器实际206；其ETag没有强引号，因此正确使用Last-Modified作为If-Range。
- 完整对象SHA256 `499f6897d1837516680f3114072d8106e11c9adcd933fe5cf051b551089b0c99`，对象/来源和committed记录一致；再次请求不访问网络。
- [official-download.json](official-download.json)明确gameDownloaded=true、gameLaunched=false。验证在独立临时目录，结束后清理，没有把JAR或玩家数据纳入Git。

`pnpm test:workers-runtime`实际Electron45/Node24.22使用正式dist worker，通过fixture传输取消、关闭重开、206续传、对象提交和复用，同时原存储/哈希验证继续通过，见[electron-runtime.json](electron-runtime.json)。本次新报告路径不覆盖旧A1-04b历史证据。

未完成：共享消费者调度/持久关联、安装任务图和任务订阅、libraries/assets批量计划、Java管理、解压、实例物化、离线档案、进程与实际安装/启动UI；当前normal窗口仍只有目录/版本浏览。异常进程遗留owner、对象本体已移走但证明未完等恢复边界仍保守停写，正常重开不代表进程kill/断电恢复全部通过。A1-05父任务及简易启动器完整目标仍进行中。

只读Java核对：当前PATH中的Oracle Java实测为17.0.12、amd64/64位；已知供应商位置未发现8/21。没有下载/安装Java或改变系统设置，未把Adoptium/Temurin候选写成已批准发行商。后续按实际游戏元数据选择并验证。
