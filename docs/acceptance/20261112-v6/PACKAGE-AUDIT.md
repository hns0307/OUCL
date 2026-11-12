# 最终EXE打包证据只读审查

2026-11-12（Asia/Shanghai）。仅新增本文，未运行preflight/audit脚本（它们会写结果）、打包、GUI、游戏、提交或产品修改。主协调独占热轮窗口；本轮只读已生成JSON/manifest/build report、产物和截图。开工五小时usedPercent=30、剩余70%、resetsAt=1794493614；已读最新TASK_PLAN/DECISIONS及仓库规则，周额度不作为门槛。

## 结论

主协调采用“原先不存在的dist直接复制已验v3七产物，再bootstrap-package”而未另stage，**不构成重新构建产品**。严格Node预检、EXE内嵌资源、解包内容和原七文件已经形成可核对链；本次独立只读复核未发现产品漂移或包内容不一致。

审计脚本有覆盖局限，下列结果不能只根据audit.json推导：运行时首次是否确实空目录、下载ZIP是否独立保留重哈希、manifest外有无额外文件、目录是否缺失、全profile是否不变、窗口点击结果及完整生命周期。本轮补充检查已覆盖其中的额外文件/链接、清单与EXE绑定、七产物与冻结源一致；其余按实际证据层级列出，不扩大结论。

## 独立只读复核结果

所有下列相对路径均以`D:/MC_start/OUCL-acceptance-v3-20261112`为根。

- 最终发布EXE及`acceptance-results/v6-package/cold-runtime/OUCL.exe`均实测405504字节，SHA256均为`c231342a5e6027b63675d743ce7b7d88e9071c49cd7c07b060980ac52991a009`，与build.log及`docs/validation/BOOTSTRAP-0.3.0-acceptance-20261112-v3/package.json`一致。
- 当前仅一个打包工作目录`.test-build/bootstrap-0.3.0-1794477283958`。其configuration记录官方Electron45.0.0 GitHub URL、ZIP摘要`ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47`、appHash `51cbde417518453652144fde7b20b5a28c5abba852af62e6685a08d840e19df3`，均与report/解包namespace一致。
- 仅用.NET反射读取EXE资源流，没有执行EntryPoint或产品方法。内嵌configuration、app-manifest、runtime-manifest、application四资源的SHA256均与上述工作目录的configuration/app.manifest/runtime.manifest/app.zip逐字节一致。app-manifest自身SHA256就是report.appHash；不是仅相信解包目录名字。
- 递归枚举实际解包runtime/app，要求均为普通文件/目录且无符号链接，并比较实际文件集合与manifest精确相等、每文件SHA256相等：**73 runtime文件、9 app文件，无额外/缺失文件**。此检查补上audit.mjs未枚举manifest外文件的缺口。
- v3 product-manifest七份产品在原`acceptance-results/product`、打包输入dist、最终解包app/dist三个位置均一致；597项FREEZE-MANIFEST重新逐项哈希一致。只证明清单覆盖的冻结输入，无“整个工作目录完全无新增文件”承诺。
- 已记录八个时点before-picker、after-fixed、after-cancel、after-mismatch、cold-closed、hot-opened、hot-fixed、hot-closed的JSON清单/摘要、三表计数/摘要、game文件列表全部一致：两份JSON（catalog/installation），tasks=0、requests=0、operations=2，game文件列表为空。owner在两次closed均false、打开时为true。
- 读取冷退出记录：自有产品PID36196，hasExited=true/exitCode0。审查期间主协调新增热记录：PID1488，hasExited=true/exitCode0，以及audit-hot-closed owner=false。本报告只核对其记录值，不声称亲自操作/观察进程退出。
- 已实际查看`cold-runtime-progress.png`：引导窗口明确显示“正在下载运行环境：97 MB / 150 MB”；已查看`cold-sample-result.png`：真实产品下载页展示MC1.20.1/Forge47.4.28/Java17/FerriteCore6.0.1，以及“尚未验证运行环境和模组；当前不可安装”。其余picker/取消/不匹配/热轮截图与具体操作由主协调负责整理关联。

独立检查首轮有一个临时Node表达式误用清单字段sha而不是sha256，导致在已成功核对73/9文件后提前断言失败；修正该只读表达式后七文件和597项及快照比较均通过。未生成伪PASS文件或修改原审计结果。

## 脚本发现与对本轮结论的影响

### PA-01：初始PowerShell预检的空数组不能证明通过（已由有效链替代）

主协调说明dist不存在时，旧PowerShell非终止读取错误使mismatch数组为空。保留的`acceptance-results/v5-global/package-preflight.json`只有frozenFiles/productFiles/sourceDrift/productMismatch统计，不是该次每个目标都成功读取的证明；不得单独引用为有效包输入验证。

后继`v6-package/preflight.mjs:7`–`:13`对每次readFile失败直接reject，若dist不存在才cp，随后七项dist哈希必须成功匹配才写`:14`–`:15`的PASS。实际preflight.json明确copiedExistingVerifiedBuild=true。本轮又只读重查dist与最终解包七项一致，因此初始失败没有污染最终输入结论。旧失败记录应标SUPERSEDED/INVALID，不删除或算一次通过。

### PA-02：audit依赖“最新工作目录”，未自行绑定report（可复用性缺口，本轮已补核）

`audit.mjs:15`–`:16`按名称排序选最后bootstrap目录；没有断言唯一目录，也没校验configuration/清单与report.appHash、实际EXE内嵌资源同源。后续若再打包，旧EXE可能被拿去对另一次清单核对。当前仅一个工作目录且上述四内嵌资源已独立比对，故不阻塞本轮。

后续建议验证夹具显式接收本次工作目录，并校验manifestSHA=appHash与configuration、内嵌资源；不是要求变更产品。审计报告应固定工作目录路径，避免未来重新运行时“最新”指向变化。

### PA-03：逐项哈希未排除额外文件、链接、目录穿越（本轮独立补核，无需动候选）

`audit.mjs:17`–`:23`只遍历manifest列项，readFile会跟随链接，未检查实际目录集合、普通类型、manifest路径边界或重复项。`preflight.mjs:7`–`:13`也只核对列项，不扫描dist额外文件。清单是本机打包脚本生成的受控输入，此处不等于已存在安全漏洞，但“audit.json本身证明完整无额外内容”过强。

本轮已对实际解包runtime/app做精确集合/无链接核对，并绑定EXE资源/七产品。Launcher生产Verify也有全树额外文件/链接检查，见Launcher.cs:73–:94。两个层级不能混为audit脚本自身能力。

### PA-04：`games=[]`仅说明未记录游戏文件，不证明目录完全不变

`audit.mjs:28`把任意ENOENT目录当空列表，`:31`仅记录文件，不记录空目录。因此games=[]可表示“目录不存在”或“目录存在且没有文件”，不能推出“游戏目录存在/没有创建子目录”。JSON列表确实覆盖metadata全部.json文件摘要，但不覆盖profile其余缓存、WAL、网络状态或其他目录。

建议最终写为：“八个采样时点实例/包JSON未新增，已记录JSON与三表状态一致，游戏目录未记录文件变化”；若要断言便携根已创建，另用已有installation真实dataDirectory及目录类型物证，不凭games=[]。不必为了纯缓存变化判产品污染。

### PA-05：SQLite摘要是采样状态，缺固定排序/同一读事务

`audit.mjs:37`逐表SELECT *没有ORDER BY，也不是三表同一显式读取事务；非空大量行时摘要可能因行顺序/并发变化而难比较。当前tasks/requests为空、operations两行，各采样摘要实际相同，支持本轮记录状态相同；不能扩成整个运行期间从未短暂写入或所有数据库字节未变。

建议未来夹具按主键稳定排序并在同一只读事务采样，保留当前原记录不重写。ownerPresent是是否存在标记，不是原子操作系统句柄占用证明；exitCode0与正常关闭操作证据一起使用。

### PA-06：报告bytes字段来自build report（本轮已独立实测）

`audit.mjs:40`使用pack.bytes，没有stat实际EXE；`:11`会强制核对实际EXE SHA256，已提供更强内容绑定，但不能说脚本单独测了字节数。本轮对发布EXE及便携副本均stat=405504，已补足。

## 冷/热及E最终边界

1. 冷轮实际进度截图、已审Launcher下载/校验代码、正确的runtime/app及EXE摘要支持真实下载路径和产品启动证据；audit脚本本身没有“启动前目录只有EXE”的快照。该前置条件按主协调实际创建/启动记录关联，不可仅由启动后的目录反推。下载临时ZIP按Launcher正常清理，不存在独立保留ZIP供本次重哈希的证据；因此写“官方URL配置、程序校验路径及实际下载启动通过”，不要声称另有本次独立ZIP离线校验日志或完整网络溯源。
2. 热轮opened/closed快照的app/runtime namespace及摘要与冷轮一致，热固定样本数据快照一致且exit0/owner=false已到位。是否实际完成原生picker并展示结果，应引用主协调热轮截图/窗口观察，不用相同目录替代UI动作证明。
3. 最终EXE包含正确fixed-pack.cjs且固定picker运行，解决的是正常组件打包/真实入口。missing-worker仍引用v3独立受控构建无能力广告证据，不通过删除最终app的worker验证；完整manifest会重新解包。
4. 固定样本拒绝不同字节、不提供安装，是固定只读能力验收，不是通用mrpack/ZIP攻击矩阵或整合包导入。窗口销毁所有迟到回调/worker竞态仍按v4有限证据保留；不因本次冷热正常使用而自动关闭。
5. 最终EXE测试本轮是空便携根/picker，不包含游戏实际运行；D在同七产物v5的原版/Fabric/FerriteCore菜单/退出0/重开为独立关联证据，不能改写为最终EXE新装或真冷游戏下载。
6. Quilt别名仍排除；A真实EXE强制终止恢复DEFERRED；世界载入、四加载器全矩阵、签名发布、自动更新或异常中断恢复不由本次覆盖。

## 建议最终清单表述

可写：“固定v3候选的最终EXE内容一致性已独立复核，冷轮真实运行时下载和只读样本选择/取消/不匹配、同profile热轮按主协调实际窗口与退出记录归档；采样JSON/任务/游戏文件数据无变化，冷/热正常关闭exit0且owner释放。”

不可写：“所有文件/整个profile完全不变”“审计脚本证明全程无网络/无写入”“引导器退出等于游戏成功”“missing-worker经过最终正常EXE验证”“历史所有开放项已通过”。当前脚本缺口已在本文区分为本轮补核项与仍保留边界，不需要为报告更强措辞扩展产品或重跑无变化的完整回归。

## 后继严格审计及热轮补证（同日追加）

主协调在本报告初稿后增强验证夹具，未改产品；本节说明后继状态，前文PA-02/03/04描述的是原脚本能力，不能再误当作最新版全部仍缺。

已只读核对新版audit.mjs：固定`.test-build/bootstrap-0.3.0-1794477283958`；明确校验configuration runtimeChecksum/appHash；对runtime/app比较manifest与实际递归文件集合并拒绝符号链接；移除readdir ENOENT→[]兜底，对OUCL.games执行lstat/isDirectory。对应`audit-final-strict.json`记录73/9文件、相同清单摘要、owner=false。先前目录缺失混同、最新目录选择、额外文件/链接三个缺口已被本次严格运行补齐。清单路径/普通文件强校验、稳定SQL排序/一致事务、实际bytes仍按前文边界；本轮另有独立检查补普通类型/实际bytes及EXE资源绑定。

已只读审查compare.mjs和`comparison.json`：九时点明确比较executable/runtime/apps/runtimeProof/appProof/json/tables/games，断言冷/热closed owner=false、两产品退出hasExited/exitCode0，重新验证固定样本及变体SHA256；报告PASS，scope明确空便携根固定只读、排除Chromium缓存、无玩家已有数据保证、非通用导入/游戏运行。本任务没有重跑会写结果的脚本，也未重验GUI。

另实际查看`hot-sample-result.png`，热轮产品页面显示固定样本MC1.20.1/Forge47.4.28/Java17/FerriteCore6.0.1和当前不可安装提示。结合自有PID1488退出0及owner释放、冷/热相同产物与数据快照，可支持主协调关闭“最终EXE固定只读入口冷热正常使用”缺口；不扩成异常回调全矩阵或所有profile文件不变。

最新版脚本SHA256（本任务只读计算）：

| 脚本 | SHA256 |
| --- | --- |
| audit.mjs | e50a4a26d972c986549a5052d954bf946de9f8a054e06a13090c46f9d2907410 |
| preflight.mjs | ed81c323c6d44b11d89b76a4394f58126052707074399c23faf10553c5620477 |
| compare.mjs | 99067766692ff99801e7858ef72037fa1de5e61199d81e2288c612cbb45502b1 |

主协调明确提供的操作限制亦应保留：最初带remote-debugging参数的启动被Cua拒绝，没有绕过；实际冷/热两轮只有disable-gpu、没有调试端口。因此没有捕获最终EXE公开握手，不能把picker可用与七产物一致改写为逐字段握手验证。一个像素操作被自动审批拒绝，没有重复；其后原生picker来自原语义点击的迟到出现，后续使用语义控件输入。该时间顺序不按被拒点击记成功，也不据此声称选择器所有迟到回调已闭环。

后继严格审计没有改变仍开放事项：独立留存下载ZIP校验物证、完整网络溯源、所有回调/中断竞态、已有玩家数据不污染、最终EXE游戏运行及Quilt/强制终止恢复等。上述均不妨碍按本次明确范围记录正常冷/热固定只读入口通过。
