# 方案A：持久确认服务 F

当前G2，沿用户明确批准的方案A从e666a2a5继续；真实来源、公钥、站点仍空。本片只连接可信ticket、私有接纳及双库任务投影，返回真实同ID回执，不进行文件执行、不开放产品能力。

修改范围：新增confirmation.ts、独立真实合装测试及helper；同步本目录证据、TASK_PLAN/DECISIONS和证据换行规则。元数据链串行、有界singleflight；已持久回执先于内存失败身份查询，未知请求才取票。提交后丢回执仅按原ID读回。全局对账错误不得由单任务读回掩盖；close排空已进入链。

风险：双库没有跨库事务，复用既有outbox/固定ID对账；确认不等于执行许可。启动开放前仍须独立等待完整对账，生产调用层继续无backend。合成来源与许可不等于真实发布者或许可证证据。

验证：独立真实Coordinator/JAR worker/DistributionStore和StorageClient worker合装，含提交后丢ack、服务重开、关闭排空及不同proposal并发；然后运行实际全量test.mjs、tsc、ESLint及build.mjs，独占测试/构建目录，原始日志保留。结果另记，不预报通过。
