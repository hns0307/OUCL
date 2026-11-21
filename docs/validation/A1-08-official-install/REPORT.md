# 官方完整安装与大日志重开

`node scripts/verify-game-install.mjs`调用正式InstallerService，实际官方HTTPS元数据、制品、哈希、文件投影与native落盘。首次1.20.1完整安装3,641制品/735,814,641字节，3,641入口receipt，manifest与持久记录一致，耗时375,378ms。数据仅在独立.test-build验证目录，保留供启动；不是exe/UI下载验收。首次安装结果保存在initial-install.json。

首次启动预检重开该约190MB SQLite操作历史时，128MiB worker发生ERR_WORKER_OUT_OF_MEMORY。独立只读复制日志现场再次复现相同错误，见recovery-oom.json。根因RecordStore.operations().all()及恢复映射保留全部历史JSON。现改为逐行迭代，两次流式遍历，历史/当前映射仅存SHA256，继续逐份校验envelope、修订链、未提交阶段、JSON提交点及外来文件；不删日志，不改schema，不提高内存上限。相同完整副本在原128MiB限制下ready并正常释放副本owner，见recovery-after.json。

第一份修复后副本误漏属于权威日志的transfers.json标记，恢复返回NEEDS_RECOVERY（recovery-before.json）；补齐副本后通过，没有降低生产校验。旧原始验证目录的崩溃owner保持不动，不自动抢占；新验证使用全新目录/metadata/root身份，复制原已验证对象及来源后重新哈希重建可丢弃索引，重新安装。该实验不证明异常owner自动接管已经完成。

`node scripts/verify-game-install.mjs retry`在全新official-game-retry目录完成：3,641制品、相同总字节、完整manifest与私有native，201,038ms，见official-install.json。初始目录及故障副本保留，不移动/删除其owner。随后正式StorageClient已能重开新目录执行启动预检；旧缓存复制不包含metadata、root views或任何owner。

新增storage-scale.test.ts使用112次768KiB记录修订生成超过128MiB的真实SQLite日志，在正式128MiB StorageClient worker中重开并正常关闭，作为规模回归。`pnpm check`退出0，233测试231 PASS/0 FAIL/2原有环境SKIP，typecheck/lint/build通过，见[check.log](check.log)。该轮包含同时开发的5项LaunchPlan与6项进程生命周期测试；core行/函数100%、分支99.07%，不是IO/UI整体覆盖率。仍未完成新exe、账户/Java选择及启动UI，也没有把原始安装记录等同游戏到菜单或世界。
