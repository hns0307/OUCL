# r2 保存点（2026-11-16）

当前增量已完成相对句柄原生helper、严格stdin协议、Node内部factory、固定摘要构建和包审计支持；尚未接入公共分发执行。Windows本地固定NTFS限定，不推及网络盘或其他平台。

最终完整测试：node scripts/test.mjs，使用独占OUCL_TEST_ROOT与提升权限的真实文件/回环环境，832项828 PASS、0 FAIL、4既有SKIP，exit0。原始日志及结构化退出记录见final-evidence。helper专项14 PASS，wrapper/factory专项12 PASS；历史失败与v1—v4演进证据保留。

独占build目录D:/MC_start/OUCL/tmp/r2-final-build/dist已产出native侧车。此前并行启动的全类型、lint、build与bootstrap命令退出输出在上下文交接中未保全，故此处不登记通过；恢复后补存退出证据。没有打包新r2候选，没有新候选实际运行结论。

额度实测primary 300分钟used90%，剩余10%，按既有规则停止新增实现和打包，仅保存。未使用额度重置或购买；周额度不作为停止条件。

恢复次序：1.补存类型、lint、build、bootstrap退出证据；2.独占execution-20261116-r2 tag打包，审计11应用文件与runtime摘要；3.使用OUCL_PACKAGE_EVIDENCE_DIR新证据目录运行候选smoke；4.继续文档中无外部依赖的授权增量。保留旧正式EXE和原工作树WIP，不push。

真实N5站点与N6 HTTPS来源/sourceId/keyId/公钥仍为空；真实执行、域适配与实际分发验收未完成。journal v2绑定gameDir dev/ino，旧v1停止且无静默迁移。产品执行未开放，测试内存authority不能冒充真实owner全链路。
