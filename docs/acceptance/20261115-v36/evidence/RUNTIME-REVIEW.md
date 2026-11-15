# v36 r2 运行证据独立复核

2026-11-15。只读 `D:/MC_start/OUCL-network-semantics-v36-20261115/{probe-r2.cjs,run-r2.mjs,result-r2.json,trace-r2.jsonl,process-exit-r2.json}`；未执行脚本、网络、GUI 或构建。结论：四项**限定范围内**与协调方描述一致，但有几处字段不能单独作为网络或取消因果证据。

- **本机 response：支持。** `probe-r2.cjs:10–18,21,25–31` 是随机唯一路径、单个 Electron ClientRequest 和 `127.0.0.1` HTTP 服务；`trace-r2.jsonl:1–8` 同模式显示 finish、close，之后服务收到完整请求体、释放响应，再有 HTTP 200 和 response end。证明此运行中 request 的 close 不是响应事务已结束；不证明旧请求与旧 interception 的关联。
- **本机 abort：支持。** `trace-r2.jsonl:9–15` 表示 server 收完整 body、暂不释放响应，随后 probe 调原生 abort，客户端观察 abort，server 的 **response 对象** close 且 `writableEnded=false`，无 response。此为本机受控对端；日志没有单独记录 TCP socket close，不宜称已直接观测 TCP 关闭。
- **session 拒绝：支持限定结论。** `probe-r2.cjs:21–25,36` 唯一随机 URL 与单请求精确匹配，回调计数 1，`trace-r2.jsonl:16–20` 记录拦截后目标对象 `ERR_BLOCKED_BY_CLIENT`。`result-r2.json` 中 reject 的 `abort:true` 来自 probe 的 finally 清理（第 39 行；事件在 trace 第 21 行），不是产品取消，也不是请求在 block 之前被取消的证据。serverReceived=false 只是到断言时未收到完整 body，不能单凭此字段证明没有任何网络流量。
- **实际编译 adapter + 受控拦截：支持有限链路。** 第 44、47–65 行导入指定 full-r3 编译模块，以私有 session 的精确 HTTPS URL/POST 暂留回调；`trace-r2.jsonl:22–25` 记录 pending→外部 controller.abort→原生 abort 调用→abort 事件，`result-r2.json` 记录一次拦截、一次调用/事件、AbortError 和无 response。之后仅调用一次 `callback({cancel:true})`，未执行允许分支；但 trace 没独立记录 callback 进入/返回，`networkAllowed:false` 是初始化常量（第 46 行），不是 wire 观测。该编译文件与最终交付产物的字节身份、本次没有发出任何底层网络包，均不能仅由上述四文件独立证明；源码/构建身份交协调方另核。
- `process-exit-r2.json` 记录由 `run-r2.mjs` 监听到子进程 exit code 0、signal null。脚本未创建 BrowserWindow，计数检查为 0；不涉及产品 GUI。

**范围：** 本机回环是真实 HTTP，adapter 场景是真实 Electron 请求对象与 session 拦截、尚未放行的 HTTPS 请求；不是公网响应、Modrinth wire 取消、C 预览领域取消/GUI 证据。它强力支持本机 Electron 45 中上传对象 close 可早于真实响应及 abort，但不反证旧 shell 其他因素、也不能反推出 v17/v20 的具体请求身份；旧公网 pending 取消仍为 NOT_EXERCISED。
