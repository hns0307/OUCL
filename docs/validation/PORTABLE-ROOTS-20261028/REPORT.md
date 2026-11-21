# 便携目录服务修复

2026-10-28（Asia/Shanghai）。用户要求优先修复“目录服务不可用”，并自动在EXE同级建立游戏目录。

## 事实与改动

只读检查发现旧全局用户资料的metadata存在owner.lock。RecordStore遇到该标记会返回STORE_BUSY，存储初始化失败使roots能力不可用；未删除、替换或强制接管用户标记，也不声称完成旧profile恢复。

便携引导现在默认传入EXE同级`OUCL.runtime/profile`，从而隔离旧全局profile与其他便携副本。显式测试profile参数仍按原样保留，缺值参数拒绝。新profile首次运行时自动创建并登记同级`OUCL.games`；同profile已有登记继续优先。旧profile和旧游戏文件保留，新profile不自动导入旧游戏清单。

默认游戏目录创建失败不再终止其余服务初始化；便携模式的根目录入口重试固定默认目录，不弹原生选择器。安装目录已有同名文件时报告受控失败，保留文件内容。打包同时补齐smol-toml BSD-3-Clause声明。

## 实际验证

- 完整`pnpm check`成功，类型、lint、单元测试、覆盖率与production build通过；新增1项目录阻塞后重试回归。最初受限环境导致既有SQLite提交和目录链接测试失败，正常权限重跑成功。
- `pnpm test:bootstrap`：26项通过，包含默认profile、中文空格路径、原参数顺序、显式profile及缺值参数检查。
- `pnpm smoke:portable`：真实启动修复EXE三次，刻意不传user-data-dir；本地预置固定Electron，未测试公网下载。首次自动建立OUCL.games和独立profile；第二次rootId及revision=1保持；第三次模拟同名阻塞文件，其他能力可用，文件原样保留，排除测试阻塞后重试成功。三个场景均正常释放本人owner标记，renderer无Node。见`smoke.json`。
- `pnpm audit:licenses`：128个包，无待审许可；见`licenses.json`。未执行联网漏洞审计。
- 最后脚本lint及`git diff --check`成功。未启动Minecraft，未修改用户游戏数据。

修复版`release/OUCL-0.3.0-directory-fix.exe`：328704字节，SHA256 `dcbe8f777685efdd456ddc914a9f4a04856639f18801e92c8511afd063167bee`；旧0.3.0交付物保留。构建清单见`../BOOTSTRAP-0.3.0-directory-fix/package.json`。Strata只提供一次局部参数处理建议，输出经审查未直接采用；返回`service_stopped=true`。

Mod计划持久化、玩家确认、依赖实际下载和一次安装事务尚待实现，四加载器未观察的真实运行矩阵仍不补写通过。
