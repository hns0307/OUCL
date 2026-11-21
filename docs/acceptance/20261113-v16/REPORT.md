# 增量报告 v16：C多声明JAR与正式平台解析后端链

C-R6后端链新增3 PASS / 0 FAIL / 0 SKIP，78个实际构建源输入哈希保持。只新增独立验收材料，未修改冻结产品。

实际使用正式ModArchiveReader/真实worker、磁盘JSON-only合成JAR、ModInventoryService双扫描、ModInspectionService、正式ModrinthModClient、ModMaintenancePreviewService及公共presentation。平台HTTP Response为合法的受控合成输入，实际文件SHA1/SHA512/大小与JAR匹配；不联网、不手造检查或预览成功结果。

| 用例 | 结果 |
| --- | --- |
| 多声明/嵌套物理JAR | 父Fabric/Quilt声明与嵌套Fabric，实际提供parent_mod/parent_alias/nested_mod；预览禁用该物理JAR时一起移除，依赖JAR受影响且blocked，文件字节不变 |
| 精确平台版本 | 平台project/version与本地modId分域；另一合法响应要求不同版本时产生PLATFORM_PIN_MISMATCH，不因本地依赖满足而误判平台满足 |
| 平台拒绝 | 合成429经正式客户端变为RETRY_LATER；禁用最后JAR后本地约束满足，结果仍unknown |

嵌套只露depth，展示模型无绝对目录、嵌套entry路径或URL。具体断言和完整日志见evidence。首轮1 PASS/2 FAIL源于合成平台ID不符合已有严格8位格式，保留原脚本/失败日志/场景；第二轮只修正夹具ID并使用新场景，未降低断言或修改产品。

实际命令（v11独立副本根）：`node acceptance-results/c-platform-v15/build.mjs`、`node --test acceptance-results/c-platform-v15/chain.test.mjs`、`node acceptance-results/c-platform-v15/verify.mjs`。最终verification记录3通过与78来源不变；不重跑已通过无变化全量。

display-artifact.json可供后续窗口复用，但当前仅后端展示模型，**C-R6实际窗口公开展示仍未验证**；本报告不将受控响应当真实公网来源，不以Forge/加载器信息当游戏成功。C其余有限时序、A实际强制中断恢复继续开放。E见v14、C接纳重试见v15，完整方案仍IN_PROGRESS。不push/发布，不触碰活跃共享树源码。
