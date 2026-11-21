# v12 本地整合实录

实际 main 检出：`D:/MC_start/OUCL-download-main`。先确认 branch=main、HEAD=`23b265fc2bd281735e3c736f0c40d50d0da33b98`、工作树干净，再执行 `git -c gc.auto=0 merge --ff-only ecb40f9`，成功快进到 `ecb40f9a186214d0b7a8ea0bf5295e7d5f3f28cb`。其中产品代码候选为 fab0ac8，ecb40f9 为独立共存证据提交。未执行 push，活跃 mod_loaders 未切换或整体暂存/提交。

`node acceptance-results/verify-main.mjs` 实际 PASS：462 份冻结且被选入 main 的文件相同（Git 行尾按 LF 归一比较），10 份 v12 归档原始文件 SHA256 全部一致，main 工作树干净。597 冻结项中排除2份有后继追加的批准文档和133份历史 P-A/tools 工件；这些工具一直未纳入候选。首次审计脚本因试读这些明确排除工件而 ENOENT，随后按 tracked 集合及严格 tools 前缀显式分类，未修改产品或放宽源码匹配。排除清单完整保留在结果中。

已将验证过的最终 EXE 精确复制到 `D:/MC_start/OUCL-download-main/release/OUCL-0.3.0-acceptance-20261113-v11.exe`，SHA256 `3d9a0ebaf289a9552933c97033ffbd6a069e0a0258e3ea8322cc2a5ceb6efce6`。复制采用独占新文件；若目标已存在则只校验，不覆盖。旧 v3 EXE 保留。二进制不入 Git。

检查结果、脚本及前置十代码暂存检查见本版本 evidence/integration。当前文档是在上述合并后追加，将随下一次精确文档提交同步，不虚称已包含在 ecb40f9 内。C异常时序另行成版，不倒写本阶段历史状态。
