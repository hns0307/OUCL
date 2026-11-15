# OUCL 对比方案执行记录（2026-11-15）

执行基线：main 05309ed7，工作树为本报告所属仓库。用户明确要求读取并执行交接文档、允许子对话分工；采用六个子代理进行独占文件实施、诊断、设计与独立审查。这里的子代理不是新建侧栏独立聊天。

当前 G2。在既有接口/持久格式/安全边界内完成 N1—N4 源码集成；N5/N6 只有待批方案。原 mod_loaders 未提交 WIP 未覆盖；main 既有技术方案、RECHECK、PROJECT_LAYOUT 和计划文档修改保留。未新增依赖、业务 IPC、存储格式、认证、后台或真实远程分发。

## 实际变更

| 增量 | 文件与行为 | 验证边界 |
| --- | --- | --- |
| N1 | src/ui/InstanceOverview.tsx、instance-overview.ts：真实实例状态、身份、继承隔离、会话、已确证关联的Mod任务；单页20条/不完整标记；连接与执行分开。InstanceFolders.tsx按根/实例挂载，迟到回执不污染新选中实例。LaunchControls.tsx按root隔离观察并保留读取失败前的会话。InstallPanel.tsx、task-controls.ts只在已确认且提交前显示取消。 | 8项新概览测试；原任务/选择/观察回归44项；2项取消边界；独立审查覆盖迟到与观察失败。不把全局任务误认归属，不提供未验证Java版本。 |
| N2 | FirstRunGuide.tsx、first-run.ts：保留既有选择，导航现有设置/账户入口，可跳过/重开/重试；settings未读时不猜新用户。App重试开始清一次旧错误，同时保留本次并发读取失败。 | 5项规则测试；受控组件检查；无自动根选择写入、认证或全盘扫描。现有RootSettings选择首个可用根的行为没有重构。 |
| N3 | AppearanceSettings.tsx：加载/保存/原生picker期间禁用编辑，默认仅预览，取消清反馈，图标错误受控；本面板焦点Escape取消，保留子控件Escape。interaction.css补窄窗、断行、输入焦点样式。 | 受控hooks/JSX组件脚本18断言通过；不是原生picker/真实GUI验收。 |
| N4 | shared/tools/gradient.ts、Toolbox.tsx、App/launcher-state导航：固定渐变文字工具，Unicode字素、输入上限、颜色插值、安全JSON输出，可选中输出复制。 | 4项新规则测试；无任意脚本、网络、文件导出、剪贴板权限或持久化。输出为支持JSON文本组件的MC Java命令/配置格式，不是普通聊天粘贴格式。 |

共享接线与文案在 src/ui/App.tsx、src/ui/launcher-state.ts、src/shared/locales/messages.ts；具体子任务说明：[N1](N1-NOTES.md)、[N2/N3](N2-N3-NOTES.md)、[N4](N4-NOTES.md)。

N1先完成接线，52项相关测试、类型/lint/build通过，再接 N2/N3；7项引导/取消测试及类型检查通过后接 N4。后续全回归包含新增19项规则/控制器测试。首轮N1接线检查残留四个已删除UI状态变量，类型/lint失败；删去死变量后复跑通过，没有改断言或跳过。

## 实际验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript 6.0.3 --noEmit | exit0 | evidence/typecheck.log、checks.json |
| 全 ESLint | exit0 | evidence/lint.log、checks.json |
| Vite/esbuild七产品文件构建 | exit0，独占tmp输出 | evidence/build.log、checks.json |
| 引导器检查 | 34 PASS，exit0 | evidence/bootstrap.log |
| 完整单测与覆盖率脚本 | 710项：681 PASS / 25 FAIL / 4 SKIP，exit1，94.573秒 | evidence/test.log、test-summary.json |
| 与交接失败集合比较 | 25项名称逐项完全一致；新增19项全部通过 | evidence/test-summary.json 的 sameBaselineFailures=true |
| N2/N3受控组件检查 | 18断言PASS | scripts/ui-preparation-check.mjs、evidence/preparation-components.log |
| 隐藏 Electron UI 夹具 | NOT_RUN；两次均在 app-ready/结果前退出，未执行 DOM 断言或截图 | evidence/ui-check.json；不是 GUI 通过 |
| 独立审查 | 两项P2修正并复核；最终未发现剩余阻断问题 | [REVIEW.md](REVIEW.md)，19项专注测试与5项App/目录受控断言 |

完整回归未通过，不能将源码集成称为全绿重新验收。基线诊断在不改生产/断言的24项复现中确认：2项回环连接EACCES、8项链接准备EPERM、14项Mod发布硬链接EPERM；剩余1项进程终止恢复未在该诊断中重跑/未确定根因。[BASELINE.md](BASELINE.md)保留原生错误和方法。统一完整回归仍按仓库原脚本运行并保留该项失败；这不是重新进行已取消的真实EXE强杀补证。

## 可复现检查

从本仓库根运行，使用已安装固定依赖，不经过触发安装的pnpm入口：

```powershell
$env:OUCL_TEST_ROOT = Join-Path $PWD 'tmp/execution-final-tests'
$env:OUCL_BUILD_ROOT = Join-Path $PWD 'tmp/execution-final/dist'
node ../../node_modules/typescript/bin/tsc --noEmit
node ../../node_modules/eslint/bin/eslint.js src tests scripts vite.config.ts
node scripts/test.mjs
node scripts/build.mjs
node scripts/bootstrap-test.mjs
node scripts/ui-preparation-check.mjs
```

上述 ../../node_modules 是本工作树实际已有父目录依赖的相对位置；其他工作区须使用其真实已安装同版本依赖。独占输出不覆盖交付dist或别的子任务.test-build。空类型/lint日志表示无stdout/stderr，退出码另存checks.json。

## 未交付与下一增量

N5/N6见 [N5-N6-PROPOSAL.md](N5-N6-PROPOSAL.md)：N5需要独立WebContentsView/session、站点来源和精确公共契约；N6需要可信源/公钥、只读IPC、收据与后续事务/恢复审批。现有Mod事务仅add-only，签名/diff测试能力不等于产品远程分发。

建议下一最小增量选N5的本地合成隔离验证（先批准容器/权限与spike边界），或维持N1—N4并延期内嵌工具。N6推荐先审查只读签名/所有权预览的精确契约与信任材料，完整安装后批；备选一次设计完整事务但范围更大。当前不把任一默认值记成批准。

正式 OUCL-0.3.0.exe、其九文件/七产品摘要及历史有限验收没有更改；本轮没有游戏/公网补证，没有push或发布。新UI的真实GUI/打包/游戏结果必须独立记录，不能沿用旧EXE结果冒充本轮通过。

后继协调核验、样式修正与本地收存范围见 [RESUME.md](RESUME.md)。本报告前述实施和原始日志在接管时已经存在，不作为接管后新运行的证据。
