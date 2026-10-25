# Java与离线档案记录

依据2026-10-25用户D-20直接批准：游戏名3–16位ASCII字母/数字/下划线，大小写作为原始游戏名保留。UUID使用UTF-8 `OfflinePlayer:<gameName>`的MD5，设置RFC UUID v3/variant位后生成并永久保存；MD5仅用于Minecraft兼容身份。显示昵称独立，允许中文且限80字符、无控制字符；修改游戏名创建新的accountId与UUID并保留旧档案。当前没有显示昵称修改API，更没有正版认证。

固定私有JSON域`launch-profiles`，沿用schemaVersion:1/revision/data、原子提交与原SQLite操作日志/CAS：data为`{javas,selectedJavaId?,accounts,requests}`。javas最多32项`{javaId,executable,major:8|17|21,version,vendor}`；仅本机已明确选择并由JavaProbe实测的Windows x64运行时。重新选择相同规范路径保留javaId，更新探测事实并设selectedJavaId；没有受管下载、供应商选择或磁盘扫描。

accounts最多1000项`{accountId,displayName,gameName,uuid}`，精确同gameName不能创建重复档案。requests最多2048项`{requestId,digest,accountId}`，成功创建结果与档案一次JSON事务提交；同requestId同规范payload重试返回同档案，改变payload拒绝。账户与Java写入由单服务串行防止互相覆盖。请求记录不因超时删除；限额到达明确拒绝，不截断身份或静默替换旧档案。

worker仅提供profiles:get/profiles:set两个固定typed命令，严格请求/响应及envelope验证，不能指定recordId、路径、SQL或任意JSON。只有主进程内部记录含Java可执行路径与游戏UUID，未来公开适配仅投影JavaRef/AccountSummary，不将这些内部字段返回renderer。启动时仍须重新探测Java、核对版本/可用内存及实例依赖。

本增量是正式持久服务与worker接线；accounts/Java/settings/game公开契约及产品选择/启动UI尚未接入，不能将此当作最终exe已可启动。
