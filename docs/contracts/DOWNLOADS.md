# 下载源与有界并行增量

2026-10-26用户明确要求优先实施；此前四加载器/Mod保持原授权并暂缓。

第一增量：下载偏好formatVersion1包含source=official/bmclapi、fileConcurrency1..8、connectionsPerFile1..8，默认官方/4/4。存入既有版本化launch-settings中的可选downloads字段；旧数据无需破坏性迁移，首次保存原子写入新字段，未知格式/字段拒绝。memory/isolation与downloads共用修订CAS，相互保存必须保留其他字段；旧settings.v1输出显式投影，不额外暴露新字段。

新增settings:downloadsGet/Update受控v1入口，复用既有profiles严格sender/schema/错误/超时机制；不能接受任意镜像URL/路径。偏好持久化与契约已完成，传输策略/设置UI尚未接入，downloads.v1暂不广告。385项完整检查383通过/0失败/2原有跳过，类型/lint/build通过；真实worker验证legacy保留、CAS、重开，未知版本/并发边界与额外字段拒绝。

传输设计（待实施验证）：官方元数据/摘要为信任根；BMCLAPI仅加速已知摘要文件，来源在设置/下载界面署名。官方支持Range且强ETag的大文件有界分段，小文件多文件并发；BMCLAPI单文件不分段，遵循PCL设计。全局连接/文件上限，取消和失败等待连接退出；只持久记录fsync连续前缀，非连续尾部在恢复时截断，不能把文件长度当已完成。跨源清除验证器/前缀，镜像故障受控回退官方；每份最终对象仍完整摘要校验后发布。

参考只读：同目录PCL Modules/Base/ModNet.vb的IsNoSplit、TryBeginThread、Range检查和SourceFail；仅借鉴小文件/分段/并发上限/失败回退设计，未复制代码、夹具或素材。PCL对bmclapi等端点不做文件分段，OUCL沿用此取舍。

镜像路由依据：[BMCLAPI官方文档](https://bmclapidoc.bangbang93.com/)的assets/maven映射、可见来源要求和归属说明。2026-10-26实测BMCLAPI guava31.1-jre路由为302→mirrors.cernet.edu.cn→mirrors.qlu.edu.cn→200；仅HTTPS且固定受控主机集合，未知节点回退官方，禁止任意跳转。不要加入已关闭或未验证的镜像。

旧Fabric/Quilt本轮重试均metadata/CATALOG_UNAVAILABLE，三个官方端点独立探测200；尚未定位，不因下载优化提案而标为安装通过。

传输增量main：SourceTransfer固定路由、官方ParallelHttpTransfer、共享RequestBudget已接InstallerService（含Java/资源使用的同一协调器），无加载器实现迁入。分段4MiB、剩余至少8MiB且精确Range/强ETag；最多16总连接/8同主机，镜像单流、未知跳转回退官方。账本transportSource可选字段向后兼容，切源仅允许无验证器零前缀；错误镜像摘要在对象发布前清零并官方重试一次。取消/失败join所有分段；只fsync连续完整片后checkpoint。传输进度仍与已校验进度分离，公开任务目前继续只展示已校验字节。

完整pnpm check274项272通过/0失败/2原有跳过，含真实本地HTTP乱序分段、取消+稀疏尾恢复、实体改变回退、idle超时、镜像hash失败官方重试及持久切源拒绝。日志.test-build/download-transport-check-final.log；真实公网/设置UI/新EXE验证尚待，不将本地fixture视为公网通过。
