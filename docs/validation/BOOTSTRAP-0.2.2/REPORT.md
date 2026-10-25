# 0.2.2 同级环境与安静启动验收

日期：2026-10-25。直接批准原文见资料包DECISIONS末尾。范围仅为EXE同级Electron/内嵌应用环境及引导窗口体验，保留既有Java、账户和游戏目录行为，不扩展后续阶段。

对应实现提交afcbb6d；本报告、证据与交接单独提交。

## 交付与目标核对

- 交付`release/OUCL-0.2.2.exe`，234496字节（229KiB），SHA256 `2b1f141d0cbd7610f19117b91009ac2c76bc3b4809febfc538b3009386ef7454`。无需旁置配置文件，无ZIP交付，旧版本保留。
- EXE位置由`Assembly.GetExecutingAssembly().Location`确定，运行环境固定在其同级`OUCL.runtime`。不使用当前工作目录或LocalAppData作为新环境根；不搬动/删除0.2.1旧缓存和用户资料。
- 无环境：独立中文/空格目录只复制一个真实交付EXE，从仓库工作目录运行，官方固定Electron下载/校验/解压后，实际renderer URL在同级OUCL.runtime中。两次独立冷启动分别约27.4秒和26.2秒，见smoke-sibling-cold.json、smoke-download-ui.json。
- 有完整环境：复用第一次实测的EXE及同级目录再次启动，约1.57秒连接，运行环境目录清单前后完全相同；新增断言禁止热启动产生另一个Electron目录，见smoke-sibling-warm.json。未混用旧系统缓存；应用URL指向实测同级目录。
- 普通检查/启动：使用不显示Form的ApplicationContext，测试确认句柄已创建但Visible=false；生产只有下载/异常分支调用Show。完整缓存实际启动成功。下载时真实进度窗口曾由Computer Use列出并读取106MB/150MB及取消按钮；同布局的独立Preview在截图中检查，文字/间距/进度栏/按钮无裁切。Preview不编入产品。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| `pnpm check`，工作区TEMP、正常Windows权限 | typecheck/lint/test/build通过；262测试，260 PASS、0 FAIL、2原有软链接权限SKIP。check.log |
| `pnpm test:bootstrap` | 19 PASS，涵盖EXE相对环境路径/不同cwd、隐藏窗口初始化、归档路径安全、缓存摘要/额外文件拒绝、参数转义，以及已取消信号阻止写入/本次暂存安全清理。bootstrap-tests.log |
| `pnpm package:exe` | 真实系统编译器构建，229KiB，固定官方Electron摘要，见package.json/log |
| `node scripts/bootstrap-smoke.mjs sibling-cold`（OUCL_BOOTSTRAP_COPY=1） | 中文目录单EXE首次下载成功，24方法/10能力、renderer无Node、独立资料库创建及正常退出释放owner |
| `node scripts/bootstrap-smoke.mjs sibling-warm`（OUCL_EXE_TEST_PATH指向上述EXE） | 原同级环境复用，无新增运行环境，正常退出；增强的目录断言复测通过，脚本单独lint通过 |
| `pnpm audit --audit-level=high` | No known vulnerabilities found；audit.log |
| `pnpm audit:licenses`（本次证据目录） | 127包，reviewRequired=[]；未增加依赖，licenses.json/log |

## 中断与限制

手动取消下载验收在等待点击时下载已完成，脚本的“没有已发布环境”断言失败；随后Computer Use报告用户按实体Escape停止，未成功发出取消点击。该项不记为GUI取消通过，未继续操作用户窗口。后续仅以独立原生单测验证取消信号及暂存清理，不冒充下载中GUI点击实测。已删除必须依赖及时人工点击的临时验收脚本，保留本记录。

本轮不重新执行完整Minecraft世界/Java兼容矩阵，不把既有0.2.1证据改写为0.2.2全矩阵实测。只在首次下载/出错时显示引导窗口；不隐藏需要用户处理的网络或权限失败。同级目录需要可写，不请求管理员权限、不静默回退系统缓存。首次官方下载受网络可达性影响。

卸载运行环境：退出游戏及启动器后，删除EXE与同级OUCL.runtime即可。原账户设置仍在Roaming/OUCL，自选游戏根和其中的Java/存档不受影响。旧LocalAppData缓存保留，若不用旧版可手动清理。未push或发布GitHub Release。
