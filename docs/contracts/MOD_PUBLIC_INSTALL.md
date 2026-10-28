# Mod安装公共接入

沿用用户批准的mods.v1确认/取消方案，增加严格入口：

| 通道 | 请求 | 响应 | 超时 |
| --- | --- | --- | --- |
| mods:confirm | planRequestId UUID、planId SHA256、confirmed:true | taskId UUID | 15秒 |
| mods:installState | planRequestId UUID | task快照或null、受控errorCode、ModReport摘要或null | 15秒 |

sender、主frame、确切请求键和返回结构复核沿用原handler/preload；不接受目录、URL、执行参数、可选任意下载或客户端自造准备结果。确认的稳定幂等身份为已保存计划UUID和planId，外层requestId只关联应答。取消/重连复用tasks.v1，不新增进程执行入口。

主进程装配真实ModInstallPreparation、ModTransactionService、ModInstallTaskService。每次确认先持久接纳，再重新复验与下载；任务UUID贯穿consumer和事务。task列表/get/订阅增加mod-install投影；提交边界后控制取消明确CANCEL_TOO_LATE。退出先等待安装执行器，再关闭计划/检查/传输/存储，不让在途工作访问已关闭worker。

状态查询复核当前root、不可变计划、接纳任务和结果的关联。快照只公开状态/进度/受控错误，检查摘要使用既有有界ModReport；共享对象、完整metadata、日志token和物理路径不公开。写入结果未知时公开递增修订的needsRecovery，界面接受新快照；无事务的孤立确认不重放。

资源库选中的已下载Mod先展示精确项目/版本ID、文件、来源、大小和依赖来路，再点击“确认安装到此实例”。可选依赖不自动加入，已有Mod不升级。尚未确认可取消计划，接纳后改用任务取消。刷新后用计划UUID恢复原任务；已安装造成实例修订增加时仍可查看历史安装结果，不能把旧计划重新用于新修订写入。失败后应重新生成计划。

完整来源→真实JAR复验→独占事务均复用原服务，不把平台标签当modId或实际版本。检查通过仍只表示已知声明满足；未执行的游戏实机矩阵保持未验证。签名远程分发、后台、正版登录不在本接入内。
