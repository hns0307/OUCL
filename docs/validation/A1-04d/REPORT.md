# A1-04d 目录契约与正式设置入口

2026-10-24，沿用已批准阶段1A持续实施与提交。实现已批roots:list/roots:choose、roots.v1能力、受控登记与UI按钮，详见[ROOTS](../../contracts/ROOTS.md)。新增shared/contracts/roots、services/roots、storage/installation、ipc/roots与RootSettings；更新worker固定记录桥、main/preload/消息和样式。无新依赖；现有RecordStore envelope及任务库格式不变。

新增7项测试：严格请求与sender门禁先于IO；响应字段/标签/错误/能力校验；取消不登记；选择回调登记及存储worker重启；应用目录/上级/junction拒绝；并发共享一次选择且revision=1；离线目录保留并显示不可用。首次最后一项失败是测试用rm删除空目录而未传递归参数，已改为rmdir，仅移除本测试的空目录。

`pnpm check`退出0，typecheck/lint/70项测试/build通过。[check.log](check.log)仅去除行尾空白。core行100%、分支98.85%、函数100%只针对core，不代表整个IPC/UI覆盖率。

`pnpm smoke`启动正式dist/main应用、真实后台存储worker及sandbox渲染窗口，验证三个preload方法、roots.v1协商、空roots:list、选择按钮、Node API不可见、弹窗拒绝及正常退出。Electron45/Node24.22，contextIsolation=true、sandbox=true、nodeIntegration=false，见[smoke.json](smoke.json)。[窗口截图](window.png)已人工目视检查，按钮/文案完整，无裁切或错误状态。临时profile于进程退出后清理，没有改用户正式目录/系统权限。

nativePickerSelected=false：本次未自动操作系统原生文件夹对话框。实际持久化/重启场景是服务层真实文件与worker、选择回调注入，不能称为原生对话框完整E2E；后续实机演示还需真实选择。默认入口已使用真实dialog.showOpenDialog，未在生产入口加入测试后门或环境变量指定目录。

旧release目录仍是之前空骨架，未重新打包，不以本次源码窗口验证冒充新包验证。尚未完成其余任务/实例/Java/下载/进程契约、订阅、owner恢复接管、解压与实际游戏启动；A1-04父任务和完整简易启动器目标仍进行中。下一步推进可信目录/下载与相应服务入口，保留阶段0缺项。
