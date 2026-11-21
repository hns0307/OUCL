# L root-owned J→K runner：独立只读审查

2026-11-18，K已完整保存后沿持续批准A审查L。只新增本报告，未改source/tests/依赖/schema/public接线，未启动重复full或native/GUI试验。核对runner.ts及既有J/K/H/G接口，最终源码SHA256：`9165391bc5dbdd2e88fbfa4408cd14de37df0452fb70d5a940203d9d453547fb`，与实现代理冻结摘要一致。

## 结论

**限定范围未发现剩余阻断，有限认可内部root-owned运行编排。** root slot实际覆盖J执行、K CAS/读回和最后完整任务读回，返回真实StoredTask而非由J薄证据编造completed。此mutex只约束该owner；main仍须独占该root执行入口，不允许其他服务私自直调共享coordinator/transaction绕过runner。

| 审查点 | 最终源码判定 |
| --- | --- |
| 入站/绑定 | root/proposal/task严格小写UUID；record bounded snapshot+parse、projected/root/proposal/task匹配。projection最多1024/4MiB、逐条exact/Execution/root/kind/唯一ID及目标inputDigest/task绑定。 |
| slot及身份 | run在首await前占单个root job；同proposal/task共享工作并detach，其余拒busy/conflict。finally在完整work（含K与final readBound）结束后释放；seen只在durable record及projection通过后记录，wrong task不永久毒身份。 |
| historical快路径 | 已completed/failed直接K历史验证，不先J/H当前receipt；running/needsRecovery也只尝试K有据收敛，不重启。只有完整Execution等于createExecution()的pristine queued可进入J。 |
| 首次执行与返回 | J前readBound稳定核同admission/task；J成功只继续K，K返回必须completed/failed、attempt1/revision>=3，最后再次readBound精确等K结果才返回。没有把J phase当TaskSnapshot。 |
| J失败后的事实方向 | 尝试K；K真实completed可返回真实完成；K真实failed则保留可信Transaction/Release/Lifecycle原错，不编造cancelled。K无证据时只以最新严格bound任务判断：仍pristine queued才保留可信preclaim原错；running/partial/unknown claim均NEEDS_RECOVERY，不reset queued、不补claim或重写文件。 |
| 未知ack | K自有CAS精确读回门禁；runner不替其第二写，不发新ID，不用薄J/读取running补授执行。最终任务读回不等期望时保守拒绝，现场metadata保持。 |
| cancel | 只作用本owner active job：reading设本job撤销标志，executing交J实际门禁，settling拒CANCEL_TOO_LATE。没有向K传abort，也没有声称durable queued任务已取消。 |
| close/drain | 同步closed停新run；reading标取消，executing立即请求J cancel；不close共享coordinator/K/store。等待实际job（包括J错误后的K与read-back）settle，再清轻身份；相同close返回同Promise。 |
| 错误边界 | 可信固定typed错误可保留，未知异常统一NEEDS_RECOVERY，不将raw message/path转发。纯metadata历史分支和K结果不会因本ownerclosed而被伪造成已取消任务。 |

## 主协调发现并已闭合的close边界

初稿close直接调用port.cancel(...).catch，若main-owned wrapper在返回Promise前同步throw，会使close提前逃逸、未建立drain。最终已在**同步调用**外加try/catch，即使wrapper抛错仍建立closing并等待原job；没有用Promise.then推迟停止信号。已只读复核最终控制流。

单纯吞掉停止请求异常不等于job已经停止：代码仍await原job.result，K仍可完成CAS或读回；不会通过关闭共享K导致J cleanup后才发起的settlement被CLOSED拒绝。调用者仍负责只在runner排空后按所有权关闭共享服务。

## 既定边界与后继

- root互斥依赖受审main装配，不能宣称跨独立runner/coordinator的系统锁。该约束尤其重要于J结束到首次K期间，不允许后继事务提前推进receipt。
- K失败后的pristine queued分类依赖真实J先H/无journal及root唯一writer；它只保留本次错误，不产生新许可。当前没有确定越权反例要求为理论增加journal端口或新格式；unknown/running仍保守拒绝。
- cancel读取阶段返回请求已标记撤销，不等于metadata任务已持久cancelled；settling TooLate表示不打断结算，也不代替durable queued控制协议。
- close可在历史metadata读取前阻止本次请求继续，但已经进入K后不abort未知写；J失败回滚后真实failed与原CANCELLED可同时成立，不能改成TaskSnapshot.cancelled。
- 不新增启动自动execute、持久队列、queued取消、结果/error schema、任务target/观察控制、公共backend或真实配置。source/key/locator/许可政策仍空，production仍no-port，不广告execute。

实现代理报告最终typecheck/runner lint均0；测试代理首轮6项通过，原lint prefer-const及close加固前证据均保留。最终冻结源码对应的重编测试和主协调fullcheck以其最终原始日志为准，本审查没有再次运行或把旧摘要轮次移作最终结果。本报告现冻结，交主协调精确收存。
