# 增量报告 v15：C真实接纳回执丢失与同身份重试

本阶段未改产品。在固定v3七产物的真实Electron窗口中，首次接纳成功回执延迟8秒，原preload自然3秒超时；GUI再次点击同文件，实际复用同requestId、同输入、同previewId并显示completed。9项只读核验通过，正常退出0，六JAR/五任务前后保持。

## 精确执行链

v3 `acceptance-results/c-admission-v14/window.cjs` 为独立测试壳（目录名沿准备时间保留，不等于本报告版本），只包装第一次实际成功接纳回执，8秒后原样释放；领域、clock、preload、组件及其他响应不替换，外网拒绝。使用原已关闭的v4-bc合成profile，PID23868/window5113622，启动逐SHA验证固定七产物。C实现与v11相同，未重新构建或冒称最终EXE冷验。

主协调选中A的alpha-provider.jar，实际首次接纳UTC11:01:24.268，requestId `c45b5f51-f4fd-4f57-a0e2-cfc293dca9bd`，previewId `97775ea6-dfa3-4d8d-acf9-afea2d342707`。原preload超时后，GUI显示等待超时且同文件预览按钮恢复；没有切实例/刷新列表。UTC11:01:32.271原接纳回执真实延迟8003.358ms释放，未导致组件自行接收/开始状态轮询。

随后主协调GUI再次点击同文件，UTC11:02:11.239原handler返回相同requestId、严格相同输入和同previewId，唯一公开观察ID=1；原status真实completed、blocked/alpha-dependent缺依赖，DOM和截图显示完成并清除旧超时。这里计数的是真实handler返回的公开观察身份，不是直接测量inspection.check次数。固定MaintenancePreviewJobs.start的既有ID分支在queueMicrotask之前返回，连同同身份事实支持复用原观察；不把两个handler调用称为两个扫描，也不把唯一ID伪装为扫描计量。

`node acceptance-results/c-admission-v14/verify-result.cjs` 实际输出verification.json为9 PASS / 0 FAIL / 0 PENDING；核对真实TIMEOUT、相同身份重试、真实completed/DOM、首迟到回执原样释放、正常退出。主协调实际查看重试完成截图，handled/delivered与UI消费分开。

正常GUI Alt+F4关闭后exit0、owner.lock不存在。正式只读快照before/after六JAR、五tasks字段逐字节相同，不修改文件或持久任务。原后台无效果点击不算业务接纳，目标可见后的前台语义点击才触发第一实际请求。

## 关闭范围

C-R2真实组件接纳丢失后同身份重试闭环已通过。同ID不同输入的registry单测沿用既有结果；若声明真实公共非法输入矩阵全关闭，仍需结合C-R7后继边界证据，不把本次未发的冲突请求写通过。

C-R3/R4的真实网络在途取消/正常退出观察、R5跨实例迟到回执、R6多声明JAR/正式平台解析组合、R7真实frame/回执防御继续按有限计划补证；准备脚本不计PASS。E三组有限生命周期见v14；A最终EXE强制中断恢复仍DEFERRED，完整历史目标继续IN_PROGRESS。不push/发布、不整体暂存活跃共享树。
