# 2026-11-16 持续执行记录

起点：main `49086688`。用户持续执行授权和“继续”指令有效；真实站点尚未确定，分发来源/公钥继续空配置。原mod_loaders WIP未覆盖，未push发布。

## 本轮实际交付

1. **N6内部可信执行链**：独立v2签名发布协议绑定source/package/version、单调sequence、有效期和v1清单摘要，不改变v1签名字节。私有SQLite仓库有真实OwnerGuard独占、高水位CAS、已认证发布归档、journal和包收据原子提交。prepare读取真实文件和私有归属，confirm重读快照、当前pins/有效期/目标并验证领域端口，事务在同一gameDir锁下暂存/备份/发布/回滚；旧journal必须由新metadata owner证明才能恢复。收据提交事务内复核最高发行序号和归档，阻止最后授权后高序号竞争穿透。
2. **安全与严格解析修正**：v1清单/收据不再把数组或对象强转为枚举字符串；有效v1规范签名字节保持。v1读取/取消不会因注入fetch/body/cancel忽略AbortSignal无限等待。store统一映射SQL/文件错误，关闭竞态有受控错误和幂等close；终态journal留下的本人lease也能重开清理。
3. **冻结只读首片候选**：`release/OUCL-0.3.0-execution-20261116.exe`，433664字节，SHA256 `7ee7bfc5166659361dc39b575c6e82324156a5caa22c8a9b7d817b7d93b2265e`。冻结源码49086688与打包脚本增强；不含本轮未接公共入口的N6内部执行链。内嵌九文件/七产品摘要核对通过，旧正式EXE和原dist保持。见[打包记录](PACKAGING.md)，候选有限运行结果以该报告后继及运行报告为准。

**产品边界：本轮N6仍是内部服务，未接main/preload/UI执行接口。** 已有产品只能只读预览，默认源和公钥为空；测试临时密钥、合成制品和注入validate端口不等于真实JAR/许可或远程分发验收。

## 验证

最新完整回归 **796项：792PASS / 0FAIL / 4既有SKIP**，Node子进程exit0，56.853秒（最终强制journal guard后复跑）；独占D:/MC_start/OUCL/tmp/n6-final-20261116/tests，经自动审核允许原断言所需真实链接/回环，未改断言或skip。[原始日志](final-evidence/test.log)、[退出码/计数](final-evidence/test-status.json)。类型、全lint与独占build均exit0；bootstrap34项与候选打包/九文件审计由打包子任务独立记录。专注测试合计48项新增：发布10、事务18、内部编排12、仓库5、解析与取消3。

独立review记录：[发布/仓库](RELEASE-PROTOCOL.md)、[编排与事务审查](EXECUTION-REVIEW.md)、[事务故障矩阵](TRANSACTION.md)。已实际修复并复验空receipt摘要异常、prepare后撤销、确认接纳前取消、SQL原生异常外泄、close/read竞态、最终提交时高水位变化、终态日志与lease释放间故障。

本轮构建只写独占tmp输出。源码改动后的真实GUI/新游戏矩阵未重做；不能用796单测全过替代游戏或候选EXE验收。源配置为空的产品测试、合成bridge组件测试、真实签名/文件事务测试分别记录，不能互换层级。

## 保留的准入缺项

- 独立审查指出Node路径检查后rename/unlink有外部进程竞争窗口。现有private staging/metadata/gameDir租约约束本客户端，不能证明对任意外部进程的原子文件身份隔离。内部实现不接产品执行，不能声称该风险已经消除；Windows同handle原子操作spike由独立子任务有界验证，见后继FILE-GUARD-SPIKE.md（存在时）。
- 动态trust配置尚无持久代次的跨域提交门禁；当前同步pin复验覆盖已测窗口，不承诺任意时刻热撤销与文件提交原子一致。产品默认静态空配置。
- coordinator最多保留16个请求，TTL不回收身份。内部按批次生命周期使用；常驻产品前需定义有界tombstone/过期身份语义，不能静默复用旧ID。
- 真实来源、公钥、制品映射和JAR/依赖/许可证适配仍留空。强类型validate/artifact端口不是完成了这些产品适配；不能省略它们接确认按钮。

下一最小增量是先关闭原子文件操作准入缺口，再做产品执行契约/持久任务/确认接线；不是直接把当前内部commit暴露为通用IPC。本报告不宣称技术文档所有任务已完成。


## 收尾核验与继续入口

最后收据写入已收紧为必须存在对应applying journal，禁止无journal绕过高水位核验；17项仓库/编排真实集成复跑通过，随后完整796项再次792PASS/0FAIL/4SKIP，typecheck/lint均exit0。修复前完整日志保留为final-evidence/test-before-receipt-guard.log，不覆盖为新结果。

候选外层运行结论为未通过：包内main/renderer/preload和独占profile实际加载，Electron正常exit0，但握手capabilities为空、分发服务UNAVAILABLE，初始化根因UNKNOWN。退出后九应用/73运行时摘要保持；不以正常退出或完整性替代初始化成功，不替换正式EXE。

Windows文件guard spike唯一一轮为1PASS/3FAIL、exit1，同handle删除通过，目录guard失败使两rename格未实际到达；状态NOT_READY。原始失败和源码保留，不修断言/不记通过。继续前优先修父目录guard并真实证明不覆盖rename/精确身份删除，再考虑产品执行接线。
