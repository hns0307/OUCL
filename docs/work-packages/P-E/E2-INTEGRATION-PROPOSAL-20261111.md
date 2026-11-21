# P-E 固定样本产品只读入口：待审批的具体增量

日期：2026-11-11。状态：**PENDING，设计稿，不是新增授权记录**。依据本聊天用户“继续”，本轮完成可审查集成设计与独立研究证据。前一增量只批准固定样本内部worker，未批准新增公共IPC/能力或实例事务。P-A/P-B/P-C/P-D仍在共享工作区修改公共文件；集成时逐文件核对并协调，不覆盖其工作。

## 1. 可见结果和边界

产品新增一个按钮“检查整合包样本”：用户选择本地文件后显示目标Minecraft 1.20.1、Forge 47.4.28、Java 17要求、一个FerriteCore文件、客户端配置覆盖与“尚未验证运行环境和Mod；当前不可安装”。仅接受E0固定1355字节及SHA256，其他文件提示“当前仅支持已选定的测试样本”。不提供“确认安装”或生成实例按钮，不声称支持一般mrpack。

推荐单次 `packs:inspectFixed` 完成选择和检查，而非建立可长期持有的 selectionId/planId。用户取消选择返回 `cancelled`，没有额外创建任务、订阅或持久记录。没有生成可执行计划；`unknown` 是检查结果，不是业务错误。

## 2. 公共契约（建议version 1）

能力 `packs.fixed-preview.v1` 仅在worker构建产物存在、服务成功装配且受控选择器可用时出现在握手结果；生产没有实际服务时不广告。项目现有能力由 [handshake.ts](../../../src/shared/contracts/handshake.ts) 白名单和 [preload.ts](../../../src/ipc/preload.ts) 显式桥接，本能力需要修改它们，必须单独批准。

通道 `packs:inspectFixed`，sender须为当前可信主框架；每次验证请求前及选择器/worker返回后再次验证sender仍有效、文档仍可信。

请求 exact：

```json
{"contractVersion":1,"requestId":"UUID","payload":{}}
```

成功 exact，`data`只有二选一结构：

```json
{"contractVersion":1,"requestId":"UUID","ok":true,"data":{"state":"cancelled"}}
```

```json
{"contractVersion":1,"requestId":"UUID","ok":true,"data":{"state":"preview","preview":{"formatVersion":1,"status":"unknown","reason":"ENVIRONMENT_AND_MOD_NOT_VERIFIED","archive":{"sha256":"e4cf7d5607a70582cfcec200a381892a83c75e122f5be6bad926de23ff7278f2","size":1355,"entries":3,"expandedBytes":889},"target":{"minecraft":"1.20.1","loader":"forge","loaderVersion":"47.4.28","javaMajor":17,"isolated":true},"file":{"projectId":"uXXizFIs","versionId":"DG5Fn9Sz","size":123034,"sha1":"417fb6ce8f52abf40bd9d0390371790f9576f8ba","sha512":"a1960a7c03dc32d4ccaccaf28afdd9b078758bbd62d15a91d4039a83fa9397a098e89b69591f6bd5190254d9ee97e502504154b9aec764adb8c65f000b75ba2c"},"override":{"path":"config/oucl-pe-smoke.properties","size":14,"sha256":"9df1c49a83b3c3caf03c6fbb8abc44dda9d191e0fa01161aacff385174f900c3","layer":"client-overrides"}}}}
```

字段全部exact且与固定样本值一致，所有数量是安全整数；拒绝额外键、`ready`、任意路径/URL及无关实体。SHA值是已公开固定输入信息，不把它作为来源签名或下载授权。

失败 exact：`{contractVersion:1,requestId,ok:false,error:{category,code,messageKey,retryable,traceId}}`，`traceId` UUID。映射固定如下，不能返回原始路径或异常：

| code | category | messageKey候选 | retryable | 情况 |
| --- | --- | --- | --- | --- |
| INVALID_ARGUMENT | validation | invalidArgument | false | envelope/payload不符 |
| INVALID_SENDER | permission | invalidSender | false | sender/导航失效 |
| UNSUPPORTED_CONTRACT | validation | unsupportedContract | false | 未来版本 |
| UNAVAILABLE | system | unavailable | true | 服务无能力、忙或worker异常 |
| TIMEOUT | system | timeout | true | 本次观察超时，不暗示后台已取消 |
| FIXED_SAMPLE_MISMATCH | validation | packSampleMismatch | false | 所选字节/大小不同或归档校验失败 |
| CANCELLED | cancelled | packCheckCancelled | true | 受控检查取消；选择器取消正常返回state |

本轮已修正内部错误：不同内容或可读但大小不符返回 `INVALID_SAMPLE`，不存在/读取失败返回 `READ_FAILED`，安全路径检查失败返回 `UNSAFE_PATH`，无效worker请求返回 `WORKER_FAILED`；消息不含路径。`readRegular` 将超过16MiB和不安全类型都映射为UNSAFE_PATH，因此不能将此码展示为断言“发现链接”；公共入口仍需明确大小超限的独立可见语义。该修正只涉及已批准的私有固定预览，未新增公共错误契约。

## 3. 受控文件、并发和生命周期

1. 主进程用原生选择器，仅 `openFile`；扩展名过滤只是提示，仍以实际字节/摘要为准。renderer不提交文件路径或URL，拖放不属于本片。
2. 实际路径由主进程持有，先检查祖先与普通文件句柄，读取有界字节并核对固定SHA256。选定后文件变化、链接、拒绝访问均受控失败；路径、选择器结果不写日志/持久记录。
3. **当前worker按路径重新打开文件**；它再次做句柄和摘要核验。由于只接受固定摘要，替换成不同字节不会成为成功预览；但现有祖先检查无法宣称防御同权限恶意进程持续替换。推荐后续将已验证字节副本传给worker并复算摘要，或复制到受管私有暂存；这是新的内部输入协议/生命周期选择，先评估再变更。不因预览而在用户数据目录创建暂存。
4. 单sender最多一个选择或worker检查，全局最多一个活动worker；重复同sender/requestId在途合并，异payload本契约无效，同sender其他requestId返回UNAVAILABLE，不排无限队列。请求完成后不永久保存本地路径；重复requestId不保证恢复已结束结果，UI不得把该只读操作当幂等写回执。
5. renderer观察超时建议130秒；主进程检查worker最长120秒，超时terminate并等待exit。选择器等待单独计时，**不能假设Electron原生对话框可由计时器可靠关闭**。选项A选择器不设主进程deadline、每sender保持在途并在用户关闭对话框后才释放（推荐）；选项B引入平台验证过的可关闭对话框，需额外实现与验证。UI超时后禁止自动弹出第二次；给出“仍在等待选择/检查”或显式重新观察，不能将Promise.race当作取消。显示状态需避免把未知当失败。
6. sender销毁/导航后，若worker已启动则abort并join；若对话框仍打开则标记失效，等待其真实返回后丢弃结果、释放对应在途项。旧回执不得更新新窗口。检查不会创建任何业务任务，退订/关闭窗口不影响其他下载。
7. 只读单次调用不新增任务订阅。若未来改成长任务，必须另定义请求受理、可取消动作、订阅/退订与重连；不能拿本接口声称后台任务功能完成。

## 4. 精确拟改文件与风险

| 文件 | 改动 |
| --- | --- |
| 新 `src/shared/contracts/packs.ts` | 本页exact请求、两种成功结果和固定错误映射，序列化上限、guard |
| 新 `src/ipc/packs.ts` 与 `src/ipc/preload-packs.ts` | sender/版本/输入/输出校验、只读调用、超时与迟到结果 |
| `src/shared/contracts/handshake.ts`、`src/ipc/preload.ts` | 仅加能力/bridge，按服务实际可用性广告；保持现有能力 |
| `src/main/index.ts`、`scripts/build.mjs` | 显式装配服务、原生选择器/生命周期，构建专用worker；不得修改其他通道行为 |
| `src/services/packs/fixed-reader.ts`、`fixed-worker.ts`、`fixed-protocol.ts` | 错误区分、适配构建入口；保持固定样本门禁 |
| 新 `src/ui/FixedPackPreview.tsx`，`src/ui/App.tsx`，`src/shared/locales/messages.ts` | 小型入口和中文状态；不放入已拥挤的资源浏览器状态 |
| 新 `tests/fixed-pack-ipc.test.ts` 与既有 `tests/fixed-pack-preview.test.ts` | exact schema、生命周期、真实worker及原生选择器替身测试 |
| P-E验证目录 | 独立build/test输出和产品界面证据 |

`src/main/index.ts`、`src/ipc/preload.ts`、`src/ui/App.tsx`、messages、构建脚本与其他聊天改动可能重叠。动手时以实际工作区为准，先取得文件协调窗口；必要时在另一受控工作树实施，不能切共享分支或重写变更。无需新增第三方依赖、SQLite表或版本化持久记录。

## 5. 验收与故障注入

| 场景 | 必须观察 |
| --- | --- |
| 真实固定包 | 可从产品选择，显示固定环境/覆盖/unknown；没有安装入口；不创建实例或任务 |
| 其他包、损坏、文件被替换 | 按实际情况返回固定错误；结果不泄路径；不显示ready |
| 可读/不可读/软链接及父目录链接 | 授权选择、普通句柄与安全失败分别测；不以扩展名断言安全 |
| sender/请求 | 不可信、子frame、未来版本、额外字段、错误requestId均在选择器前拒绝；sender导航后迟到结果丢弃 |
| 迟到与取消 | 选择器未返回时renderer超时、关闭窗口、再次点击；不会重复弹框或残留无限任务；worker取消确实exit后才释放 |
| worker错误 | 返回畸形或额外字段、重复/迟到消息、非零退出、崩溃、超时、同时请求；没有伪成功和未释放并发槽 |
| 构建/关闭重开 | 产品构建中worker路径存在并可执行；正常重开握手能力与真实可用性一致，无持久路径/选择记录 |
| 安全/不污染 | 记录before/after独立测试根实例列表与内容摘要；无网络、无实例目录、无任务、无外部文件变化 |

测试分层：纯schema与adapter使用fake sender/selector/worker；真实打包worker用E0样本与独立测试目录；实际Electron产品路径另记截图、构建身份、状态和退出。人工原生对话框验收需独立测试根及允许的GUI操作，不复用旧EXE或玩家实例。完整仓库typecheck/lint/test/build输出使用P-E独立目录并报告其他工作包并发变化；任何GUI未运行留待验收。

## 6. 审批选择

事实：现有worker不对玩家提供入口；公共能力/IPC/界面会改变已批准契约，必须明确批准。选项A批准上述固定样本、单次只读入口与exact契约（推荐）；选项B保持内部预览，先继续独立研究/等待共享文件协调。两者都不授权整包安装、持久schema、任意mrpack、其他来源或后端。

本轮为方案，未变更公共源/审批记录、未运行产品界面或游戏。
