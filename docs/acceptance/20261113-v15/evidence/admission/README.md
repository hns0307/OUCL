# C-R2真实接纳回执丢失重试准备

状态：PREPARED，未启动GUI、未执行核验器，不预判真实场景通过。2026-11-13开始额度五小时已用10%、剩90%；核对TASK_PLAN/DECISIONS后沿C只读批准及本次场景授权准备，无R3–R7扩展。

启动只由主协调执行，先确认原v4-bc profile窗口已关闭：

```powershell
& 'D:\MC_start\OUCL-acceptance-v3-20261112\node_modules\electron\dist\electron.exe' 'D:\MC_start\OUCL-acceptance-v3-20261112\acceptance-results\c-admission-v14\window.cjs'
```

选A `BC-A Synthetic Fabric`，定位alpha-provider.jar，点一次“预览禁用影响”。原handler正常接纳、后台可自然完成；仅该首次真实成功接纳响应被hold8000ms。原preload3秒超时后，DOM应显示等待超时、新预览按钮恢复可用（此时没有previewId，故不是“重新查询预览”路径）。主协调再次点**同文件**预览，预期同requestId/同input/同previewId返回并显示completed/blocked。不要切实例、换报告/文件或点一键检查，这会改变本场景前提。不要第三次预览。

等首次held回执按正常8秒计时释放、同观察completed已显示后正常关闭。harness不自动点击、查询或新接纳；只记录真正GUI触发的公开handler和只读DOM。仅首份成功接纳回执延迟，状态/取消等结果全部原样返回，领域/时钟/preload/UI不替换，外网拒绝。七产物启动逐SHA核对，记录verified-product.json；原profile不做准备/重置。

身份计数选择最透明方式：记录原handler每次成功返回的previewId集合和是否复用首request/input/id；两次成功接纳若唯一ID=1，结合正式MaintenancePreviewJobs.start先查requests、prior分支直接返回而不queue新job的固定代码，可证明复用同一公开观察。**不是直接测量inspection.check调用次数**，不将2次handler调用冒称2次扫描或将1个ID伪装为计量扫描次数。没有patch UUID或domain类，也不修改任何返回。

handled=原handler已完成；held=响应等待；delivered=原响应释放给invoke，并非preload/UI确认收到。窗口closed/before-quit清timer并resolve同一原结果，不取消业务、不挂住退出。提前退出释放标明原因，不能算足额8秒通过。

验收后可由主协调运行只读核验器：

```powershell
node D:/MC_start/OUCL-acceptance-v3-20261112/acceptance-results/c-admission-v14/verify-result.cjs
```

stdout JSON为PASS/PENDING/FAIL，exit0/2/1；不写文件、不调用GUI/IPC。核对真实TIMEOUT DOM、原身份重试、唯一观察ID、同ID completed及DOM、迟到首回执原样释放和正常退出。证据不足PENDING；脚本只做语法检查不算场景PASS。若主协调需要保存stdout，可在本独占目录另重定向，核验器本身保持只读。

window.jsonl已存在时壳拒绝覆盖，保留原试验；不要删旧证据绕过保护。当前只新增这三个文件，未改产品、旧v11脚本、E资料、原profile或其它源码。
