# N1—N6 只读首片独立候选打包

日期：2026-11-16（Asia/Shanghai）。执行统筹分派本任务；先核对 TASK_PLAN、DECISIONS、AGENTS 与 `docs/execution/20261115/CONTINUATION.md`。20261116 同名 CONTINUATION 在首次检查时尚不存在，因此读取实际前继。未安装依赖、未改主进程/契约/UI，也未触碰原 mod_loaders WIP。

## 候选与覆盖范围

- 文件：`release/OUCL-0.3.0-execution-20261116.exe`，**433664 字节**。
- SHA-256：`7ee7bfc5166659361dc39b575c6e82324156a5caa22c8a9b7d817b7d93b2265e`。
- appHash：`ec55fb620f8e5cf96b59ebb6660bcc734720155a5e9ea83d7ad74e7fbb992710`。
- Electron45.0.0 的既有官方 ZIP 摘要：`ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47`。

生产源码冻结为 **49086688327fe260443e3fc21f5f9479ccc7744b**，覆盖 N1—N4 UI、N5 隔离设施及 N6 签名/所有权只读首片；真实在线站点、分发来源、公钥保持空。**不包含 2026-11-16 并行开发的包执行/更新/删除功能**。冻结普通目录不带 Git 工作树，不将共享树未提交改动复制进来。

使用 `git archive` 精确导出该提交的 src/scripts/bootstrap/package/lock/Vite/TypeScript 配置，逐文件重算 Git blob 身份；只有 `scripts/bootstrap-package.mjs` 使用本轮最小增强，另放入只读审计脚本（不进入产品载荷）。完整 SHA-256、原 blob、覆盖标记见 [source-manifest.json](package-evidence/source-manifest.json)。原始 ZIP 位于独占临时根，其摘要已进入该清单。

## 脚本增强

`scripts/bootstrap-package.mjs` 新增读取 `OUCL_BUILD_ROOT`，未设置时仍读取原 `dist`；保留版本、标签校验和 `RELEASE_ALREADY_EXISTS`。许可证、Electron运行时及官方 checksums 从 Node 实际解析到的已安装包根读取，支持父目录/pnpm存储；scheduler 从 react-dom 的解析域定位。`smol-toml` 隐藏 package.json export，因此从实际入口向上核对包名，而非假设路径可直接 resolve。没有新增第三方依赖或改变运行时下载信任逻辑。

新增 `scripts/extensions-package-check.mjs`，只读 .NET 托管资源，不调用 EXE Main、不启动载荷。要求明确 `OUCL_EXE_TEST_PATH`、`OUCL_BUILD_ROOT`、`OUCL_VALIDATION_DIR`；检查精确九文件、无重复名称、内嵌manifest/appHash、自身包元数据/许可证项，以及七个产品文件对独占构建的长度和 SHA-256。

## 实际验证

| 检查 | 结果 | 原始证据 |
| --- | --- | --- |
| 冻结源码的独占生产构建 | exit0；七产品文件 | [build.log](package-evidence/build.log) |
| 引导器检查 | **34 PASS**，exit0 | [bootstrap.log](package-evidence/bootstrap.log) |
| 增强打包脚本 | exit0 | [package.log](package-evidence/package.log)、[package.json](package-evidence/package.json) |
| EXE内嵌九文件审计 | **9/9 manifest匹配；7/7产品与独占构建逐字节匹配**，exit0 | [package-audit.json](package-evidence/package-audit.json)、[embedded-resources.json](package-evidence/embedded-resources.json) |
| 同名候选重复生成保护 | 预期exit1，明确 `RELEASE_ALREADY_EXISTS`，既有候选摘要未变 | [duplicate-protection.log](package-evidence/duplicate-protection.log) |
| 两个脚本ESLint | exit0 | [lint-status.json](package-evidence/lint-status.json) |
| 正式EXE和原dist保护 | 前后摘要完全相同 | [protected-before.json](package-evidence/protected-before.json)、[protected-after.json](package-evidence/protected-after.json) |

正式 `OUCL-0.3.0.exe` 保持 **410112字节**、SHA-256 `6d4f7f25d29a06b4d3730fd79ad64a160dbcdb28f747e20eda1ce05f98cc690e`。候选先在冻结目录生成并审计，再以独占创建方式复制到主维护树 release；复制后再次核对 SHA-256。

本次 Node v24.21.0；已装 React/React DOM19.3.1、Zustand5.0.16、smol-toml1.9.0、Electron45.0.0、esbuild0.28.2、Vite8.3.5、scheduler0.28.0，实际解析位置见 [dependencies.json](package-evidence/dependencies.json)。未通过 pnpm 入口触发安装。

## 可复现入口

独占根：`D:/MC_start/OUCL/tmp/package-execution-20261116`。冻结源码在其 `source` 子目录，构建输出明确为其 `dist` 子目录。完整命令、工作目录、退出码和耗时见 [status.json](package-evidence/status.json)，完整临时协调脚本为同根 `run.mjs`。

从冻结源码目录：

```powershell
$env:OUCL_BUILD_ROOT = 'D:/MC_start/OUCL/tmp/package-execution-20261116/dist'
$env:OUCL_BUILD_TAG = 'execution-20261116'
node scripts/build.mjs
node scripts/bootstrap-test.mjs
node scripts/bootstrap-package.mjs
$env:OUCL_EXE_TEST_PATH = Join-Path $PWD 'release/OUCL-0.3.0-execution-20261116.exe'
$env:OUCL_VALIDATION_DIR = 'D:/MC_start/OUCL/本地资料/OUCL-download-main/docs/execution/20261116/package-evidence'
node scripts/extensions-package-check.mjs
```

同名EXE已经存在，重跑打包命令应按设计拒绝；不要删旧候选来制造可重跑。另一次构建应使用新审核标签/独占目录。构建日志显示源目录外输出的Vite提示，输出为明确指定独占路径，不是写入原dist。

打包阶段没有执行候选EXE；其后按协调者分派做了下述有限运行。未运行游戏或重跑全库单测；九文件完整性不替代这些层级。使用不同源码/依赖物理位置可能改变bundle注释，不宣称跨目录逐字节可复现。未签名、未push/发布、未git add/commit，正式EXE保持原样。

## 外层候选有限运行：未通过初始化验收

新增 `scripts/extensions-candidate-smoke.mjs`，两份独占根分别负责打包与运行。运行根为 `D:/MC_start/OUCL/tmp/candidate-execution-20261116`，后继尝试分别使用其run-2至run-5普通目录；每次拒绝已有目录，不复用原runtime/profile/game。将候选按原字节复制到测试根，按EXE内嵌runtime-manifest把已安装Electron45的**73个普通文件**复制并逐项校验为同级缓存；没有联网准备运行时，也没有改变引导器安全流程。

引导器支持明确 `--user-data-dir`，并把合法Electron参数转发。本片使用仅绑定127.0.0.1的 `--inspect-brk` 在默认应用ESM入口暂停，安装仅内存的可见性/合成catalog网络边界hook，再执行真实包内main；未替换包内文件、CSP或Node/沙箱参数。OS进程观察者只等待已从该测试inspector确认的PID，不强杀任何产品进程。

最终run-5结果为 **FAIL / 原因未定位**，不因正常exit0写成产品运行通过：

- 5项实际检查通过：候选引导器提取目录为 `app.getAppPath`，明确独占profile，sandbox/contextIsolation/Node/webSecurity保持，renderer来自包内路径，调试协议实际解析的preload脚本来自候选提取路径。
- 正式preload返回真实握手，但 `capabilities=[]`。`onlineToolState`返回空工具表/closed，未知工具和任意URL拒绝，关闭回执有效；`distributionSources`及预览均为 `UNAVAILABLE`，不能据此声称N6空来源服务已经初始化。
- 独占metadata只存在 `owner.guard.sqlite`、`owner.lock`，没有tasks库，保留现场未清除。说明存储初始化链未建立；当前没有底层错误证据，不把原因归为产品、权限或inspect继承中的任何一个。
- 外层EXE的exit0断言已先于最终失败断言完成；Electron由独立OS进程句柄观察取得数值 **PROCESS_EXIT=0**，应用quit和Node exit也为0。退出码只说明本次程序正常退出，不代表初始化成功或owner标记清理完成。
- 退出后只读核对 **9/9提取文件SHA-256** 与候选包一致，**73/73运行时文件SHA-256**不变；只有一个预置运行时命名空间，没有download staging。正式EXE摘要仍保持原值。

最终原始记录：[application-result.json](package-evidence/candidate-smoke/application-result.json)、[process-exit.log](package-evidence/candidate-smoke/process-exit.log)、[launcher.log](package-evidence/candidate-smoke/launcher.log)、[post-exit-integrity.json](package-evidence/candidate-smoke/post-exit-integrity.json)。该轮夹具本身退出1；未继续进行宽窄布局截图或后续UI检查。

首轮target命名比较不兼容Electron默认入口（目录分隔符转成下划线），错误恢复曾恢复main执行后再正常关闭，因此**不对首轮作隐藏/无公网承诺**。run-2误把Electron45已省略的preload偏好属性当路径；run-3取得实际脚本但误用file URL表示比较；这两轮是夹具错误。run-4/5均在实际main服务初始化/握手处未通过。曾怀疑测试inspect标志影响worker，但run-5记录的 `process.execArgv`原本为空，移除尝试没有证明或排除该原因。前轮记录保存在 `candidate-smoke-attempt-1` 至 `candidate-smoke-attempt-4`，没有删除或重写为成功。

协调者要求当前尝试后停止重复运行，已遵守；没有再启动产品或做无界诊断。该候选可保留为包完整性通过、运行初始化待定位的独立版本，不能替换正式EXE或冒称全部N1—N6运行验收通过。
