# I fresh-bound 事务入口

本片只修改 `src/services/distribution/transaction.ts`。新增 `commitFreshBound(plan, expectedRoot, signal?)`；提取 private commitInternal 复用既有执行主体，legacy commit 的可选 factory 与终态重放语义不变。

expectedRoot 先 exact 字段与 bounded primitive dev/ino 验证，再构建私有新 proof（不克隆未知输入），dev 为1..30位十进制、ino为1..30位正十进制；错误 INVALID_TRANSACTION。factory 缺失 NEEDS_RECOVERY。fresh 分支在既有 journal 读取处拒绝全部 existing journal（包括终态），不进入 legacy 终态早返。首次 factory 收到另一个 proof 副本；initialize 后核实际 gameIdentity，失配 FILES_CHANGED。原 active 同步占位、取消检查、receipt commit 不可撤销与 cleanup 不可中断主体保持共用。

这是私有受信入口，不是独立执行授权。未来 executeAdmitted 必须亲自成功取得 durable fresh claim，且独立验证 admission、任务、当前 authority 与原始快照；不能由 renderer proof、旧 running 读回或本入口存在推断权限。调用者仍须注入受保护 native factory，函数只能强制存在，不能以类型静态证明某个 factory 确为原生实现。

整仓固定 Node/TypeScript `tsc --noEmit` exit0，单文件 ESLint exit0；原始日志同目录。源码 SHA256 `ee2aaf187bb47a47f724752ed91f84917a3cee6716680a7579d4447048f611f9`。本代理未运行测试或整仓构建；专项真实测试与独立review由其他独占代理完成，统一检查由主协调收存。未 Git 提交，无产品接线、网络或玩家数据操作。

实际 inode 替换可能在 factory initialize 内先抛出底层错误，由既有事务 catch 保守映射 NEEDS_RECOVERY；仅 initialize 成功返回后的显式 identity 失配分支为 FILES_CHANGED。两者均拒绝，不对失败初始化承诺单一 FILES_CHANGED。
