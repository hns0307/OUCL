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
