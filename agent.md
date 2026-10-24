# OUCL 下一对话交接

更新：2026-10-25，Asia/Shanghai。代码基线：`60e91f8`。本文件是工作快照，不替代AGENTS或批准记录；每次开发**先读OUCL-Codex/docs/TASK_PLAN.md**，再读AGENTS.md、DECISIONS.md及关联契约。不要仅凭本文件判断新授权或测试成功。

## 用户目标与有效授权

- 原目标：一直继续直到有简易MC启动器，至少包含下载与启动。**尚未完成，不能标goal complete。**
- 用户直接批准过“阶段1A下载与启动闭环，持续实现并提交”。暂停后又明确恢复目标，允许多个子agent并行，要求每个可验证增量Git提交，并维护本交接文件。
- 当前G2、阶段1A；同范围无需反复索要启动确认。不要扩大到加载器、正版登录、联机、整合包或后台；偏离已批架构/IPC/存储/安全及新增依赖仍按AGENTS再审批。
- 先说明本次增量文件、风险和验证；实施、实际检查、同步文档、Conventional Commit。并行时划分独占文件，主agent统一复核/串行提交，避免共享index冲突。

## 已交付的真实状态

- `9614e76`：官方版本目录、描述SHA1信任链、持久缓存、versions:catalog与正式浏览界面；历史带空格的版本身份已支持，所有目录条目仍candidate，不是兼容承诺。
- `147aeb8`：roots:list/choose、系统目录选择适配、固定数据位置登记与正式UI；尚未自动操作真实native picker。
- 更早已有纯版本/路径/任务策略、JSON+SQLite恢复基础、ObjectStore、StorageClient和有界HashPool，详见TASK_PLAN及各验证报告。
- **`60e91f8`：新增单物理HTTP下载、独立权威续传SQLite、worker桥接及ObjectStore提交。** 这不是完整安装器，也不是共享消费者协调器。
- 普通窗口当前只提供固定目录登记与官方版本浏览，**还没有可用的安装/启动按钮链路**。旧release便携目录还是历史工程骨架，未随本轮重打包。

## 本轮验证与复现

- `pnpm check`：110项，108 PASS / 0 FAIL / 2 SKIP，typecheck/lint/build通过。core行100%、分支98.92%、函数100%，不是整个服务/UI的覆盖率。
- 两个skip：文件软链接权限不足；Windows拒绝重命名打开的SQLite。确定性stat适配器覆盖了缺失/换身份/link/directory，但不冒充OS实际替换测试通过。未改系统权限。
- `pnpm test:workers-runtime`：实际Electron45/Node24.22正式worker通过fixture传输取消、正常关闭重开、206续传、对象提交/复用。
- `pnpm test`生成.test-build后，`node scripts/verify-download.mjs`：真实1.21.1 client.jar为26,836,906字节；取消保存15,812字节，正常worker重开后服务器实际206续传，官方SHA1匹配，随后复用无网络请求。报告明确gameDownloaded=true、gameLaunched=false，临时文件已清理。
- 权威证据：`docs/validation/A1-05-transfer/REPORT.md`、check.log、official-download.json、electron-runtime.json和snapshot.json。首次完整检查的自动权限审查曾超时，后续重试成功；不要把未执行命令当失败测试。

## 当前接口与重要约束

| 位置 | 已有职责 |
| --- | --- |
| src/services/download/types.ts | DownloadSpec、严格TransferRecord、官方artifact URL策略、脱敏错误 |
| src/services/download/http.ts | HttpTransfer.run(file,record,checkpoint,options)，只处理一个物理传输，约每1MiB及收尾先fsync再登记前缀 |
| src/services/download/artifact-transfer.ts | ArtifactTransfer.run(spec,options)，受管staging→HTTP→摘要/对象提交→committed；同key并发返回TRANSFER_BUSY |
| src/services/storage/transfer-db.ts | 独立权威transfers.sqlite、transfers.json enabled marker、CAS及每次访问的backing身份校验，worker-only |
| src/services/workers/storage-client.ts | getTransfer/saveTransfer；私有transfer:get/set，没有renderer路径或任意SQL接口 |
| src/services/objects/store.ts | createStaging/resumeStaging、只读SHA256本体、独立来源记录、索引重建，保留损坏/未知证据不覆盖或GC |
| docs/contracts/DOWNLOAD_TRANSFER.md | 精确记录格式、范围/超时/Range/取消、恢复边界 |

- transfers.sqlite不是缓存，不能像objects-index.sqlite一样丢弃。marker在而库不在要停写；不能建空库继续。
- 只允许官方HTTPS artifact host，redirect/凭证/query/fragment禁用；localhost仅在测试fetch适配器映射。
- 强ETag需有引号；真实Mojang响应本次使用了Last-Modified作为If-Range。二者都不能替代官方哈希。
- 警惕清零顺序：保存0成功后必须立即清内存position，再truncate/fsync，故障时不能重新登记旧前缀。
- 缓存查找后要复核取消；committed摘要与已验证对象矛盾时必须needsRecovery。最终确认丢失已覆盖写前/写后两种情况，不重写终态。
- 进程崩溃遗留owner不能自动抢占；对象本体已移动而证明/索引未完可能保守停写。当前证明的是正常关闭重开，不是完整kill/断电恢复。

## 下一步优先顺序

1. 接共享下载消费者/有界安装编排：同制品只有一个实际传输，A暂停/取消不能打断仍需它的B；持久关联、退出/重载恢复和任务结果要真实，不只复用纯消费者函数。
2. 落实已批tasks:*及订阅/退订契约：TaskAccepted、严格TaskSnapshot/错误、进度有界合并、超时幂等和终态可查询。先核对PROPOSAL§7，不发明通用execute或临时假成功IPC。
3. core/install纯计划及assets index信任链，接libraries/assets/client批量下载和实例物化；身份分离、隐藏父jar、固定store、私有可写数据和复制回退按既有布局。解压需安全有界worker，不能偷偷依赖未评估的传递包。
4. Java检测/选择、离线档案、参数数组、gameDir排他租约、真实进程与UI闭环；实际到菜单/临时世界、退出重启及共享/隔离验证后才判断简易目标完成。

只读环境核对：PATH现有受信任Oracle Java实测17.0.12、amd64/64位；已知供应商目录未发现8/21。没有安装/下载Java。不要把Temurin/Adoptium候选写成已批准发行商；读DECISIONS的D-03及实际制品核验要求。Java17可作为相应版本的后续候选，未实测游戏不能声明兼容。

## 工具、Git与待保留现场

- Node24.x、pnpm12.3.4、Electron45已安装，命令以package.json为准。受限环境可能拒绝rename/junction/loopback；必要时在已授权的正常本机权限复核，不能关Electron sandbox或改系统权限。
- 当前观察分支为main，勿凭早期记录改回master或重置。用户暂存了`OUCL-Codex-Package.zip`与`OUCL.txt`；两者被本轮明确排除且保持暂存。不要`git add .`、清index或替用户把原始资料混入增量。
- 本轮使用显式路径及`git commit --only -- <本次路径>`保留上述暂存；提交前检查对应路径的cached diff/check。Git写入可能需要正常本机权限。
- Git邮箱已有配置；作者名本轮继续用`git -c 'user.name=Li ZeRui' commit ...`，没有改全局身份。用户只要求commit，**没有授权push**。
- CI配置存在，本轮未推送远端，不能声称远端CI通过。不要覆盖历史validation或旧release来制造新包验证。

交付前更新TASK_PLAN、DECISIONS、验证报告及本文件。下一对话应接着推进真实安装/启动，而不是重新做G0或在下载单文件/空窗口处结束目标。
