# 下载源与有界并行增量

2026-10-26用户明确要求优先实施；此前四加载器/Mod保持原授权并暂缓。

第一增量：下载偏好formatVersion1包含source=official/bmclapi、fileConcurrency1..8、connectionsPerFile1..8，默认官方/4/4。存入既有版本化launch-settings中的可选downloads字段；旧数据无需破坏性迁移，首次保存原子写入新字段，未知格式/字段拒绝。memory/isolation与downloads共用修订CAS，相互保存必须保留其他字段；旧settings.v1输出显式投影，不额外暴露新字段。

新增settings:downloadsGet/Update受控v1入口，复用既有profiles严格sender/schema/错误/超时机制；不能接受任意镜像URL/路径。偏好持久化与契约已完成，传输策略/设置UI尚未接入，downloads.v1暂不广告。385项完整检查383通过/0失败/2原有跳过，类型/lint/build通过；真实worker验证legacy保留、CAS、重开，未知版本/并发边界与额外字段拒绝。

传输设计（待实施验证）：官方元数据/摘要为信任根；BMCLAPI仅加速已知摘要文件，来源在设置/下载界面署名。官方支持Range且强ETag的大文件有界分段，小文件多文件并发；BMCLAPI单文件不分段，遵循PCL设计。全局连接/文件上限，取消和失败等待连接退出；只持久记录fsync连续前缀，非连续尾部在恢复时截断，不能把文件长度当已完成。跨源清除验证器/前缀，镜像故障受控回退官方；每份最终对象仍完整摘要校验后发布。

参考只读：同目录PCL Modules/Base/ModNet.vb的IsNoSplit、TryBeginThread、Range检查和SourceFail；仅借鉴小文件/分段/并发上限/失败回退设计，未复制代码、夹具或素材。PCL对bmclapi等端点不做文件分段，OUCL沿用此取舍。

镜像路由依据：[BMCLAPI官方文档](https://bmclapidoc.bangbang93.com/)的assets/maven映射、可见来源要求和归属说明。2026-10-26实测BMCLAPI guava31.1-jre路由为302→mirrors.cernet.edu.cn→mirrors.qlu.edu.cn→200；仅HTTPS且固定受控主机集合，未知节点回退官方，禁止任意跳转。不要加入已关闭或未验证的镜像。

旧Fabric/Quilt本轮重试均metadata/CATALOG_UNAVAILABLE，三个官方端点独立探测200；尚未定位，不因下载优化提案而标为安装通过。

main:d2521bb限定实现已同步本分支：实际运行时/设置UI/有界源传输可用，397项395通过/0失败/2原有跳过、真实Electron32方法14能力与下载设置独立重开通过。以docs/validation/DOWNLOADS-mod/REPORT.md为本分支证据；main的公网官方ETag/If-Range条件缺项保持安全单流回退，不宣称公网分段性能通过。安装器保留全部加载器/Mod装配，无新包。原WIP按SHA256保留，原始两份暂存排除。
