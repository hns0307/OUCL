# A1-04b 共享对象与来源证据基础

2026-10-24，沿用阶段1A持续实施与提交授权。新增services/objects/provenance.ts、store.ts、storage/object-index.ts和tests/objects.test.ts；存储worker私有协议接入独立SQLite对象搜索提示。无新第三方依赖或渲染IPC，不修改原tasks.sqlite格式。约定见[OBJECT_STORE](../../contracts/OBJECT_STORE.md)。

实际能力：受管暂存、worker流式双摘要核对、同卷提交与只读本体、相同内容去重、独立原子来源证明、SQLite搜索提示、证明/本体复核后查找、索引重建。错误摘要/同大小错误内容拒绝；损坏已有对象不覆盖；缺失证明不能凭本地摘要升级信任。对象提交和证明提交之间中断时保守保留孤立对象，不登记假来源、不执行GC。

新增7项服务测试及循环子场景：两次并行提交去重且保留两个来源；错误内容与输入拒绝；真实删除独立SQLite索引后重建且原任务/幂等记录保留；两个追加边界中断；损坏对象拒绝覆盖；证明损坏拒绝；未知索引版本停止搜索而任务仍可读。

`pnpm check`退出0，typecheck/lint/63测试/build全部通过，[check.log](check.log)只去除行尾空白。core覆盖率仍为行100%、分支98.85%、函数100%，不将其称为服务层覆盖率。

`pnpm test:workers-runtime`在Electron45.0.0/Node24.22.0运行正式worker入口，通过对象去重、来源分离、SQLite索引清空后重建、持久任务保留，同时继续通过64MiB摘要、取消/join和句柄释放。[electron-runtime.json](electron-runtime.json)为本次证据，旧A1-04c证据保持原样。使用测试字节和虚构锚标识，不冒充真实Mojang制品或来源API验证；来源链由后续元数据服务建立。

尚未接真实网络/安装器/玩家路径/UI，也没有跨进程owner接管、制品修复、软链接物化、自动GC或断电保证；A1-04整体和简易启动器目标未完成。下一步继续既定IPC/受控根目录及可信下载服务接入，保留阶段0未验证项。
