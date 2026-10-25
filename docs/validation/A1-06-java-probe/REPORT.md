# A1-06已有Java探测基础

JavaProbe仅探测明确选择或此前可信的绝对java.exe路径，不扫描执行任意文件，不下载/注册Java，不选定新发行商。路径须常规非空文件、父链无链接。固定argv `-XshowSettings:properties -version`，shell=false、隐藏窗口、受控cwd，移除Java options/CLASSPATH环境注入。

严格属性解析Java8/17/21版本与spec一致、Windows、amd64/x86_64、64位；banner单独含64-Bit不算证据。默认8秒/最多30秒和64KiB输出预算，超时/取消/超量kill后等待close才结束；失败不返回路径、环境或JVM输出。此能力执行已选择的本地可执行文件，不能证明任意文件的供应商身份或完整性。

10项注入进程/文件检查测试覆盖版本/位数、重复/错误属性、参数与环境、路径拒绝、退出失败、输出预算、超时、取消等待close和实际输出脱敏。完整工作区185测试183 PASS/2既有SKIP及类型/lint/build通过，完整输出在[文件投影check.log](../A1-08-file-views/check.log)。

真实验证`node scripts/verify-java.mjs <此前可信绝对java.exe路径>`通过本机Oracle17.0.12、Windows x64，见[local-java.json](local-java.json)。未把本地绝对路径写入报告，没有安装/改变系统Java；并未运行游戏，不宣称其他Java8/21或MC兼容验收通过。发现/选择UI、持久登记、受管下载与供应商核验、launch绑定仍待实现。
