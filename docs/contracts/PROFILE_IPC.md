# 档案与Java选择公开接口 v1

## 0.2.0 当前补充（2026-10-25）

用户明确批准前端改版计划，已增加`settings:update`与实际设置界面。`settings:get`现返回独立设置记录的revision以及已保存memoryMiB/isolationDefault，缺失记录保持2048/true；Java/账户仍沿用原记录。更新输入、错误、CAS和固定存储记录见[设置契约](../SETTINGS.md)。下文保留最初增量的历史状态描述，不覆盖本补充。

落实已批候选java:choose、accounts:list、accounts:createOffline、settings:get。固定信封contractVersion:1/requestId UUID/payload，返回固定data或脱敏AppError。精确schema见shared/contracts/profiles.ts；handler先sender与主frame/document、再输入校验，再调用服务，并再次检查输出，额外路径/UUID/堆栈字段均拒绝。能力java.v1/accounts.v1/settings.v1仅实际服务已装配时开放；本增量不包含java:detect/install或settings:update。

- java:choose空payload，原生选择器由main打开，过滤exe后JavaProbe固定参数实测；返回cancelled或chosen+JavaRef(javaId/major/arch:x64/source:system/available)。不返回可执行路径。130秒renderer等待覆盖选择/探测；超时不取消native动作，重试同requestId复用有界选择Promise，单应用至多16在途/64缓存，窗口销毁释放观察缓存。
- accounts:list空payload，返回最多1000个AccountSummary(accountId/kind:offline/displayName/gameName/ready)。accounts:createOffline仅displayName/gameName，3秒；按已批D-20验证，原ProfileService原子保存身份及request结果。超时保留requestId重试，编辑表单创建新请求；不返回游戏UUID、token、邮箱或原始记录。
- settings:get空payload，3秒，返回revision、可选rootId/javaId、当前默认memoryMiB:2048/isolationDefault:true/theme:system。javaId表示已登记选择，不能代替启动时可用性探测；当前没有设置修改界面。

UI提供原生Java选择入口、已登记提示、中文昵称与ASCII游戏名分离、档案创建/选择及离线边界说明。主进程退出前ProfileService.close停止接收写入，等待已有Java探测及串行提交，再关闭storage；不让版本探测遗留到应用退出后。
