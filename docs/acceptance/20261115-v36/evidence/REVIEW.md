# C 网络早 close：只读诊断审查 v36

2026-11-15。稳定 main `aefc67aa839883b8bca43ffe7f47c580db0ced26`，产品 `0c2a889c`；工作区干净。既有范围为只读预览及取消，v35 仅有限接纳，不增加业务授权。审查结论：旧网络取消仍 **NOT_EXERCISED**；旧壳早 close 的机制有一个由 Electron 45 官方源码支持的可检验解释，但不能仅凭现有日志确定因果，更不能断言产品取消成功或失败。本轮没有启动 GUI、网络、测试或构建。

## 确定事实和关联限制

- v17 `docs/acceptance/20261113-v17/evidence/window.cjs:23–29,45–46,53–63`：`heldRequest` 永久选第一个目标 ClientRequest，close 置 `closed`；命中 `version_files` 时若该标志已真则立刻 `callback({cancel:true})`。第二个请求仍检查第一个对象。`ATTEMPT-RESULT.md:20–28` 及 v17 REPORT 表明两次都走了拒绝分支，未有 cancel IPC 或原 abort 证据。
- v20 旧独立壳 `D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/c-network-diagnostic-v19/window.cjs:20–36,38–51`：包装原 `net.request`，session 层对匹配 http/https 的**所有** onBeforeRequest 回调立即调用 cancel=true；此前仅计算旧 guard，没有实际 hold。`window.jsonl:17–23,25–31` 分别为请求对象 1/2 的 finish→close，之后出现目标 POST 拦截 7/8、立即拒绝，再分别记录对象 1/2 的 `ERR_BLOCKED_BY_CLIENT`。每次 callback 各一次；没有测得 ClientRequest 与 interception ID 映射，仅按创建顺序列候选；也未记录 `resourceType`、`webContentsId` 或 frame。因此不能排除不同请求交错、导航/其他发起者或错误配对，不能将两者视为已证明同一请求；目标 URL/method 匹配本身亦不能证明身份。默认 session 能看到目标回调，不等于已测得对象 session 身份。
- 已知该壳自身明确拒绝目标回调，后续 blocked 错误与之相容，但没有独立对照或同一 ID 的已证关联，不能排除其他机制，也不能把回调发生之前的 close 直接归因为该回调。v17/v20 不是公网响应：拦截层未放行；v26 合成传输与本问题不同，不作为公网证据。

## close 的关键解释：官方文档与同版本源码有张力

[Electron ClientRequest 官方文档](https://www.electronjs.org/docs/latest/api/client-request)描述 `finish` 是请求数据写入对象后的事件，`close` 为事务末事件、之后 abort 无效；但旧日志对**同一个监听对象**记录了 close 后又有 error，和该文档表述不一致。不能只靠 `closed` 布尔断言远端事务已结束，也不能反向断言可取消性。

旧 v3 的 `node_modules/electron/package.json` 为 45.0.0。[Electron 45.0.0 官方实现](https://github.com/electron/electron/blob/v45.0.0/lib/common/api/net-client-request.ts#L311) 中 ClientRequest 继承 Writable、构造时 `autoDestroy: true`；[同版实现的 abort/_die](https://github.com/electron/electron/blob/v45.0.0/lib/common/api/net-client-request.ts#L507) 调用 loader.cancel，且注释和代码显式处理 Writable 已 destroyed 后仍需发出网络 error。结合旧 finish→close→error，这是“Writable 结束产生 close，但底层 URLLoader 仍在途”的合理假说，不是本机归因证明；需核对运行二进制和构建身份并通过独立活动证据证伪或支持。文档和实现存在差异，不能把一个假说上升为跨版本保证。

当前产品 `src/main/index.ts:160` 装配原 Electron `net.request`；`src/main/network.ts:13–24,30,38–55` 的 signal 回调调用原 request.abort 并使 fetch 拒绝，request.end 仅结束发送；`src/services/mods/modrinth.ts:56–61,69–77,91–94` 有一次网络失败重试和 12 秒 controller 超时。因诊断壳本身立即拒绝，重试代码可解释两次请求这种候选路径，但日志未直接证明每次请求的完整归属。

## 建议的最小可证伪诊断（本轮仅建议）

在新独占目录、同版无 BrowserWindow 的 Electron、独立临时 session/本地回环 HTTP 测试服务中，先做**模型级**单一 POST；每次采用新随机路径 token，server 只记录 token 的哈希、收到时间/连接关闭和响应释放，禁止请求体、凭据与用户资料。逐次运行，排除并发、重试与 renderer 导航；在 session webRequest 按精确随机路径过滤，记录 `details.id`、method、resourceType、webContentsId 是否存在及 callback 调用/返回，客户端记录同一对象 finish/close/error/response/abort及单调时钟。随机 URL 只用于本地模型的关联，不修改产品请求或真实平台 API。

1. **可反驳假说 H：**在不拦截或明确放行一次的对照中，若同一 token 对应服务端已收到请求且响应被服务端控制地暂不释放，而 ClientRequest 先 finish→close，随后仍可由同一对象观察到 response，或 abort 后服务端观察到连接关闭且无响应，则直接证明该次 close 不能单独作为网络已完成/不可取消的充分条件。若 close 后服务端从未收到且没有随后网络事件，或服务端早已完成，则未支持 H；需单独记录证据，不能以单一失败原因推断。客户端 abort 以及服务端连接断开属于模型级实际观察，注意其他网络错误也可能致断开，必须记录有界时间和对照。
2. 在独立新 token 上进行原 session `cancel:true` 对照，服务端收到与否和本次对象 error 分别记录；再与放行/无监听对照比较，检验“本拦截能造成 blocked”这一具体假设。若对照因超时、代理或关联不唯一失败，结果 INCONCLUSIVE；不依赖创建顺序冒充跨层 ID。每个回调只调用一次，设置有界清理；不可因删除旧 guard 就声明网络 pending 或取消通过。
3. 只有上述模型确认活动性语义且主协调另行认可实施方案，才设计真正产品链路场景：在安全配置不变条件下提供**可证明同一次产品请求仍待完成**的独立活动证据、同 previewId 的取消先于12秒 timeout、原 signal→request.abort→领域回执/资源释放；无法提供可靠关联就保持 NOT_EXERCISED。回环 HTTP 是合成对端，session 延迟拦截是受控拦截；二者都不是公网 Modrinth 传输。公网成功需另有真实放行及来源证据，不能从模型升级结论。

旧 evidence、产品代码和配置均未修改；本审查不实施上述诊断，不触碰强杀或非主 frame。
