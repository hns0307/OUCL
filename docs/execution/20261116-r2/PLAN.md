# r2 当前增量

起点ceed2dc1。沿用户持续执行授权继续；无新第三方依赖、不push、不覆盖旧正式EXE或WIP。

1. 候选初始化：调试夹具必须恢复Node Worker，记录真实ready/退出与owner释放，旧失败保留。
2. 文件原语：只在已测本机Windows本地卷、逐级祖先无reparse且拒共享删除的guard、源同handle proof下操作；rename/link不覆盖目标、delete同handle；Node与native身份必须匹配。
3. 新native helper使用固定自身源码/构建摘要，stdin严格单请求，无shell/任意脚本；只有主进程内部factory可访问。journal升级v2绑定gameDir dev/ino，恢复不接管同路径新目录。helper准入和原生wrapper回归齐备前不开放公共执行。
4. 生命周期：active与轻量tombstone分离，有界seen身份不得驱逐重执行；失败、TTL、容量、close、完成幂等有明确结果。

验证顺序为各独占局部测试、独立review、类型/全lint/完整回归、独占build/候选打包与运行。只报告真实层级；未行使符号链接格不记PASS。
