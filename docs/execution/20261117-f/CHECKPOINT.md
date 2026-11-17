# A持续实施恢复点

F已完成持久确认元数据服务和真实合装：954项950PASS/0FAIL/4SKIP、type/lint/build0；证据见REPORT.md。A授权继续有效，不重复问批准，source/key/站点保持空。

下一小步G：内部storage原子claimDistributionTask，完整绑定root/proposal/inputDigest/task/kind双表，只允许pristine queued attempt0/revision1/lastSequence0/bytesDone0/no bytesTotal，经controlTask(start)持久写running后才返回本次许可。重复或重启needsRecovery不授执行；ack未知不以读回running重授。无新schema/IPC/依赖。

后继executeAdmitted必须读取durable admission而非Prepared；protected native factory必需，重新核初始快照/目录/当前可信发行/领域许可/idle后才claim。partial journal显式恢复；terminal只读核planDigest/gameIdentity及私有receipt准确前后方向，禁止复用legacy commit的弱终态捷径。journal缺失且任务已running/needsRecovery不盲重放。

公共backend/facade、任务状态/目标/取消恢复、UI及configured内链验证仍未完成，生产继续关闭。候选C仅当时构建快照，不宣称包含F。保留历史失败，不覆盖正式EXE，不push。
