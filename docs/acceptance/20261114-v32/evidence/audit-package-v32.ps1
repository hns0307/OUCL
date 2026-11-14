$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
$sourceRoot='D:/MC_start/OUCL-remediation-20261114-r1'
$exeFile=Join-Path $sourceRoot 'release/OUCL-0.3.0-acceptance-20261114-v32.exe'
$assembly=[Reflection.Assembly]::LoadFile($exeFile)
$manifestReader=[IO.StreamReader]::new($assembly.GetManifestResourceStream('app-manifest'))
$manifest=$manifestReader.ReadToEnd();$manifestReader.Dispose()
$archive=[IO.Compression.ZipArchive]::new($assembly.GetManifestResourceStream('application'),[IO.Compression.ZipArchiveMode]::Read)
$checks=@();$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach($entry in $archive.Entries){ if($entry.FullName.StartsWith('/') -or $entry.FullName.Contains('..') -or -not $seen.Add($entry.FullName)){throw 'INVALID_ARCHIVE_ENTRY'} }
foreach($line in $manifest.Trim().Split("`n")){
 $parts=$line.Trim().Split(' ',[StringSplitOptions]::RemoveEmptyEntries);$expected=$parts[0];$name=$parts[1]
 $entry=$archive.GetEntry($name);if($null -eq $entry){throw 'MISSING_ENTRY'}
 $stream=$entry.Open();$hasher=[Security.Cryptography.SHA256]::Create();$actual=[Convert]::ToHexString($hasher.ComputeHash($stream)).ToLowerInvariant();$stream.Dispose();$hasher.Dispose()
 if($actual -ne $expected){throw 'EMBEDDED_HASH_MISMATCH'}
 if($name.StartsWith('dist/')){ $built=(Get-FileHash -LiteralPath (Join-Path $sourceRoot $name) -Algorithm SHA256).Hash.ToLowerInvariant();if($built -ne $actual){throw 'DIST_MISMATCH'} }
 $checks+=@{path=$name;sha256=$actual;bytes=$entry.Length}
}
$archive.Dispose()
if(@($checks | Where-Object {$_.path.StartsWith('dist/')}).Count -ne 7){throw 'EXPECTED_SEVEN_OUTPUTS'}
$report=@{executableSha256=(Get-FileHash -LiteralPath $exeFile -Algorithm SHA256).Hash.ToLowerInvariant();executableBytes=(Get-Item -LiteralPath $exeFile).Length;embeddedEntries=$checks;verifiedProductOutputs=7;entryNamesUnique=$true;sourceCommit='0c2a889ccea544d3294136a80c74ac8a5e6f348f'}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $sourceRoot 'acceptance-results/package-audit-v32.json') -Encoding utf8
Write-Output ('Verified '+$checks.Count+' embedded entries, 7 dist outputs match; EXE '+$report.executableSha256)
