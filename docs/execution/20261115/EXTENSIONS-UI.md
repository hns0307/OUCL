# N5/N6 真实 React 组件窗口验证

2026-11-15。使用 Electron 45 隐藏窗口装载真实 `ToolsWorkspace`、`OnlineToolsPanel`、`DistributionPanel` 和本地工具组件；fixture 明确注入合成 `window.oucl`，没有生产 preload/IPC、真实远程 view、签名源、密钥或玩家目录。

## 实际结果

最终 **19 项 PASS / 0 FAIL**，Electron 进程 exit0。原始结果：[result.json](extension-ui-evidence/result.json)。第一次17项通过后，按主协调已修复的取消回执竞态追加两项，再实际运行得到19项通过；没有改产品或降低断言。

覆盖：

- 工具页初始本地工具和固定标签切换；空在线记录显示尚未配置，空社团源不显示可提交表单。
- 合成在线工具打开、在途重试时关闭、旧重试即使返回更高revision也不能重开已关闭UI；离开在线标签实际调用关闭端口。
- 包/版本为空和非法包标识时禁用预览；真实输入事件更新React；在途预览禁用编辑并显示取消，取消后释放表单。
- A预览发起取消，A先完成；开始同实例新B预览后，旧A取消失败回执不能给B显示错误或清busy；B随后正常显示。
- 切实例时真实key卸载触发旧请求取消；fixture故意延迟A结果到新实例B挂载后再返回，旧结果没有填充B的输入或预览；B新请求正常显示。
- 正确展示只读归属、用户覆盖和冲突；不存在安装、执行或确认更新动作。
- 1100px和480px内容视口均无水平溢出。宽/窄截图已实际打开复查：输入、操作及结果可读，窄窗自然换行，未见截断。截图是该合成组件页面，不是正式主窗口或真实网站布局验收。

截图：[宽窗口](extension-ui-evidence/extensions-wide.png)、[窄窗口](extension-ui-evidence/extensions-narrow.png)。Windows设备缩放使PNG物理像素大于CSS视口，实际检查按window.innerWidth计算。

## 运行与安全边界

```powershell
$env:OUCL_TEST_ROOT = 'D:\MC_start\OUCL\tmp\extensions-ui-20261115'
node scripts/extensions-ui-check.mjs
node ../../node_modules/eslint/bin/eslint.js scripts/extensions-ui-check.mjs scripts/extensions-ui-fixture.tsx
```

本次经受控沙箱外自动审批运行独占隐藏Electron夹具，以避免既有沙箱内app-ready限制；未使用 `--no-sandbox`，保持 `contextIsolation:true`、`sandbox:true`、`nodeIntegration:false`。夹具CSP禁止连接，session阻断所有HTTP/HTTPS、新窗口及权限；临时userData仅在独占测试根。Node/GUI没有读取用户profile或游戏目录。

局部ESLint实际exit0。夹具脚本、入口TSX和本页为本子任务独占文件，未改产品、契约或Git提交。合成端口旨在覆盖组件交互和迟到回执；不将其说成真实生产IPC、WebContentsView隔离、公网来源验证或游戏验收，也不恢复此前取消的补证。
