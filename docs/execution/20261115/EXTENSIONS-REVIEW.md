# N5/N6 扩展IPC独立审查与专注测试

日期：2026-11-15（Asia/Shanghai）。审查对象为本次新增online-tools、distribution-preview共享契约、main adapter与preload bridge。独占改动为 `tests/extensions-ipc.test.ts` 与本报告；不修改产品代码、不运行全量回归。

## 实际发现

| 编号 | 事实与运行反例 | 影响 | 状态 |
| --- | --- | --- | --- |
| E-01 | `isDistributionSummary({...valid, receiptStatus:['valid']})`返回true；类似area、ownership、kind和code字段使用String转换，也允许数组冒充字符串枚举。新增测试 `distribution public enums require strings rather than coercible arrays` 原断言失败。 | 严格公共DTO校验不符合接口声明，preload会接纳类型不正确的数据。 | 协调者已修复，原反例复跑通过，已闭合。 |
| E-02 | DistributionPreviewAdapter的sources分支在注入port.listSources抛异常后，handle直接reject原Error，而未返回受控UNAVAILABLE。新增测试 `distribution source-list port exceptions become controlled public failures` 原断言失败。 | main响应缺少统一脱敏失败投影，调用方需要兜底；不能依赖仅生产端口当前不抛异常。 | 协调者已修复，原反例复跑通过，已闭合。 |

初读工具转义后的文本时曾误判正则unicode转义；已用真实导入模块测试普通英文标题、换行/NUL和相对路径正反例，均符合预期，撤回该告警，未要求修改其正则。

## 测试覆盖

17项专注测试使用真实OnlineToolsAdapter、DistributionPreviewAdapter、两种preload bridge与共享validator，端口注入内存实现，无Electron、网络或磁盘玩家数据依赖。

覆盖可信文档、未来版本、额外字段/URL/公钥拒绝、同ID相同输入合并、跨操作/跨实例冲突、完成后重放、文档失效/迟到关闭/预览丢弃、128在线mutation及16预览记录有界、容量满仍允许关闭/取消、取消等待端口settle而不提前返回、固定错误脱敏、DTO边界、preload操作响应混淆拒绝，以及使用Node模拟时钟验证15秒在线mutation和45秒预览超时不隐式重试或取消、保留原请求ID并忽略迟到成功。

首轮13项全部通过；加入两项确凿反例及两个超时测试后，修复前为 **17项：15 PASS / 2 FAIL / 0 SKIP，exit1**，两个FAIL即上述发现；协调者修正产品后，同样原断言复跑 **17 PASS / 0 FAIL / 0 SKIP，exit0，120.1682ms**。没有改断言或跳过。

## 可复现命令

从本工作树根，现有固定依赖，无安装：

```powershell
$env:OUCL_TEST_ROOT='D:/MC_start/OUCL/tmp/extensions-ipc-review-20261115'
node --input-type=module -e 'import {build} from "esbuild";await build({entryPoints:["tests/extensions-ipc.test.ts"],bundle:true,platform:"node",format:"esm",target:"node24",outfile:process.env.OUCL_TEST_ROOT+"/extensions-ipc.test.mjs"})'
node --test "$env:OUCL_TEST_ROOT/extensions-ipc.test.mjs"
node ../../node_modules/eslint/bin/eslint.js tests/extensions-ipc.test.ts
```

本测试ESLint实际exit0。仓库tsc扫描时本测试无诊断，其他并行中的DistributionPanel出现两项暂态错误，未将其说成全仓类型通过。该测试是IPC/规则层受控验证，不等同真实WebContentsView隔离、生产sender/frame装配、站点许可、远程签名源、GUI或游戏验收。来源与公钥为空时不伪造已配置支持。


## 最终接线只读复核

追加main/index.ts、main/online-tools.ts、main/distribution-preview.ts与ToolsWorkspace、OnlineToolsPanel、DistributionPanel源码审查，未把这些静态核对称为真实Electron/GUI验收。

- 主进程继续核对BrowserWindow、精确应用文档及主frame，外部WebContentsView无preload。导航、renderer退出、销毁及hide均撤销相应adapter；在线原生选择器前先关闭远程view。
- 在线关闭按钮不受busy禁用，调用run(interrupt=true)提升generation，旧open/retry回执不能覆盖新close；轮询状态只接纳单调revision，卸载退订并请求关闭。
- ToolsWorkspace按tab挂载/卸载面板，DistributionPanel按root/instance key重新挂载；旧预览回执有alive及request身份检查，卸载请求cancel。
- **E-03（P2，静态可达竞态，已闭合）**：DistributionPanel.cancel的then/catch只检查alive，没有核对request.current===id。A取消等待中，A预览先settle释放busy后可发起B；随后A取消失败会将A错误写进B界面。协调者已在then/catch两个失败分支增加request.current===id；本代理实际重读源码确认，旧取消回执不能覆盖新request。此项按源码审查闭合，未冒充组件夹具复现；本代理未修改产品。

新增state.code数组反例后再次运行17项，**17 PASS /0 FAIL，101.9359ms**；本测试ESLint仍exit0。UTF-8原始专注日志已归档为 [final-test.log](extension-ipc-evidence/final-test.log)，仍保留独占临时根副本。


最终日志捕获实际通过Node spawnSync执行与上方相同的 `node --test <独占根>/extensions-ipc.test.mjs`，将stdout+stderr以UTF-8写入临时final-test.log，再按文件复制归档；未更改日志内容或重新编码。最终17项运行退出码0，测试数量/耗时可从归档日志直接核验。该目录只存本次IPC专注日志，不混入其他代理GUI或全量结果。
