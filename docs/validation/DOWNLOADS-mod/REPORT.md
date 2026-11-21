# 下载优化同步mod_loaders（2026-10-26）

main已独立交付0.2.3（main:d2521bb），src仅限定下载偏好、传输、界面及通用native缓存隔离；未将加载器/Mod并入main。main真实公网镜像摘要、原版整批安装/两次菜单退出0及最终小EXE冷/热启动证据保留在D:/MC_start/OUCL-download-main/docs/validation/DOWNLOADS-main/。

本分支手工适配Installer已有加载器构造参数，保留loader信任来源/主机、四加载器、instances.v2、mods.v1及原ModUI。偏好已有68542ab，不重复迁移；传输与设置UI同步main，downloads.v1实际可用广告，32方法/14能力。

pnpm check397项395PASS/0FAIL/2原有SKIP，类型/lint/build通过（check.log）。node scripts/verify-download-ui.mjs保存BMCLAPI/6文件/3连接、严格入参/修订冲突、内存设置保留及独立重开通过。pnpm smoke原四页/官方目录/账户/设置及Electron安全边界通过，证据electron/。无新依赖，不打0.3.0交付包。

原WIP先复制并逐个SHA256核对，再保留patch及原件至.test-build/download-wip-preserved-20261026/，未丢弃。原两份暂存资料仍单独暂存且排除提交。不push/发布、不碰用户游戏数据，自动化PAUSED不变。官方公网强ETag/If-Range不满足时安全单流回退，公网分段性能验收缺项仍保留。

下一：恢复Fabric/Quilt官方CATALOG_UNAVAILABLE诊断、四加载器矩阵、Mod依赖候选/确认事务及未来分发契约测试适配器，0.3.0仍未交付。
