# 固定整合包 Worker 补验

使用 X 回归已编译的原版固定整合包测试，以及 X 产品构建中的独立 `dist/workers/fixed-pack.cjs`。Worker 为 17444 字节，SHA256 为 `5fdd08cdf414cf1d48876436569e61c461a0b87787600456a787d991619cd2f8`，与 V 候选包清单中的对应文件相同。样本是仓库保留的固定 P-E 样本。

从仓库根运行 `node docs/execution/20261119-coordination/worker-evidence/run.mjs`。脚本创建独占测试目录，设置 `OUCL_SOURCE_ROOT`、`OUCL_FIXED_PACK_WORKER`、`OUCL_FIXED_PACK_TMP`，并用名称过滤只执行先前因 Worker 参数缺失而跳过的两项。输入文件摘要、Node 参数、环境、工作目录和退出码见 `status.json`，原始输出见 `tests.log`。证据文件独占创建，重复执行应另用证据目录。

**通过 2 项，失败 0 项，跳过 0 项，退出码 0。** 覆盖真实 Worker 接受固定样本、拒绝不同归档，以及退出、重复消息、取消与超时控制。这是独立补测。原 X 全量记录仍为 1004 通过、0 失败、4 跳过，其中两项受 Windows 文件操作限制的跳过仍保留。
