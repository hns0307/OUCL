# v36：网络早 close 的安全补证

2026-11-15。用户在v35有限收尾后要求继续，主协调恢复一个有界残余证据诊断，原C对话承担独立只读源码/旧证据审查及结果复核。**新证据已证伪“ClientRequest close 足以证明响应事务结束或不可取消”的旧壳判据，未发现生产代码缺陷。** 四个无窗口诊断用例通过，第二轮真实子进程exit0；C公网pending取消仍NOT_EXERCISED。没有新产品窗口、生产改动、依赖、公开契约或安全设置变更。

## 既有问题与新可检验假设

v17/v20旧壳记录finish→close→拦截→ERR_BLOCKED_BY_CLIENT，旧guard因此拒绝进入hold；且永久引用首对象、第二请求仍检查首对象，请求与Chromium拦截ID仅按创建顺序候选关联。v20诊断本身对所有命中回调返回cancel:true。上述材料不能直接反推公网错误根因或产品取消失败，原UNKNOWN保留。

原C只读审查核对了[Electron45.0.0的ClientRequest实现](https://github.com/electron/electron/blob/v45.0.0/lib/common/api/net-client-request.ts#L311)：Writable及autoDestroy生命周期与底层网络loader不应混同，源码还有在Writable销毁后处理网络错误的分支。与[官方API文档](https://www.electronjs.org/docs/latest/api/client-request)的close末事件描述有张力。仅此是可检验假设，root随后在本机同版运行时做了直接观测，不将静态假说充当运行结果或跨版本保证。

## 实际诊断及独立复核

独占目录D:/MC_start/OUCL-network-semantics-v36-20261115；Electron45.0.0/Node24.22.0，Electron可执行文件SHA与v32预置运行时一致。第一轮3个原生用例保存原始结果；第二轮加入生产适配器共4个用例，Node协调器持有自己的无窗口子进程并记录exit code0/signal null。脚本未创建BrowserWindow，实际计数0；没有操作旧产品窗口或玩家资料。

| 用例 | 实际关联和观察 | 有限结论 |
| --- | --- | --- |
| 回环response | 单私有session、随机唯一路径、一个POST；同对象finish/close后服务器才收到完整请求，受控150ms后释放响应，再收到HTTP200及response end | 本次close并非响应事务结束 |
| 回环abort | 服务器已收完整body且保持响应未结束，同对象原生abort调用/事件后服务器response对象close、writableEnded=false、客户端无response | 本机在途事务可在上传对象close后取消；不是独立TCP socket-close抓包 |
| session主动拒绝 | 唯一随机URL/单请求精确匹配，回调cancel:true一次，之后同对象ERR_BLOCKED_BY_CLIENT | 此受控拦截能产生blocked错误；reject结果abort:true是finally清理，不是产品取消 |
| 实际编译createDesktopFetch | 导入统一full-r3编译的生产network模块；私有session只一个精确Modrinth HTTPS URL/POST在onBeforeRequest暂留，外部AbortSignal触发原生abort调用和事件各一次，fetch拒绝AbortError、无response；随后唯一回调cancel:true | 生产适配器信号到真实Electron请求的受控链路通过；不是C预览领域/IPC/GUI或公网wire取消 |

root独立事件顺序及运行时/源身份审计四项为真；C另对r2代码/结果/轨迹/进程退出记录只读复核，支持以上限定结论。networkAllowed:false是探针初始化字段，不能充当无底层网络包的独立证据；adapter回调进入/返回没有单独trace，代码计数与成功退出只提供有限支持。serverReceived=false是观察到断言时没有完整body，不等于无网络流量。源TS/编译模块hash已记录，但不额外声明逐源到最终bundle映射。

## 对既有验收的实际影响

旧壳的closed排除条件在本机同版被反例证伪，之前“已close所以不能是pending”的诊断解释不再成立。正确后续探针需对同一请求建立唯一关联，并使用response/错误/abort等事务状态或独立服务器活动证据；不能只看上传Writable的close。旧壳、guard、日志及报告不改写，本次也不以删除旧guard直接宣布取消通过。

**旧v17/v20每个请求的历史具体对应仍UNKNOWN；C公网pending取消保持NOT_EXERCISED。** 新增实际native回环活动性及生产适配器受控取消证据，不冒称公网Modrinth响应、完整C预览取消或新EXE GUI验证。对旧blocked错误只在新唯一关联的主动拒绝对照中建立因果，不倒推旧记录。

v35的选定功能有限接纳、本地整合和四游戏/正常重开结果保持；A最终EXE强杀及不可达非主frame安全边界保持。后续若继续产品链路，应在新独占资料上关联同previewId、原signal/native abort、取消早于12秒timeout及领域回执/资源释放，并明确受控拦截与实际公网的层级，不能由本次结果自动升级。

源码未变，无重复全量测试/构建。没有重启已结束的验收轮询，没有push/发布；共享活跃树不清理、切换或整体暂存提交。脚本、轨迹、结果和两份独立复核随SHA256.json固定；profile缓存不入Git。
