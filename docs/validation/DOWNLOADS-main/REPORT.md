# main下载优化验证（2026-10-26）

G2用户明确批准，main独立工作目录；没有合入加载器/Mod代码，无新依赖、不push、不发布。原目录两份原始资料及WIP未动。

- 完整pnpm check：276项274通过、0失败、2原有软链接权限跳过，类型/lint/build通过。日志.test-build/download-check-complete.log。
- node scripts/verify-download-ui.mjs：实际main/preload/UI选择BMCLAPI、6文件/3连接保存；CAS冲突、任意URL拒绝、旧settings响应投影、内存修改保留下载偏好、独立进程正常重开通过。大小窗口截图已实际看过，无横向溢出。
- pnpm smoke：原四页/真实官方目录/离线档案/安全边界通过，26方法、11能力（downloads.v1按Installer可用广告）。证据electron/。
- node scripts/verify-download-network.mjs：官方client23028853字节和BMCLAPI guava2959479字节完整SHA1独立通过。镜像302→CERNET→齐鲁→200，镜像始终单流。仅允许实际核对的三个HTTPS主机，未知节点回退官方。官方样本原始ETag无引号，因此严格回退单流，officialParallelObserved=false；首轮把“实际分段”当预期的失败证据另存network-initial-no-strong-etag.json，不能将本轮写成公网分段/吞吐提升通过。精确Range/标准强ETag分段、乱序前缀/取消恢复/实体变化/超时/坏长度/弱ETag/镜像hash失败均由本地可控HTTP及独立worker测试验证。
- node scripts/verify-download-game.mjs：全新download-regression测试根官方1.20.1，3641制品、735814641字节、3641回执、严格校验及物化通过，306393ms。首轮真实启动主菜单及Quit Game退出0，由computer-use观察；使用Oracle快捷目录先被JAVA_INCOMPATIBLE拒绝，换真实D:/Java/jdk-17后通过，保留首失败。
- 第二次原版启动发现既有native运行缓存污染，严格检查返回NEEDS_RECOVERY。待迁入mod分支已验证的通用缓存隔离修复并重新验证；此时不称重开通过。
- 0.2.3小EXE241152字节，首候选与最终候选均保留。最终SHA256见../BOOTSTRAP-0.2.3/package.json。真实单EXE冷启动23.51s为前一载荷候选；最终载荷热启动1.284s、同级OUCL.runtime复用、无renderer Node、正常退出释放owner通过。19引导测试通过，依赖审计无已知漏洞，127包许可无待审。

当前交付尚待原版重开修复；不关闭历史阶段缺项，不声称公网大文件分段已观测。后续完成主分支验证、交接/本地提交后，将仅下载优化与通用修复同步mod_loaders再恢复原计划。

## 原版重开补证及最终候选

通用native运行缓存隔离已从mod分支设计手工适配至main，不带Forge/加载器逻辑：JNA、LWJGL与Netty运行写入进入实例.oucl-launch私有目录，受校验natives保持只读用途；旧受污染测试natives仅在本轮download-regression根改名保留，生产不自动迁移/删数据。新增单元测试后完整pnpm check277项275通过/0失败/2原有跳过；新验证入口补lint通过。

node scripts/verify-download-production-launch.mjs D:/Java/jdk-17/bin/java.exe first / second：正式ProfileService/InstallerService.prepareLaunch/LaunchService分别启动同一原版实例，主菜单与Quit Game均由computer-use实际观察；两次自然退出0、worker/storage正常关闭，证据game/production-launch-first.json、production-launch-second.json。没有测试世界，不冒充完整1A世界矩阵。

官方If-Range补测（azure-if-range-probe.json）：raw旧Azure标识、加引号相同标识、错误标识均返回200整文件，未满足严格Range+强ETag条件；请求x-ms-version2011-08-18或2023-11-03及no-cache仍返回2009-09-19旧版响应。微软官方Get Blob说明2011-08-18后ETag才加引号：https://learn.microsoft.com/en-us/rest/api/storageservices/get-blob 。保持原条件，不擅自引入旧Azure兼容或放宽校验。公网实际分段验收仍未通过，条件性能力与安全回退已验证。

最后交付EXE含缓存隔离修复，精确bytes/SHA256见../BOOTSTRAP-0.2.3/package.json，旧候选1/2以独立文件保留。最终EXE热启动证据smoke-cache-fix.json；首候选冷启动只证明相同引导流程，不能冒充最终载荷冷启动。
