# 项目目录与入口

| 目录 | 责任 |
| --- | --- |
| src/core | 无IO核心逻辑 |
| src/services | 文件、网络、下载、Java、游戏进程与后台服务 |
| src/main、src/ipc | Electron装配、安全边界和IPC桥接 |
| src/ui、src/shared | React界面、共享契约及文案 |
| tests | 单元、集成与独立组件夹具 |
| scripts、bootstrap | 开发构建命令与Windows EXE引导器 |
| docs/contracts | 当前工程契约 |
| docs/acceptance | 按v1–v36保留的历史验收证据，不移动或改写 |
| docs/delivery/20261115 | 最终交付、所有提交索引与分支关系 |
| OUCL-Codex/docs、prompts | 原始需求、计划、真实批准及协作资料，路径保持 |
| spikes | 独立研究实验 |
| node_modules、dist、.test-build | 本机依赖和生成物，非维护源码 |
| release | 本机产物，Git忽略 |

实际清爽交付另在D:/MC_start/OUCL-final-0.3.0：EXE只放成品与使用说明，项目源码只放维护文件，提交记录存全历史CSV/分支关系/说明；不保留生成物与私人游戏资料。源码的必要路径保持以避免打断构建、测试与文档引用；活跃共享工作树不搬迁不清理。
