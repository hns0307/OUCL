# 档案选择界面验证

`pnpm check`退出0，242测试240 PASS/0 FAIL/2原有环境SKIP，typecheck/lint/build通过，见[profile-check.log](profile-check.log)。新增4组公开契约/handler/适配器测试，验证未知字段/渠道/路径拒绝、sender校验先于副作用、输出私有字段拒绝、测量Java投影/取消、账号创建及设置/能力白名单。另增加ProfileService关闭等待在途探测/提交且拒绝新写入的回归。

`pnpm smoke`退出0，正式Electron45实际main/preload/React界面握手七能力、白名单14方法；实际DOM填写并创建OUCL_Smoke离线账户，返回摘要无游戏UUID，官方目录100项和选择确认/未登记根禁安装通过。Node隔离、sandbox、拒绝外链弹窗继续通过，见[smoke.json](smoke.json)。[window.png](window.png)与[catalog.png](catalog.png)已目视核对，布局未出现先前卡片挤压问题。

Java原生选择器只验证入口及后端的可控回调/探测投影，未自动操作真实native picker（javaChooserOperated=false），不能宣称此项已实机完成。该窗口使用临时应用档案，不是新exe；实例启动按钮、launch/stop任务与session UI、真正退出保活及exe验收下一增量继续。
