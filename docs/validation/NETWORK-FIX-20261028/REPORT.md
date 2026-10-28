# 下载网络失败修复验证

日期：2026-10-28。当前G2，用户明确要求修复，允许大量参考甚至照用本地X-CL/XMCL及KAMUCL。无新增依赖、IPC或持久格式。修复分两步：0356817完成重试/证明期限；随后根据真实完整安装暴露的Undici致命断言，补入桌面系统请求流适配。

## 根因与改动

- 资源传输只有Range异常回退，没有瞬时网络失败重试，单文件失败即导致InstallDownloadService中止整批任务。SourceTransfer增加最多三轮可取消退避，保留最新持久前缀，提交前仍执行原摘要验证。
- 同镜像再次进入route原来也清零前缀；现在只在切换来源时清零，源内续传保留ETag/If-Range。
- 404等永久响应原归NETWORK_FAILED，现归BAD_RESPONSE，避免新增瞬时重试循环。408/429/500/502/503/504按临时响应及Retry-After处理，超过30秒的服务端等待直接返回，不提前请求。
- 目录读取原为单次12秒请求；现在对临时网络故障/408/5xx最多三次，非法来源/大小/摘要/编码不重试，429不内部提前重试，失败响应清理body。
- Quilt现场显示最后一轮sidecar成功后HEAD超时：两步原共用12秒与整个证明的三次预算。现sidecar和HEAD独立12秒及三次预算，HEAD失败不重做成功sidecar，每次请求结束后再退避。
- 文件设置在首次请求时冻结，重试期间取消会停止下一次请求；持久化错误仍优先返回NEEDS_RECOVERY，不被同时取消掩盖。

## 参考取舍与许可

阅读本地KAMUCL（30874ab871c8ee00c1edab275bb3aeb25704330b）的src/main/core/download.ts、downloadFetch.ts、httpClient.ts、systemDownload.ts；XMCL（b64e90f69bda9c4c049af27c63c488489784c72c）的xmcl-runtime/network/pluginNetworkInterface.ts、NetworkAgent.ts和user/utils/withRetry.ts。两者主许可证MIT，KAMUCL明确仅原创贡献适用，第三方保留其独立许可。

借鉴有界指数退避、释放失败响应、按请求独立预算及断点保持；桌面请求适配器参考KAMUCL systemDownload按OUCL边界重新实现。没有引入@xmcl或undici依赖、未整体搬入参考库模块。没有移植XMCL中的rejectUnauthorized:false，也没有导入参考库凭据或不受控跳转策略。HTTPS、来源白名单、固定镜像路由与官方摘要信任保持。

Node与Electron系统网络对比probe.log：系统代理解析为DIRECT；Node在Fabric端点出现连接超时，Electron对应尝试也失败，Quilt目录两者均200。此证据不足以认定系统代理是根因，因此最初不把代理认定为根因。随后quilt-install-fixed.log在约269MB出现Electron45内置Node24.22 Undici Parser.finish的assert(!this.paused)，属于无法被Promise重试捕获的进程致命断言。最终桌面生产装配改用Electron net.request原生流，避开该Undici数据路径；不关闭TLS验证。

桌面适配器：主进程显式将net.request适配器注入目录、Maven、资源、Mod平台、Java及文件下载服务。只允许HTTPS GET/HEAD/显式字符串POST（当前调用方发送JSON）；手动跳转仅返回一跳，由原镜像策略验证，其他跳转拒绝；useSessionCookies=false、credentials=omit，认证挑战中止、不提供用户凭据；流结束/取消清理原生请求。单测仍能注入无Electron传输。窗口测试显式替换原生请求边界，避免意外真实联网。

## 已运行验证

- 最终check-native-final.log：pnpm check，528项526 PASS、0 FAIL、2既有SKIP；typecheck/lint/build通过。随后仅测试运行器加强禁网探针，typecheck-native-final.log/lint-native-final.log通过。check-release.log为此前重试版本524项522PASS。
- 新增network-retry与Maven测试：断连后成功、502重试、三次耗尽、Range/If-Range恢复、404和长Retry-After、ack丢失/同时取消、退避取消、非法摘要不重试、缓存请求合并、同镜像前缀保持、HEAD独立重试及取消。旧缓存测试更新每轮请求计数但继续要求单个共享刷新/冷却。
- official-proof-fixed/probe.json：真实Fabric0.16.14档案与8库全部证明PASS；Quilt0.29.2档案与11库全部证明PASS。原official-proof中Quilt sidecar/HEAD失败保持，不覆盖。
- fabric-mod-download.log：正式InstallerService下载FerriteCore6.0.1（125197字节），Modrinth来源、SHA1/SHA512和真实JAR声明复验PASS，写入独立Fabric验证实例。此为显式测试Mod供应器，不冒充产品确认安装UI验收。
- 最终electron-native、interaction-native、loaders-native：当前main/preload、44方法/16能力、安全隔离、两轮窗口交互/重开、四加载器目录选择均PASS，metadata为明确本地fixture，不能冒充公网目录。Chromium cache/GPU告警原样保留，未影响PASS或持久化验收。
- pnpm test:bootstrap：26 PASS。最终portable-native/smoke.json三场景PASS；cold-native/warm-native日志和JSON证明对应最终EXE实际官方下载Electron冷启动（约61秒）、缓存热启动（约1秒）、中文空格路径、无Node和owner释放通过。此前portable/cold为仅重试候选，保持历史。
- quilt-native.log：全新official-loader-LhQmas根，从此前崩溃根只复制对象缓存并重新验证每份对象/来源、重建可重建索引，未接管崩溃owner锁。742454177字节计划全部校验、3652项物化并提交ready，official-install-verified；不是全部字节冷下载。旧quilt-install-fixed.log致命断言现场保留。

## 交付

release/OUCL-0.3.0-network-fix.exe，364544字节（356 KiB），SHA256 04d8ddd7062c03e71e320e60b35f4b60105727568d441bb26930156ebf800e7b。包证据../BOOTSTRAP-0.3.0-network-fix/package.json，appHash edcab6423278a5a28c4dba3f9c81f1cd483428dc0e8a09b3d8ae2cf3939878d6。保留此前所有EXE，不自动push或远程发布。

完整Quilt安装本轮通过；不代表Quilt实际游戏菜单/Mod矩阵已验收。仅重试候选保留为OUCL-0.3.0-network-retry-only.exe，不作为最终修复包。网络永久不可达仍会在有界预算后真实失败，不能承诺无限重试或所有校园网可达；本轮不重做全部游戏/后台/账号矩阵。


最终补证：quilt-native-reopen.log在另一个桌面进程中通过同一实例重新打开、显式阻止所有注入传输后的启动前复验，official-reopen-offline-verified。该结论仅是安装/无网启动准备，不冒充实际游戏菜单。

最终运行时代码提交：f94a69a（此前重试修复0356817）。package-native.log和BOOTSTRAP-0.3.0-network-fix/package.json记录同一最终包。
