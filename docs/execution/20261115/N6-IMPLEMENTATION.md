# N6 首片：空信任配置、签名源与只读所有权预览

2026-11-15。主协调转达用户要求继续实际实施，并明确来源、公钥“先空出”；本片只实现可配置基础设施和只读观察，不启用真实分发、不生成产品密钥、不实现安装事务。

## 文件与接口

- `src/services/distribution/source.ts`：`TrustedDistributionSource` 固定源记录；`EMPTY_DISTRIBUTION_SOURCES` 永远为空默认值；`PinnedDistributionSource(record, fetcher?)` 实现既有 `DistributionSource`。只接受固定 HTTPS 公共域名、443默认端口、固定路径前缀；包/版本为受控 ID；不允许重定向、Cookie、清单公钥注入。公钥须是固定 SPKI PEM Ed25519，keyId 精确匹配且未撤销。
- `src/core/distribution/ownership.ts`：独立 `formatVersion:1` 包收据严格解析；绑定实例、来源、包、版本、受管 UUID、区域/相对路径和安装摘要。包管理、用户添加、本地发现、用户覆盖和多包归属冲突独立投影；相同内容或文件名不建立所有权。
- `src/services/distribution/preview.ts`：`DistributionPreviewService({sources, readTarget, fetcher?})`；`listSources()` 只返回 sourceId；`preview({sourceId,packageId,packageVersion,instanceId},signal?)` 返回只读 manifest/diff/ownership、实例修订和收据状态。`readTarget` 是主进程注入的可信身份/环境/路径端口，渲染层不提交路径或观察值。返回结果没有 gameDir、公钥、网络 URL 或文件句柄。
- `tests/distribution-preview.test.ts`：新增九项局部测试，原有测试未改。

主协调负责共享契约、IPC、安全摘要 DTO、默认空来源 UI 和真实实例 resolver；本片没有修改公共入口、文案、依赖、旧 manifest 或原测试文件，也没有提交 Git。

## 约束与真实行为

签名信封 1 MiB、15秒预算，流式计数；规范字节使用已有 `canonicalDistributionPayload`，真实 `node:crypto.verify` 验证 Ed25519。包、版本和目标 MC/Java major/加载器/加载器版本精确绑定。错签名、撤销、错包版本返回认证错误，不混作文件错误。当前协议没有发行序号/过期字段，不能承诺防重放或版本单调更新；未更改既有签名 payload。

只读文件观察只遍历 mods/resourcepacks/config：最多4096条目录项、16层、累计256MiB、15秒预算；SHA-256按64KiB异步读取。拒绝符号链接、链接祖先、非普通文件和多硬链接文件；打开后核对实际句柄与路径身份/时间/大小，读后及整个扫描末尾复核。扫描前后还比较可信目标和收据投影。不能将这些检查称为对恶意外部并发写入的原子快照：平台路径检查与 open 之间仍有竞争窗口；没有写入和执行许可，未来执行必须重新设计租约、提交和恢复。

可选收据只从可信 gameDir 下固定 `.oucl-distribution-receipts.json` 读取，上限1MiB；无写入口。缺失保持 missing/local-discovered，未知版本、损坏或实例不符停预览；不迁移、不收编旧实例。收据只用于本片只读分类，是本地来源声明，尚无包安装 commit/journal 或真实性闭环，不能作为执行授权。原普通 Mod 事务不自动转换为包收据；user-added 只接纳主进程另有真实证据时注入的对应摘要事实。

复用现有 `distributionDiff`；未知文件、用户覆盖、多包碰撞阻断变化。首片已有 config 的 replace/remove 即使收据和旧摘要匹配也保守报冲突，遗漏文件不自动删除。`readOnly:true` 始终存在；不提供确认安装、写入、网络制品下载、迁移或删除入口。

默认没有来源和公钥，`listSources()` 返回空；任何 preview 请求返回 SOURCE_UNAVAILABLE。测试临时生成密钥只存在测试内存，不进入产品配置。

## 本次实际验证

独占测试根：`D:/MC_start/OUCL/tmp/n6-service-20261115`。从本工作树通过已安装 esbuild 单文件 bundle 测试，`node --test .../distribution-preview.test.mjs`：**9 PASS / 0 FAIL / 0 SKIP**。使用真实临时 Ed25519密钥和真实普通文件，HTTP读取端口为注入的内存 Response；这不是公网来源验收。

覆盖签名篡改、错 key/撤销、错包版本、信封字段/大小、严格源配置；收据格式/实例/路径、四类所有权与多包冲突；真实嵌套文件摘要/只遍历允许区域/无写入；错环境/目标改变/坏收据；config 保留和认证错误分类。

局部 ESLint：`node ../../node_modules/eslint/bin/eslint.js src/core/distribution/ownership.ts src/services/distribution tests/distribution-preview.test.ts` 无输出。整仓 `tsc --noEmit` 在并行集成中运行，最初还存在其他 online-tools 文案接线错误；最终统一类型与完整回归由主协调记录。没有启动真实GUI、游戏、真实源、公网取消或强杀补证，也没有替换EXE。
