# Windows distribution file-handle admission spike

This is an isolated, unsuccessful admission experiment, not a production helper. One native run: executable 1 PASS / 3 FAIL. Two rename cases stopped before the rename syscall because the earlier guard test moved the target directory. See `observed-result.json` and `docs/execution/20261116/FILE-GUARD-SPIKE.md`.

Compile with the already installed .NET Framework x64 compiler, copying the source to an ASCII-only temporary path first (the initial relative-path compiler invocation did not resolve the source):

```powershell
$spikeRoot='D:/MC_start/OUCL/tmp/distribution-file-guard-20261116'
Copy-Item -LiteralPath 'spikes/distribution-file-guard/Program.cs' -Destination "$spikeRoot/Program.cs"
Set-Location $spikeRoot
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /platform:x64 /r:System.Web.Extensions.dll /out:file-guard-spike.exe Program.cs
# Each explicit run allocates a new test-only fixture; no recursive cleanup occurs in the executable.
& "$spikeRoot/file-guard-spike.exe" "$spikeRoot/fixtures"
```

The source opens ordinary source files with `GENERIC_READ | DELETE`, sharing only read; hashes and identifies the same handle; uses `SetFileInformationByHandle` classes 3 and 4. Immediate parent directory handles currently request only `FILE_READ_ATTRIBUTES`, permit read/write sharing, and deny delete sharing. The target-parent guard was experimentally insufficient. No all-ancestor protection or production safety is claimed.
