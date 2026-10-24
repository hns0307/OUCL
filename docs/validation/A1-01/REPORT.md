# A1-01 纯版本解析增量

日期2026-10-24。用户已在问题面板明确批准“阶段1A下载与启动闭环，持续实现并提交”；本轮是该范围内首个业务增量，不代表下载、安装或启动闭环已经完成。

## 实现与边界

新增core/version/types、validation、arguments、resolve。纯函数接受调用方已获取并验证的client文档映射及平台事实，不访问Electron、Node IO、网络、环境变量、时钟或进程。

验证继承循环、缺父、32层上限及ID一致性；最近带downloads.client的祖先作为jar来源，服务端下载不能代替client。库按group/artifact/classifier/extension身份覆盖，不按文件名碰撞合并。保留可信制品摘要、大小、路径及native解压排除项；OS/name、arch/version正则与features按规则顺序匹配，规则存在默认deny，最后匹配项生效，缺失feature视为false且不读取原型属性。

支持现代条件game/JVM参数和旧minecraftArguments词法，保留路径空格与空参数，不执行shell；占位符仅单次字面替换，未知/不完整/递归占位符拒绝，不从系统环境兜底。规则正则做长度及复杂度限制，复杂量词/回溯引用拒绝，不能据此承诺支持任意第三方规则表达式。现代mainClass需有效Java类名；无Java要求元数据时沿用旧版候选8，不声称已经匹配实际运行时。

输入结构验证不建立来源信任；服务层仍须官方HTTPS/摘要链核验。没有下载器、磁盘布局、实例操作、账户或进程拉起，没有新增依赖/IPC/存储schema。首版Windows x64以外及古早版兼容声明继续按实测分档。

## 验证

`pnpm check`实际退出0：strict类型检查、lint、18项测试全部通过（原6项握手+12项版本测试）、Vite/esbuild构建通过。核心单测无Electron或真实IO；测试入口按文件编译后使用Node内置coverage，仅计core模块，不把测试本身算入覆盖：行100%、分支99.14%、函数100%。已配置行/分支/函数各≥85%门槛。证据见[check.log](check.log)（归档时仅移除工具输出行尾空白）。

`node scripts/verify-version-samples.mjs`从官方manifest获取并逐项核对三个版本描述SHA1，再调用同一core解析器，退出0，见[official-samples.json](official-samples.json)：

| 样本 | 元数据要求Java | 选中库数 | game/JVM参数数 | 结果 |
| --- | --- | --- | --- | --- |
| 1.21.1 | 21 | 70 | 22 / 9 | metadataParsed=true，gameLaunched=false |
| 1.12.2 | 8 | 30 | 18 / 0 | metadataParsed=true，gameLaunched=false |
| 1.6.4 | 8 | 15 | 10 / 0 | metadataParsed=true，gameLaunched=false |

这是独立联网验证脚本，不在单元测试中使用真实网络；未下载JAR/库/Java，未启动游戏。根manifest信任引导为固定官方HTTPS，后续描述核对其中的官方SHA1，不伪造未提供的签名。旧样本解析通过不等于旧版natives、Java、图形与实际启动通过。

首次lint发现正则中的控制字符检测违反no-control-regex，已改为显式NUL检测并复验。新增代码均独立编写，不复制参考启动器实现或测试夹具。下一增量A1-02路径/身份/隔离纯策略，随后按依赖推进可信下载与实际启动；完整目标保持未完成。
