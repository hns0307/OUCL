# I fresh-bound 专注测试保存点

2026-11-17，方案 A 已启动小步。仅新增 `tests/distribution-fresh-bound.test.ts` 与证据，复用旧 local-domain helper，未改生产或旧夹具、未提交。

最终冻结源码局部测试：**5 PASS / 0 FAIL / 0 SKIP，3492.5425 ms，exit0**。主协调随后实测 primary 仅余8%，要求只收齐已启动检查并保存：本测试文件的静态检查尚未启动，**类型检查/lint待恢复**；没有新开全量检查，不宣称 I 已全面完成。

## 实证范围

真实临时签名 release/DistributionStore/JAR worker/LocalModDomain 与 Windows native factory，全部位于 `D:/MC_start/OUCL/tmp/fresh-bound-20261117-i/domain/<pid>/`。平台和许可仍是明确合成端口，fetcher 无网络。没有玩家目录或公共执行 backend。

1. 正确 proof 的首次真实原生提交成功，journal.gameIdentity 等于原 proof，目标 JAR 字节正确。包装真实 factory 明确观察首次 expectedRoot 参数为原 proof；再次 fresh-bound 返回 NEEDS_RECOVERY，不再调用 factory，receipt revision仍1。
2. 原 gameDir 改名并在相同路径创建新空目录，inode确实不同；调用保守返回 NEEDS_RECOVERY，无 journal、receipt、session lease 或 JAR，原目录也保持空 mods。
3. 缺 protected factory 返回 NEEDS_RECOVERY；ino0、负dev、额外proof字段返回 INVALID_TRANSACTION；均未调用 authorize/artifact，无持久或目标文件效果。
4. 真实旧 committed journal 和 staged checkpoint 模拟中断的真实 partial journal，都返回 NEEDS_RECOVERY；factory/authorize/artifact计数0，journal不变。中断格保留本人合成目录里的 lease，不以同metadata owner伪造恢复或清理。
5. 在 awaited 真实 domain context 期间修改调用方 proof；最终真实提交仍绑定原捕获 proof，JAR字节正确。

首轮实际4PASS/1FAIL：根替换返回 NEEDS_RECOVERY，测试原误期待 FILES_CHANGED。主协调与实现代理确认需求只要求保守拒绝，底层现有错误可映射 NEEDS_RECOVERY；未改生产映射，仅修正期待。原始 `tests-initial-code-expectation.log` 与对应 status 完整保留，最终日志为 `tests.log`，不是隐藏安全穿透或降低“不发布”断言。

## 复现与摘要

已有 esbuild 非bundle编译 src/新测试/旧fixture，保留 worker 入口，随后：

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/fresh-bound-20261117-i'
$env:OUCL_SOURCE_ROOT='<本checkout绝对路径>'
node --test D:/MC_start/OUCL/tmp/fresh-bound-20261117-i/build/tests/distribution-fresh-bound.test.js
```

- transaction.ts SHA256：`ee2aaf187bb47a47f724752ed91f84917a3cee6716680a7579d4447048f611f9`
- 新 test SHA256：`048d605ffdf8c8e9722aae53a272d37bd6c7dd02ce48d3173ea030882f5d9744`
- `test-status.json` 绑定实际退出码、测试根与两个摘要。

源码及测试已冻结，后继恢复先运行新测试静态检查，再由主协调统一全检。该入口不构成独立执行授权；上层仍须自己的成功 fresh claim、durable admission、原始快照与当前发行/领域许可。source/key保持空配置。
