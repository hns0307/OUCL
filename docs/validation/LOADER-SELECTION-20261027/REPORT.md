# 四加载器版本选择与离线界面

2026-10-27，mod_loaders，遵用户“跳过联网测试，优先模组加载器”。共享目标信息/稳定默认、MC边界、目录响应隔离和表单接受上下文保护接通；不新增依赖、公共IPC或存储格式。

pnpm check440项438 PASS/0 FAIL/2原有跳过，typecheck/lint/build通过，check.log；最终测试脚本窗口修订后再次lint通过。3项纯逻辑测试覆盖四目标/冻结、不冒充verified、代表默认/MC限定、缺失/不稳定目标及无稳定项。

node scripts/loader-local-smoke.mjs运行正式main/preload/renderer；fetch只返回本地固定元数据，renderer外部HTTP/HTTPS阻断，从未调用原fetch，外网0。四种加载器默认版本/对应Java、主进程/界面不支持MC、旧响应/旧目录隔离、无root禁安装、小窗口与正常退出owner释放通过。smoke.json、loader-selection.png归档且截图已实际查看；这只是夹具UI/IPC验证，不是官方联网或游戏启动验收。

首轮隐藏窗口测试超时并报UnknownVizError，失败材料hidden-fixture-failure.log保留；改独立正常渲染窗口/关闭后台节流后通过。未操作用户游戏窗口，也未降低生产窗口安全设置。修正一处共享信息直接引core被lint拒绝的问题，移到shared/contracts后通过；生产层边界保持。

原联网/游戏未验证项继续，完整0.3.0和Mod确认事务未完成，不push，原始暂存资料保留。
