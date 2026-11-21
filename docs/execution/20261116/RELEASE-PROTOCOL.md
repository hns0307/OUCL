# N6 发布安全基线：独立 v2 信封与权威序号端口

2026-11-16。按主协调分配的持续执行任务实施；用户要求真实来源和公钥留空。独立文件为 `src/core/distribution/release.ts`、`src/services/distribution/release-source.ts`、`tests/distribution-release.test.ts`。没有修改 formatVersion 1 清单、旧预览来源、main/IPC、所有权代码或依赖，没有 Git 提交。

## 精确协议

新信封为 `{payload,signature}`。payload 固定字段顺序：

```typescript
{
  releaseFormatVersion: 2,
  sourceId, packageId, packageVersion,
  sequence, issuedAt, expiresAt,
  manifestSha256,
  manifest // 既有 DistributionManifest，仍是 formatVersion: 1
}
```

source/package/version 使用既有受控ID规则；sequence 为正 safe integer，作用域是 sourceId + packageId，不因 packageVersion 不同重置。issuedAt/expiresAt 为整数 UTC Unix 毫秒，issuedAt < expiresAt，最长31天；当前时刻必须 issuedAt <= now < expiresAt，无隐式时钟偏移宽限。时间格式和判断不依赖本机时区。

manifestSha256 是既有 `canonicalDistributionPayload(manifest)` UTF-8 字节的SHA-256。外层包身份/版本必须等于内嵌清单；目标环境按请求中的可信 target 精确绑定。签名字段仍为 `{algorithm:'ed25519',keyId,value}`，由固定来源中未撤销的 pinned SPKI Ed25519公钥验证。外层签名输入为 `canonicalDistributionReleasePayload` 的规范UTF-8字节，包含上述全部payload字段。未知字段、未来版本、无效序号、过长有效期或非规范签名base64拒绝。没有改变旧v1签名字节，也不把v1只读预览隐式升级成执行信任。

`releaseSha256` 为外层规范payload字节SHA-256；它区分同序号的不同签名内容。不同签名/keyId若认证同一个payload，不改变发行身份。

## 服务API与信任边界

`PinnedReleaseSource(record:TrustedDistributionSource, state:ReleaseStateStore, options?)` 复用现有来源记录校验；`options` 可注入 fetcher、可信 now 与1—15000ms预算。产品默认 `EMPTY_RELEASE_SOURCES=[]`，没有真实地址、公钥或测试信任根。

`resolve({packageId,packageVersion,target},signal?)` 从固定路径 `${manifestOrigin}${manifestPathPrefix}${packageId}/${packageVersion}/release-v2.json` 读取并返回 `{envelope,releaseSha256}`。默认15秒、最大1MiB，HTTPS精确来源、无Cookie、无重定向；renderer不能提交URL。fetcher端口可由主协调装配已有桌面网络适配器，当前未接真实来源或公共执行入口。

验证成功后才访问 `ReleaseStateStore`：

```typescript
interface ReleaseScope { sourceId: string; packageId: string }
interface ReleaseState { sequence: number; releaseSha256: string }
interface ReleaseStateStore {
  read(scope: ReleaseScope): Promise<ReleaseState | undefined>;
  compareAndSet(scope, expected: ReleaseState | undefined, next: ReleaseState): Promise<boolean>;
}
```

store 是主进程权威端口，必须跨进程事务/CAS；缺失只能表示从未接纳的scope，损坏/丢失/恢复不明必须拒绝，不能当空状态。旧包收据和本地手工声明不是此权威，不能提供最高序号，也不从它们回填高水位。具体持久适配由主协调独占实现。

低序号拒绝 RELEASE_DOWNGRADE；同序号不同摘要拒绝 RELEASE_EQUIVOCATION；同序同摘要是幂等接纳，但仍须 CAS(expected,same)重新线性化，防止读到旧值之后另一请求已接纳更高序号。CAS失败最多重读八次，持续争用返回 RELEASE_STATE_CONFLICT。验签失败、来源/身份/目标不符、读取时已过期或尚未生效都不访问/写入权威状态。权威返回坏结构或抛出内部错误时返回受控 RELEASE_STATE_INVALID，不暴露内部路径。

接纳序号不是安装完成记录，不随安装失败回退。resolve只证明CAS线性化点的发行接纳，不是永久安装许可：执行器仍需在实例/目录租约及最终复核下读取最高序号和摘要，拒绝在此期间已被更高发行替代的旧候选，并重新验证有效期、撤销配置、文件和目标环境。真实执行、恢复及收据提交由其他增量负责；本片不写游戏文件。

## 硬超时与结果未知

整体预算用独立定时器与Promise竞速覆盖 fetch、每次read和权威read/CAS，而非只依赖AbortSignal。注入fetcher/stream即使不响应abort或cancel返回永不结束Promise，resolve仍到时拒绝。底层最终返回的body尝试取消但不等待无限清理；它不能再次写权威。没有使用关闭TLS、扩大来源或降低沙箱的方法。

若CAS已提交但回执延迟到预算外，或CAS后本地时间刚好越过expiresAt，当前resolve拒绝，不执行、不回滚已接纳高水位。下一次read可以确认已接纳身份；未知结果不能当作未发生后重置状态。这不能强制中断不受控port本身的底层活动；权威适配还需自己的事务和资源生命周期保证。

时间验证依赖主进程提供的可信时钟；不能宣称在用户恶意回拨系统时钟、删除权威库或更换应用信任根后仍有服务器级防回滚。未来需要更强保证时须另批可信时间/恢复根与撤销发布机制。

## 验证记录

独占编译输出 `D:/MC_start/OUCL/tmp/release-protocol-20261116/distribution-release.test.mjs`；esbuild bundle当前测试后执行 `node --test`。最终10项：真实临时Ed25519签名、规范字段/旧v1字节保持、篡改/错key/撤销/错source/包版本/target/hash不写权威；过期/未来、跨版本降级/同序异内容；并发高序先赢/同序内容竞争CAS；fetch/read/cancel不尊重abort仍超时；损坏状态、无界CAS争用、超时CAS迟到、权威读取阻塞及CAS期间过期的保守处理。

临时密钥仅tests内存。测试使用合成Response和注入内存CAS存储；这验证真实签名及服务协议，不是公网来源、SQLite持久适配、产品IPC、安装事务或GUI验收。局部ESLint运行；整仓类型检查在并行store/transaction实现未收尾时仍报这些其他文件错误，统一最终类型/完整回归由主协调另记。旧历史失败与已取消补证不改写。

## 独立 store 审查（首轮，修复前）

按主协调追加任务，只读审查其 `store.ts` 与四项 `distribution-store.test.ts`，没有修改这两个文件。现有OwnerGuard真实独占、SQLite事务CAS、同序幂等/反降级以及仅从本次open前journal建立recoveryCandidates的设计方向符合端口要求。旧只读receipt不进入权威store；archive内容canonical hash与高水位绑定，新的高水位使旧archive不再返回。

在独占 `D:/MC_start/OUCL/tmp/release-store-review-20261116` 对当前store进行有界真实SQLite复现，helper与完整结果为 `review.mjs`、`result.json`，未访问生产数据库：

1. **P2 / SQL故障错误未归一。** 新建store后，用同一独占数据库的另一个SQLite句柄删除release_states表，`store.read(scope)` 实际返回原生 `Error / ERR_SQLITE_ERROR / no such table: release_states`。原始SELECT位于受控catch外；record、readAcceptedRelease首个SELECT也有同类入口。建议统一为受控NEEDS_RECOVERY/STORAGE_IO并补故障测试；不能把读权威失败解释为从未接纳。此复现没有观察到降级写入或文件破坏。
2. **P2 / close与在途read竞争。** 对15个独占新store分别并发 `Promise.allSettled([store.close(), ...4次store.read(scope)])`，多轮实际得到原生 `ERR_INVALID_STATE / database is not open`。verify在await读取owner.lock前判断closed，但await后没有再次判断；close可在verify等待期间关闭SQLite。建议入口同步closing/幂等close Promise并串行drain，至少verify最终await后复查状态并归一SQL错误。每轮正常close完成，复现没有遗留未关闭的测试owner。

四项既有测试覆盖正常重开、CAS、双owner拒绝、未知内容拒绝和archive匹配，但未覆盖上述SQL损坏/关闭竞争。已将具体复现、影响与建议交回主协调；尚未把修复写成通过。

archive只对payload canonical hash建立历史认证绑定，不对外层signature元数据独立认证；替换keyId/签名而不改payload不会改变高水位。内容仍受已认证payload hash保护，但执行前必须用当前pinned公钥真实重验archive签名并检查撤销，不能仅看其keyId。这是后续executor准入要求，未据此宣称archive内容可被修改。

### 修复后独立复核

主协调修复store SQL映射、verify末尾closed复查及幂等closePromise后，审查者在新的独占目录 `D:/MC_start/OUCL/tmp/release-store-review-fixed-20261116` 重新bundle当前store，原反例helper原样运行：SQLdrop现在为 `StorageError / NEEDS_RECOVERY`；15轮close与四并发read中 **0 原生close错误**，51个读取以受控STORAGE_IO/NEEDS_RECOVERY拒绝；正常close均完成。两项具体P2反例已闭合。原修复前证据目录保持，没有覆盖成绿色结果。新增仓库测试也覆盖SQLdrop与双close/读取，但本条只记录独立helper实际运行。

同时复核terminal journal调整：open时已有的所有journal（包括committed/rolledBack）进入recoveryCandidates，仍不收纳本进程新写journal。这样可以覆盖terminal journal已提交但本人gameDir lease尚未释放的中断点；transaction终态recover只在目标锁内容精确匹配原journal token时释放，不重做文件，不清除其他token。这是必要的终态清理入口，不能重新把它当安装执行许可。该判断来自源码复核，真实terminal故障恢复矩阵由事务子任务单独记录。
