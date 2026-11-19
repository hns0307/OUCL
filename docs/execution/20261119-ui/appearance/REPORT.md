# 外观图标选择补验

2026-11-20 · Windows x64 / Electron 45 · 产品源码基线 `78223e54`。

- 先用产品界面选择合法 PNG 并保存，再预览另一套配色。保持第二次图标选择处于等待状态时，检查外观面板中的按钮、输入框和下拉框均禁用。取消后控件恢复，预览配色、图标和已保存设置仍在，界面没有错误。
- 提交一个扩展名为 PNG、内容无法解码的本地文件。产品的图片读取与解码路径返回失败，界面显示可读错误。预览和已保存外观保持原值，撤销预览可清除错误并恢复已保存颜色。
- 同一测试资料正常退出并重启。原图标和原配色可从真实存储回读，界面继续显示原图标。

文件对话框由夹具控制等待、取消和返回路径。图片读取、解码、IPC、界面状态和持久化使用产品代码。操作系统对话框未打开。

首轮 21 项、重启 3 项通过。[首次运行结果](pass-1.json) · [跨进程结果](pass-2.json)

类型检查、完整 ESLint 和独立构建通过。完整回归 1008 项中 1004 通过、0 失败、4 项原有跳过。[回归摘要](regression-summary.txt)

## 复现

从仓库根执行。

```powershell
$env:OUCL_BUILD_ROOT = Join-Path $PWD '.test-build/execution-appearance-20261120/dist'
$env:OUCL_VALIDATION_DIR = Join-Path $PWD '.test-build/execution-appearance-20261120/final'
node scripts/build.mjs
node scripts/interaction-smoke.mjs
```
