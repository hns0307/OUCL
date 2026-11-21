# C-R6 有限后端补证

本次仅在独立验收树的 `acceptance-results/c-platform-v15` 新增材料；不修改产品 src/tests/dist、共享活跃树或 E 证据。沿用 P-C 已批准的只读影响预览范围，无新依赖、IPC、持久格式或文件启停能力。

最终独立测试 **3 PASS / 0 FAIL / 0 SKIP**。使用正式 ModArchiveReader 及原 worker entry、真实磁盘 JAR、ModInventoryService、ModInspectionService、ModrinthModClient、ModMaintenancePreviewService 和 presentation。每个预览执行两次真实 inventory scan，每个文件每次扫描由真实 worker 读取。平台 HTTP Response 为明确标记的合成输入，不访问公网，不手造 inspection、platform version 或 preview 成功结果。

- JSON-only 父 JAR 同时包含 Fabric/Quilt 声明及嵌套 Fabric JAR；实际 Fabric 提供 parent_mod、parent_alias、nested_mod。预览禁用同一物理父 JAR 后三者一起消失，依赖 JAR 被识别为直接受影响，结果 blocked。实际文件保持原样。
- 平台文件大小、SHA1、SHA512 使用实际生成的 JAR 字节；完整 metadata 经真实客户端解析。平台项目 ProvPr01 / 版本 ProvVr01 与本地 Mod ID 分域显示。另一个合法响应要求 ProvVr02，尽管本地依赖满足且摘要一致，仍产生 PLATFORM_PIN_MISMATCH，不生成平台满足关系。
- 合成 HTTP 429 经真实客户端映射为 RETRY_LATER；禁用最后一个 JAR 后本地约束满足，预览仍 unknown。

展示模型只暴露 nested depth，不含绝对目录、嵌套 entry 路径或 URL；测试同时核对目录名称和全部 JAR 字节未改变。`display-artifact.json` 是供后续复用的后端展示产物，不能冒充窗口、IPC 或游戏运行验收。

首轮为 1 PASS / 2 FAIL：合成平台 ID 不符合现有严格 8 位字母数字契约，真实客户端返回 UNTRUSTED_METADATA。保留 `chain-attempt-1.mjs`、`test-run-1.log` 和未带 attempt2 前缀的原始场景证据。第二轮仅修正合成 ID 为合法 8 位形式，并使用新场景目录，未降低断言。最终记录见 `test-run-2.log`。

复现（独立验收树根）：

```powershell
node acceptance-results/c-platform-v15/build.mjs
node --test acceptance-results/c-platform-v15/chain.test.mjs
node acceptance-results/c-platform-v15/verify.mjs
```

`source-shas.json` 与 `build-meta.json` 固定 78 个构建输入；验证器在运行后逐一复核。`verification.json` 记录复核结果。未执行完整 pnpm check；本次没有产品代码变更，局部证据不替代此前完整回归。公共窗口 C-R6 展示、真实公网元数据及全产品验收仍未由本报告证明。
