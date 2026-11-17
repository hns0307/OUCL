# r3 内部Mod域适配结果

沿持续内部授权完成LocalModDomain、main-owned typed evidence/context ports和本地证据校验；复用已验纯投影。无新公共IPC/持久schema/依赖，真实配置仍空。

实际结果：证据层6PASS，域类联合15PASS；最新完整874项870PASS/0FAIL/4既有SKIP，typecheck/全lint/build全部exit0。源码与本次独占build摘要见final-evidence/source-and-build.json；完整原始日志与结构化状态均在final-evidence。没有为内部改动重新打包或覆盖正式EXE。

1. 许可必须由main-owned port明确提供，并精确绑定planDigest/operationIndex/artifactId/hash/size；unknown/denied/缺绑定拒绝。此port不是许可来源或自动政策，没有真实publisher启用。
2. 实际游戏根inode、root/instance/revision和runtime事实与计划绑定；本地artifact普通nlink1、前后metadata、真实worker strict scan/size/hash逐次核对。前后stamp不是持handle原子证明，事务copy/native仍独立复验。
3. 前置完整基线与最终投影、后置真实applying journal及全最终库存事实分离；remove已移走旧JAR仍可正常复验。全facts另绑定声明及多哈希，非仅公开库存fingerprint。仅mods顶层JAR，其他区域/nested目标unsupported；有效嵌套JAR事实沿已有unknown/依赖规则保守处理。
4. 真实worker/Inventory、私有SQLite/native和Coordinator prepare→confirm→重复confirm→TooLate→close链已验证。实际replace/remove及未知外改保留needsRecovery有限通过，见DOMAIN-TESTS.md。平台、许可、runtime/context仍是明确合成typed ports；未实际探测JVM/运行Minecraft、访问真实平台或审查许可证。
5. one-active、16session/1024seen、5分钟TTL、clock回退拒绝、取消后清cache留tombstone、close/drain等待实际port/worker退出；扫描事实累计8MiB在循环中限额。clock/prepared-cancel有修复后代表测试；8MiB累计class上界没有额外阈值+1实测，不以静态代码冒充运行结果。

独立只读审查发现clock尾部漏回退后修复；主协调发现扫描事实先累计与prepared取消后cache保留后修复。无这些变更前的完整运行反例，不伪造red日志。首次证据helper type/lint失败（二处Record断言及regex转义）原日志保留，已改显式构造输出；最终全检查通过。测试fixture初次unused import已修，不改断言/skip造绿。

一次误用pnpm typecheck触发隐式依赖修复和registry EACCES重试，代理已停止；没有成功安装证据、初次输出未完整fd归档，不声称不存在未观测行为。随后只用现有父目录固定node工具，git核对package.json/pnpm-lock.yaml无变化，未新增依赖。

公共方案A仍待明确批准，监测通知不等于批准；N5站点、N6来源/sourceId/keyId/公钥仍按用户指令空出。此结果不宣称技术文档全部任务完成或可进行真实分发。

收存格式修正：cached diff检查发现local-mod-domain.ts额外EOF空行，移除并按仓库LF规则规范化；无可执行文本变化，不为纯空白重复全回归。测试时原始CRLF源码保存在final-evidence/tested-local-mod-domain.ts，其SHA与独立专项status一致；source-and-build.json另列测试快照SHA和最终源码SHA，避免将行尾规范化误记为字节完全相同。
