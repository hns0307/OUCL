# 渐变文字工具产品窗口补验

2026-11-20 · Windows x64 / Electron 45 · 产品源码基线 `3be398dd`。本轮扩展已有产品窗口验收，未改动产品源码。

- 输入包含两个汉字与一枚家庭组合表情的文字，将起止色改为红色和蓝色。JSON 输出为三个字素，颜色依次为 `#ff0000`、`#800080` 和 `#0000ff`。选择输出后，输出框获得焦点并选中完整 JSON。
- 从 Electron 向产品窗口发送 Ctrl+C，Chromium 将受信任的复制事件派发给输出框。夹具核对事件对应的选区等于完整 JSON，并取消默认动作以保留系统剪贴板。本轮记录键盘事件和选区，未验证系统剪贴板写入。
- 输入 256 个组合表情时输出 256 项。第 257 个触发长度提示，清空输出并禁用选择按钮。空输入显示提示，恢复有效文本后重新生成 JSON。

首轮 23 项、重启 3 项通过。[首次运行结果](pass-1.json) · [重启结果](pass-2.json) · [工具箱截图](toolbox.png)

类型检查、完整 ESLint 和独立产品构建通过。完整回归 1008 项中 1004 通过、0 失败、4 项原有跳过。[回归摘要](regression-summary.txt)

## 复现

从仓库根执行。

```powershell
$env:OUCL_BUILD_ROOT = Join-Path $PWD '.test-build/execution-toolbox-20261120/dist'
$env:OUCL_VALIDATION_DIR = Join-Path $PWD '.test-build/execution-toolbox-20261120/final'
node scripts/build.mjs
node scripts/interaction-smoke.mjs
```
