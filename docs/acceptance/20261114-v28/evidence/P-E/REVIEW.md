# P-E 专项只读审查

2026-11-14。结论：**固定1355字节样本只读预览在已约定的有限范围内可接纳；本轮未发现有充分证据的实质性缺陷。** 不将此结论扩大为通用mrpack导入、安装或全部窗口/操作系统竞态通过。

## 基线与授权

- 审查目标 `D:/MC_start/OUCL-download-main`；HEAD `26483918cef993266d541e9aacc8249c4ad4c2d4`，产品基线 `fab0ac8`；只读 `git diff fab0ac8 HEAD -- src` 无变化，检查时工作树干净。后续文档提交不改变产品源码身份。
- 已读活跃工作区 `OUCL-Codex/docs/TASK_PLAN.md`、`DECISIONS.md`，稳定候选 `AGENTS.md`、`docs/ACCEPTANCE_HANDOFF_20261111.md`、`docs/acceptance/20261114-v26/{REPORT.md,CURRENT-CHECKLIST.md,HANDOFF.md}`；本包 `E2-IMPLEMENTATION-20261111.md`、`E2-REOPEN-20261111.md` 和稳定候选 `DECISIONS.md` 2026-11-12授权核对。用户对固定样本只读入口的明确答复为“批准”；不是通用导入/安装授权。
- 已读v7最终EXE报告、`comparison.json`、两次退出记录、缺worker原始日志；v13六项原始测试日志及selected/rejected/abort/deadline/result-before-exit轨迹；v14 `native-events.jsonl`、`native-verification.json`、现场快照和报告，并查看v7样本/不匹配及v14预览截图。
- 源码只读校验：`git diff bc01f07487ca7e8d76f17115ea148efcafd748c2 fab0ac8` 对E的core、services、IPC、契约、UI及main无差异；v13 `source-inputs.json`中的E专属模块摘要与当前工作区对应文件核对一致。`fixed-reader.ts` SHA256 `8c5cb8700b7641bc4a0388d829b87beb68b8752768273585a9c98f474c60ccad`，`fixed-worker.ts` SHA256 `a8558e318d7988f1499f9af42e04dd381bec4c0145ca8a57444e55759e05112f`。共享 `handshake.ts` 的当前文件SHA256为 `a32f904a3d550b35697caf1fa32cd965e33d0669aaf3036d44d2b0b52b1fcd69`，不同于v13 source-inputs记录的 `70eebea6efea0c7ac714acd2cc63bf4ea1b6e91c795a17dc3c74b0b1e22a79a7`；本次只对照v13 bundle中的 `UUID_PATTERN` 和 `exactObject` 与当前源码逻辑一致，不声称共享文件整体字节一致或自行推断差异原因。
- 注意构建身份：v7是bc01f0代码打包EXE，SHA256 `c231342a5e6027b63675d743ce7b7d88e9071c49cd7c07b060980ac52991a009`；v14为fab0ac8对应v11七产物的受控Electron观测壳，`native-case.json` 的main产物摘要 `4a5419f3...` 与v7应用清单main `a3910a55...`不同；两者固定worker摘要均 `5fdd08cd...`。不能把两个main当同一二进制，E源码无差异也不能将v14壳事件称为v7/v11 EXE原生回调实测。

## 代码与证据交叉结果

| 范围 | 源码静态证据（绝对路径与行号） | 历史事实与可接纳范围 |
| --- | --- | --- |
| 输入/输出schema及权限 | `D:/MC_start/OUCL-download-main/src/ipc/packs.ts:6` 先校验可信sender、版本、UUID、空payload；`src/shared/contracts/packs.ts:28` 限定exact envelope、固定preview和错误码；`src/ipc/preload-packs.ts:8` 使用白名单方法且校验回复。 | v3缺worker日志显示安全配置为contextIsolation/sandbox开启、nodeIntegration关闭；包含桥方法但握手未广告能力。v7真实EXE截图显示固定样本目标、配置、不可安装；同次不匹配图显示拒绝。 |
| 能力及产品展示 | `D:/MC_start/OUCL-download-main/src/main/index.ts:114` 仅在worker文件存在时构造reader/coordinator，`:221` 只在coordinator存在时加入能力；`src/ui/FixedPackPreview.tsx:16` 仅显示只读检查和unknown，无安装按钮。 | v3 `product-missing.jsonl` 显示缺worker时 `advertised:false`；v7最终EXE冷热真实选择/取消/不匹配通过。存在性检查不是持续健康检测：worker后续损坏/消失会失败，不应将能力广告称运行时持续健康保证。 |
| 固定字节与信任边界 | `D:/MC_start/OUCL-download-main/src/services/packs/fixed-worker.ts:15` 检查目录和有界普通文件；`:25` 先核对固定大小与SHA256，随后才检查归档/配置；`src/core/packs/fixed-preview.ts:13` 固定返回unknown。 | v7固定/一字节变体截图与 `comparison.json` 绑定原样本SHA256及变体SHA256；只能说明指定样本/不匹配门禁，不是对任意ZIP和依赖闭包的普遍验证。 |
| 原生picker与旧sender | `D:/MC_start/OUCL-download-main/src/main/index.ts:138` 销毁及`:139` 主框架导航中止旧sender；`src/services/packs/coordinator.ts:16` 在选择器前后和worker后复核，pending直到Promise settle才释放。 | v14原始事件19–20：受控reload后原picker真正取消settle，旧handler返回INVALID_SENDER、未创建pack worker；事件24–28新请求实际选取并等待worker exit0后返回preview，另有新DOM观察。真实native仅取消分支；迟到选中/拒绝为v13受控服务层。 |
| worker退出和取消 | `D:/MC_start/OUCL-download-main/src/services/packs/fixed-reader.ts:17` 创建有界worker，`:20` 中止/超时触发terminate，`:29` 仅在真实exit后结算并清理监听，`:35` 释放reader槽；coordinator `:21`、`:27` 管理全局槽。 | v13原始 `r2-abort-first.json`、`r2-deadline-first.json`、`r3-result-before-exit.json` 分别记录exit前两槽拒绝、exit1后旧请求拒绝、后继新worker自然exit0；v13测试日志6PASS/0FAIL/0SKIP。exit1为受控terminate，不标自然成功。 |

证据分层：v7 `comparison.json` 是空便携根中JSON、任务/请求/操作行和游戏文件列表的比较及两进程exit0；不覆盖已有玩家资料或全部Chromium缓存。v14 `native-events.jsonl` 是观测壳下真实native回调和worker退出，`dom-fixed-preview` 是另一次DOM观察；handler-returned不是renderer交付ACK。本轮查看了原始截图，图像支持上述固定样本/不匹配展示，不扩展为游戏启动。

## 可接纳、待补证、排除

- **可接纳**：固定样本单次只读入口、原生选择器取消/不匹配、其已约定的有限E-R1/R2/R3生命周期。v14的实际native取消和v13两个不同层级的受控测试互补；不重复将这些已闭合场景列为缺项。
- **待补证/限制**：未声称所有原生picker终态、非主frame和所有平台/文件系统并发情况均已真实窗口复现；v14迟到选中和chooser异常是服务级证据。`src/main/index.ts:115` 的能力判断检查启动时文件存在，不证明文件在此后持续存在/有效；未来出现真实部署损坏证据时，才需要独立确定是否需要更强健康机制。本次无足够证据认定其为当前可复现缺陷。
- **排除**：通用mrpack解析/所有恶意ZIP覆盖、下载Mod、创建隔离实例、安装或包级ready/回滚、服务端/签名源、全体玩家数据不变。固定样本预览的MC/Forge/Java文本不是游戏实际启动证明。

## 问题与运行说明

**本轮无实质性、可复现且有证据支持的生产问题；无严重度条目及无需立即整改的代码行。** 上述待补证为已有边界，不要求无变化重跑历史场景。

本轮仅只读源码、Git状态/差异、计算文件摘要及读取原始日志/JSON/截图；未启动Electron、选择器、游戏或测试，未运行全量检查，未修改稳定候选/活跃WIP、依赖、契约及批准记录。历史报告中的6PASS、79项审计和v7运行均为此前证据，不是本轮新运行。必要新增局部验证若以后出现具体新问题，应先向统一管理方列明场景、目标路径与预期并等待安排。
