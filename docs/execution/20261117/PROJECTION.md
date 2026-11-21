# 本地Mod最终库存纯投影

2026-11-17。用户持续执行授权下的最小内部子增量；未实现完整domain adapter、许可、网络或公共执行。新增仅 `src/services/distribution/local-mod-projection.ts`、对应测试及本证据；未修改前片signal四文件、public/schema/依赖，不提交。

内部API为 `projectDistributionMods({plan,baseline,scans:[{operationIndex,scan}]}) → {items,fingerprint}`。严格解析DistributionPlan后，只接受mods顶层`.jar`操作；拒绝nested目标、其他区域和不安全文件名。输入完整baseline必须具有已知完整hash、合法大小/档案声明、按实例/文件名绑定的fileId，不允许casefold重复。新scan使用现有严格worker事实parser，绑定唯一操作index，核对该op的size/SHA256，拒绝缺失、多余、重复或错配事实。

replace/remove精确匹配旧SHA256后剔除原条目；add拒绝占名；新条目复用plannedModFacts。keep、清单未列和既有disabled条目保持，输出深拷贝并沿modInventoryFingerprint计算完整最终指纹。baseline、scan输入合计及输出事实预算8MiB，文件数上限256。不执行IO或修改任何库存/文件；不将managedId、hash匹配或投影成功作为ownership、许可、平台兼容或执行授权。

## 实际验证

专注测试首次 **9 PASS /0 FAIL /0 SKIP，exit0，117.668ms**，原始 [test.log](projection-evidence/test.log)、[status.json](projection-evidence/status.json)。用例覆盖：

- replacement只替换一次、不重复，完整fingerprint一致及输入/输出无alias；
- remove后保留其余依赖声明，独立checkLocalMods实际检出缺失依赖（投影本身不判兼容）；
- keep、disabled和未列库存保持；casefold占名/重复baseline/未知hash及错误实例fileId拒绝；
- 旧hash错误、缺/重/多余/跨index scan、错误size/hash/worker事实结构拒绝；
- unsafe/nested目标、resourcepacks/config拒绝，256和8MiB上界检查。

测试输入是**纯合成scan/声明事实，不是真实JAR扫描**；无网络、Java、GUI或native操作。esbuild在独占 `D:/MC_start/OUCL/tmp/distribution-projection-20261117` bundle后运行Node测试，stdout/stderr直接连文件描述符保存。不能用本轮结果代替未来真实worker/domain许可/阶段适配验证。

首次全仓typecheck出现测试add helper返回联合类型过宽的两项诊断；[typecheck.log](projection-evidence/typecheck.log)、[checks-initial.json](projection-evidence/checks-initial.json)保留。仅将测试helper返回类型收窄为 `Extract<DistributionOperation,{kind:'add'}>`，无运行逻辑或断言变化。最终全仓typecheck **exit0**，两新增文件局部ESLint **exit0**；[最终检查/源码SHA](projection-evidence/checks.json)、[最终类型日志](projection-evidence/typecheck-final.log)、[lint日志](projection-evidence/lint.log)。类型收窄后未扩大专注case，主协调负责最新源码的完整回归。

源码已冻结。下一完整本地adapter仍须依据真实journal区分前置/已发布阶段、重新验证最终实际库存及runtime/platform/许可；本片不猜阶段、不读receipt、不收编内容，也不负责这些授权门禁。

主协调最终完整853项849PASS/0FAIL/4既有SKIP，typecheck/全lint/build均exit0；原始日志与状态见projection-final-evidence。独立只读审查认可纯投影边界，无执行授权含义。
