# 首次事务原目录绑定I：保存状态

已实现commitFreshBound：strict有界目录proof先校验后复制，强制factory，第一次factory传原proof，initialize后核identity，任何已有journal均拒；legacy主体复用。源码冻结ee2aaf187bb47a47f724752ed91f84917a3cee6716680a7579d4447048f611f9，独立只读审查有限认可。

真实专注5PASS/0FAIL/0SKIP，结果与静态命令以test-evidence及source-evidence原始日志为准。首轮4PASS/1FAIL是测试预期FILES_CHANGED而底层更早保守拒绝NEEDS_RECOVERY；失败日志保留，只修预期且保持无lease/无发布断言，未更改产品映射。

primary实测剩8%进入保存，没有启动I完整回归。最近完整验证为H55fa9a35的965项961PASS/0FAIL/4SKIP，不能套用到I。I是已保存WIP，不标完成；恢复先运行run-checks.mjs，检查真实结果再继续执行服务。

未接公开执行或真实来源，无新依赖/schema/公共契约。真实source/key/站点仍空，生产no-port不广告。没有push、替换正式EXE或清理原WIP/tmp；后续执行顺序和缺项见CHECKPOINT.md。

## 2026-11-18恢复完整检查

primary恢复后主协调实测2%已用，按持续授权运行run-checks.mjs：完整970项966PASS/0FAIL/4既有SKIP，71725.5297ms；最终全部源码/测试tsc、全ESLint、build均exit0。原始命令/退出码/日志见checks-evidence；上文8%暂停/WIP是历史保存事实，本次检查补齐后I完成，不抹去初轮失败。无产品接线/发布/正式EXE改动。
