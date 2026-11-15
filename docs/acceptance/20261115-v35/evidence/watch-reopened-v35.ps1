$ErrorActionPreference='Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ExitObservationV35 { [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr handle, out uint exitCode); }'
$observed=[Diagnostics.Process]::GetProcessById(8676)
$image=$observed.MainModule.FileName
if ($image -ne 'D:\MC_start\OUCL-acceptance-exe-v32-20261114\OUCL.runtime\electron-ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47\electron.exe'){throw 'UNEXPECTED_OWNED_IMAGE'}
$heldHandle=$observed.Handle
Write-Output 'Exact owned launcher handle pinned for read-only exit observation'
$observed.WaitForExit()
[uint32]$nativeCode=0
$nativeSuccess=[ExitObservationV35]::GetExitCodeProcess($heldHandle,[ref]$nativeCode)
$reportedCode=if($nativeSuccess -and $nativeCode -ne 259){[long]$nativeCode}else{$null}
@{pid=8676;image=$image;observedUtc=[DateTime]::UtcNow.ToString('o');nativeQuerySucceeded=$nativeSuccess;exitCode=$reportedCode} | ConvertTo-Json | Set-Content -LiteralPath D:/MC_start/OUCL-acceptance-v33-20261114/game-run/launcher-reopened-exit-v35.json -Encoding utf8
$observed.Dispose()
Write-Output "launcher-exit=$reportedCode"
