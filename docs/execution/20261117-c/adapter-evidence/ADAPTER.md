# 公共执行transport与文档生命周期

2026-11-17，基线41120eed。已读取TASK_PLAN、DECISIONS、AGENTS及20261117-b/CHECKPOINT，沿用户明确批准的方案A实施。独占新增本片两生产模块、两测试及本目录，不改main/shared契约/preload/UI/任务库；无依赖、schema或真实信任配置变更，无Git提交。

## API与边界

`DistributionExecutionAdapter(port?)`：`handle(channel,input,trustedClosure,trace):Promise<DistributionExecutionResult>`、同步`dispose()`、幂等`close():Promise<void>`。channel使用既有DistributionExecutionChannel；Result为既有严格typed union。

可选main-owned `DistributionExecutionPort`：

```ts
interface DistributionExecutionPort {
  available(): boolean;
  dispatch(channel: DistributionExecutionChannel,
    request: DistributionExecutionRequest, signal: AbortSignal): Promise<unknown>;
  revoke(): void;
  close(): Promise<void>;
}
```

dispatch返回**完整结果envelope**，不能只返回data。transport检查既有exact请求/响应guards及原请求业务身份关联，成功/失败返回均为detached对象。未知底层异常只映射UNAVAILABLE，不转发message/path；允许的错误必须是契约内完整合法error envelope。未来版本明确UNSUPPORTED_CONTRACT，非法channel/字段/非规范UUID拒绝。错误trace/相关ID亦保守规范化，不能沿非法输入生成不合约响应。

入站和await回程均重新核对trustedClosure/disposed；dispose先同步标撤销，abort全部pending并调用port.revoke。旧文档失效后即便同一closure再变true，旧adapter仍不能返回迟到成功或上游异常。abort只传递请求，不被视为退出；提交/取消/恢复语义由未来facade负责，transport不替其rollback或宣称文件完成。

无port或available=false时五个合法通道统一SOURCE_UNAVAILABLE，先于dispatch，不读取target/storage、不扫描/网络。生产根本片只应new Adapter()而不注入端口；本文件不能证明configured executor、许可或真实来源已实现。

## 有界请求与完成重试

每adapter最多16 active及1024 seen，digest为channel+按key排序的flat payload之SHA256。同ID不同输入/通道REQUEST_CONFLICT，不驱逐旧digest。active相同请求返回**同一个Promise**且只dispatch一次；slot在真实settlement后释放。

完成请求只保留轻量digest，不缓存响应体或已完成Promise。原ID同输入重试会重新dispatch；后继main facade必须提供durable admission幂等/原准备查询，不能把transport“见过ID”当作持久授权或任务完成。满seen仍允许原身份精确重试，新身份CAPACITY_EXCEEDED。

close先dispose，等待全部active实际settle，再port.close；close/revoke失败以脱敏UNAVAILABLE拒绝。相同close返回同Promise，不用超时Promise.race丢弃后台工作；现有3秒桥接超时是上层观察预算，不代表transport在3秒强制终止已接纳事务。

## Owner代际

`DistributionExecutionOwners(factory:()=>DistributionExecutionAdapter)`：`handle(senderId,channel,input,trusted,trace)`、同步`revoke(senderId)`、幂等`close()`。只有可信合法sender创建adapter。

revoke先从live删除旧adapter并同步触发其close/dispose，再把close Promise放retired直到settle；settle删除Promise，失败只留一个failed标志。相同sender的新文档拿新adapter，旧文档回复独立失效。owners.close阻止新owner，撤销所有live并等待live与既有retired；既往retired错误即使已settle也使close拒绝。不会清空活动map后漏await旧代际，也不永久保留完成Promise。

## 实际验证

首轮 **21PASS / 0FAIL / 0SKIP，exit0**：adapter9、owners4、既有执行contract8；TypeScript及四文件局部ESLint均exit0。原始FD日志：[tests](test-initial.log)、[type](typecheck-initial.log)、[lint](lint-initial.log)，[退出状态](initial-status.json)，[冻结源码摘要](source-sha256.json)。

- 无端口/availablefalse五通道均SOURCE_UNAVAILABLE且dispatch effects=0；非法sender/请求/future/channel亦不dispatch。
- 五通道合法完整envelope；错request、业务准备身份/root、额外字段、错DTO保守拒绝；继承既有严格任务kind和预算契约。
- active重复Promise同一、排序payload等价、异payload/channel冲突、完成后原ID重dispatch且不复用被调用者修改的旧response。
- 16 active与1024 seen实际边界，新身份拒绝、原digest保留。
- pending非合作Promise在dispose后才返回/throw，均INVALID_SENDER；close先abort但必须等gate释放才调用port.close并完成。复用CANCEL_TOO_LATE合法envelope不改其含义。
- owners同sender跨文档新旧两代，先释放live仍等待retired；独立结束顺序不导致漏等；retired错误在完成后仍被close记住；20代顺序revoke每代仅close一次。

成功端口明确是transport/lifecycle合成fixture，gate是实际受控Promise的settlement；不是SQLite/native/真实网络执行、真实文档窗口或configured executor验收。未新增外部时间等待、游戏强杀或native试验。

固定父目录已装node/esbuild/tsc/eslint，无pnpm；独占根`D:/MC_start/OUCL/tmp/execution-adapter-20261117-c`，[runner](run.mjs)编译独占mjs并把stdout/stderr直接写FD，只运行本片两测试及既有contract文件，不覆写共享dist。默认沙箱执行，无额外权限请求。源码现冻结交主协调main/preload整合及全检；真实source/key仍空，不广告执行能力。
