# 本地Mod域适配首片实现计划（未实施）

日期：2026-11-17。依据LOCAL-DOMAIN-DESIGN及当前内部取消端口；本页仅计划，不改public IPC、签名清单、下载TrustAnchor、持久schema或依赖。真实来源/公钥保持为空。

## 最小范围

- 拟新增 `src/services/distribution/local-mod-domain.ts` 与 `tests/distribution-local-mod-domain.test.ts`，必要的纯最终库存投影可拆至同目录模块；不直接重用add-only ModInstallPreparation提交器。
- 初片仅支持mods顶层普通`.jar`的add/replace/remove/keep；nested path及resourcepacks/config操作明确unsupported。完整库存仍保留既有顶层`.jar.disabled`，不因新byte/hash正确而宣称其他区域兼容。
- 仅读取main-owned明确解析的本地字节与许可决定；不推导artifactId对应URL，不访问许可网络，不提供默认许可，也不修改实例/安装文件。

## 最小内部typed API

```ts
type ArtifactBinding = { planDigest: string; operationIndex: number;
  artifactId: string; sha256: string; size: number };
type LocalArtifactEvidence = { binding: ArtifactBinding; path: string;
  permission: 'verified' | 'denied' | 'unknown' };
interface LocalModDomainPorts {
  resolveLocalArtifact(plan: DistributionPlan, index: number,
    signal?: AbortSignal): Promise<LocalArtifactEvidence>;
  readContext(plan: DistributionPlan, signal?: AbortSignal): Promise<{
    rootId: string; gameIdentity: DirectoryProof; context: ModInventoryContext }>;
  inventory: Pick<ModInventoryService, 'scan'>;
  scanner: Pick<ModArchiveReader, 'read'>;
  readJournal: JournalRepository['read'];
  versionsByHash(items: readonly ModInventoryItem[], signal?: AbortSignal):
    Promise<ReadonlyMap<string, PlatformModVersion>>;
}
// 复用ExecutionOptions现有签名，不加入renderer参数或持久字段。
interface LocalModDomain {
  validate(plan: DistributionPlan, signal?: AbortSignal): Promise<void>;
  artifact(plan: DistributionPlan, index: number, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>; // 撤销工作并等待scanner/端口实际settle。
}
```

许可状态属于该完整binding，不能把另一个hash/操作/计划的verified复用；denied、unknown、缺失或binding不符都阻断。PlatformModVersion.evidence不是许可证，versionsByHash不得补造平台事实。端口由main注入，测试临时决定不代表真实授权。

## 前置authorize：无本tx journal

1. 解析plan并以txId+planDigest绑定内存session；readContext核对root/实例/revision/gameIdentity和真实MC、loader、Java事实；必需运行时事实未知则阻断，不以manifest声明代替实测。
2. 扫描完整当前库存，记录基线fingerprint/全部条目及环境身份。首次调用建立基线；之后无journal的重复validate必须仍匹配该基线，不重新收编变化后的文件。
3. 对每个add/replace解析本地证据，核对binding/verified；真实scanner读取JAR，校验size/SHA256及读取前后普通文件identity，私有来源要求nlink1。保留有界本地事实，不下载或发布。
4. 纯投影完整最终库存：从基线精确剔除replace/remove旧项（旧hash必须匹配）；add要求原名缺失，再以plannedModFacts添加新条目；其余/keep/禁用条目原样保留，拒绝重复路径/ID及超限。
5. 对完整最终库存运行checkLocalMods及checkPlatformMods；保留新增SERVER_ONLY_MOD硬阻断策略；unsatisfied或unknown、缺平台证据均拒绝。required language未知由既有规则阻断。
6. 缓存预期最终完整fingerprint、上下文身份、制品proof与平台证据。artifact只为已验证相同binding返回复验后的path，不能自己启动下载或接受未validate的身份。

## 最终authorize：本tx已发布但receipt尚未提交

1. **不得按调用次数或文件存在猜阶段。** 从main-owned readJournal读取并严格parse：txId/planDigest/root/instance/revision/gameIdentity一致，phase=applying、pending=null，所有变更已在对应最终stage，才进入最终态验证。
2. prepared、needsRecovery、其他/不完整journal或丢失本域session均保守阻断，交独立事务恢复；不从残留文件重建基线或管理权。
3. 当前目标已包含新JAR、旧replace/remove已移走：重新扫描**实际完整最终库存**，与缓存预期最终fingerprint比较；不要再要求旧hash仍位于原目标，也不再次“剔旧加新”造成重复。
4. 重新核对上下文/目录inode及本地证据绑定与许可，使用实际最终JAR事实重算本地依赖/平台兼容；扫描前后及await后检查取消和身份变化，拒绝外改、未知和过期session。
5. 本域验证不授予ownership、不写receipt、不覆盖私有ledger判定。事务仍独立核对managedId/旧hash/lease、正式fileproof及receipt CAS commit点；取消前回滚、commit后TooLate保持现状。

## 最小真实验证与准入边界

- 使用真实合成有效/无效JAR和worker；size/hash/源替换拒绝、scanner取消后等待实际退出；无网络响应依赖。
- 完整库存投影：replace不重复、remove破坏剩余依赖、keep/禁用/未列项保留、server-only与缺平台/运行时事实阻断。
- verified仅相同binding有效；denied/unknown、伪造或跨操作binding、其他区域变化拒绝，不用无条件许可mock冒充产品许可。
- 最重要联合格：真实事务先前置validate再发布新JAR，最终validate接受实际新库存；在相同位置加入外改应拒绝并实际回滚；remove完成后的缺失旧文件不被误拒。
- 真实applying journal阶段证据与缓存丢失/错误tx/未完成pending拒绝；不以人工“phase参数”假装事务已经发布。
- 内存session有界，close取消并drain，完成/失败释放重对象且保留必要身份拒重放；不新增持久缓存或自动恢复扫描。
- 仅实施后运行专注测试、typecheck/lint及主协调全检并留原始证据，才记交付。本计划没有实现代码或声称测试通过。
