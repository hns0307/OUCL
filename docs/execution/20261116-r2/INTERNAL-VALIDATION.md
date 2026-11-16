# 生命周期与根目录身份增量

用户持续执行授权下，从ceed2dc1的内部服务继续；未接产品分发执行，也不引入真实来源/公钥。

已实现active/seen tombstone预算、失败/过期身份不重跑、完成确认只读journal、close取消并drain；目标快照与journal v2都绑定gameDir dev/ino。同路径空目录替换不能被当作原实例恢复，即使其内容和遗留token看起来相同。旧v1 journal明确拒绝，不做隐式迁移。

实际验证：协调者以esbuild编译当前distribution-execution、distribution-transaction、distribution-store三文件，在独占D:/MC_start/OUCL/tmp/r2-internal-final使用原断言运行，**45PASS/0FAIL/0SKIP，exit0，2.581秒**。包括21项编排、19项事务、5项仓库。见[完整日志](internal-evidence/test.log)、[退出码](internal-evidence/status.json)。类型检查与本增量局部lint另在提交前验证。

这45项使用既有cooperative真实文件adapter以及注入的权威/domain端口，不能当成native原子隔离验证。Windows helper的ShareRead-only normal link/rename回归失败仍由NATIVE-HELPER/NATIVE-REVIEW保留；该另一个增量尚未接纳。产品main/preload/UI未新增执行入口。原mod_loaders WIP、正式EXE保持，未push发布。
