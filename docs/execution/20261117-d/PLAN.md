# A内部确认材料增量

沿用户持续批准A，从46197ef9继续；C候选26项/937项回归已保存。baseline独占execution.ts内部ticket实现，ui独占真实confirmation-ticket tests及测试helper最小进程隔离，n1只读审查，主协调全检/记录。当前起点primary61%已用，不扩大为完整task executor。

ticket(proposalId)只读取真实Prepared的plan/rootIdentity/previewFingerprint/releaseSha256，重验ready/TTL/conflict、domain前后完整snapshot、当前key/time和最后accepted archive；返回clone。singleflight只留在途，legacy confirm互斥，纳入jobs使原cancel/close真正drain；不得admit/建task/写文件。内部proposal新增真实instanceRevision以供后继公共DTO。

真实worker/JAR/Store场景验证材料→独立admit、无文件发布、字段不别名，变化/发行前进/TTL/取消关闭/并发互斥；完整type/lint/test/build。为新旧测试文件并行csc编译避免同路径，测试fixture ROOT按process.pid隔离，不改生产或串行掩盖race。

公开pipeline仍no-port，不广告execute，source/key仍空；本材料不是durable授权，后继接纳/执行必须独立权威复验。无新依赖、schema、公共方法或EXE覆盖，不push/动原WIP/tmp。
