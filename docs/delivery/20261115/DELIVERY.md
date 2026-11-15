# OUCL 0.3.0 最终本地交付

最终文件：OUCL-0.3.0.exe，410112字节，SHA256 6d4f7f25d29a06b4d3730fd79ad64a160dbcdb28f747e20eda1ce05f98cc690e。使用现有bootstrap打包脚本去掉验收标签重新生成，内嵌appHash272cc737f3bade0a6b197f7907b21b2dce2acce854f1d4cc8347155fb3f62291，与v32相同；九应用条目/七产物交付完整性检查一致。

交付根D:/MC_start/OUCL-final-0.3.0，分EXE/项目源码/提交记录；源码是当前已提交维护文件的干净导出，保留src/tests/scripts/bootstrap等构建路径。排除node_modules、dist、临时测试根、历史运行环境/evidence、游戏和用户资料，保留固定样本及其许可。SOURCE-MANIFEST.json明确每个导出文件的来源提交和SHA；这不是把共享WIP移动或提交。

既有验证：691项687PASS/4既有SKIP、类型/lint/build通过，四次代表游戏菜单及自然exit0、正常重开/最终launcher exit0和租约释放通过。用户已取消剩余补证，历史未验项仍按原记录保存，不在本次重新启动GUI/完整测试。最终文件未签名，不是已发布版本；首次启动需联网准备校验过的Electron运行时，游戏和Java不内置。不push发布。
