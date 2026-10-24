# 文档治理核查记录

日期：2026-10-24（Asia/Shanghai）。任务：P0-01文档治理增量。执行人：Codex；用户验收：待确认。

## 范围与结果

基于现有项目资料整理文档入口和开发规范，没有改变候选技术方案或G0/G1/G2状态。当前仍为G0；六类架构基线及业务启动未批准。本次没有创建业务源码、spike、依赖、构建或测试基础设施。

| 文件 | 实际变更 |
| --- | --- |
| 根README.md | 新增项目状态与文档导航 |
| 根AGENTS.md | 新增每次开发首读TASK_PLAN、核对授权、仅执行获批阶段规则；澄清资料包路径 |
| OUCL-Codex/README.md | 修正根级AGENTS链接及覆盖范围描述，补开发规范入口 |
| docs/DEVELOPMENT.md | 新增阅读顺序、文档职责、门禁、规范摘要与交付流程 |
| docs/TASK_PLAN.md | 新增当前有效授权范围与本次交付记录 |
| docs/DECISIONS.md | 追加用户本次要求与授权边界，保留历史及PENDING决策 |
| docs/DESIGN_REVIEW.md | 补任务计划与开发规范职责 |
| docs/PROPOSAL_PHASE0.md | 修正根级AGENTS相对链接 |
| prompts/FIRST_TASK.md | 标注历史模板及后续首读入口，保留原始任务正文 |
| docs/DOCUMENTATION_REVIEW.md | 本核查记录 |

表中 `docs/`、`prompts/` 均相对 `OUCL-Codex/`。原始需求、原始提示词、存储方案、XMCL方案、OUCL.txt及压缩包本次未修改。

## 验证方法与证据

在仓库根用PowerShell执行只读核查：

1. `git status --short`、`git remote -v`、`git log -1 --oneline`：确认原有资料均未跟踪，本地master无提交，origin对应用户GitHub仓库。GitHub连接器只读查询仓库元数据，未创建远端提交、分支或PR。
2. 读取根AGENTS、TASK_PLAN、DECISIONS、REQUIREMENTS、提案及关联文档，对照用户本次授权；待决D-01–20保持PENDING，G2保持NOT_STARTED。文档交付不等于用户验收通过。
3. 枚举根AGENTS/README及资料包所有Markdown，提取Markdown链接，排除URL与页内锚点；按文档所在目录解析相对路径并用 `Test-Path -LiteralPath` 验证目标。仓库内缺失目标必须为零；仓库外的参考资料单列，不作为可移植依赖。
4. 检查Markdown代码围栏成对及行尾空白；检查持久首读规则与任务表授权入口存在。
5. `rg --files -g package.json -g pnpm-lock.yaml -g '*test*' -g '*spec*' -g '*config*' -g '.github/**'`：没有命中应用清单、配置、测试或CI文件。类型检查、lint、单测、构建、依赖审计均不适用，未运行，不标通过。

最终静态核查：Markdown文件13份，仓库内相对文件链接全部可解析，外部参考文件5处在本机存在；代码围栏成对且无行尾空白。检查不验证外部网页可用性、标题锚点或技术方案运行正确性。

`git diff --check` 已执行，但当前文件全部未跟踪，不能以空输出证明这些文件通过检查；另做全文静态核查。仓库暂无提交，无法提供提交级差异，本表明确列出本次实际编辑范围；没有自动暂存原有资料。

## 下一步边界

本次文档交付后停止。下一最小工作是用户审阅P0-02范围决策，或明确启动P0-03的指定验证方案；不得据此自动执行spike、骨架或1A业务功能。
