$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$sourceDirectory = [IO.Path]::GetFullPath($env:OUCL_APP_SOURCE)
$archiveFile = [IO.File]::Open($env:OUCL_APP_ZIP, [IO.FileMode]::CreateNew)
$archive = New-Object IO.Compression.ZipArchive($archiveFile, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceDirectory -Recurse -File) {
        $entryName = $sourceFile.FullName.Substring($sourceDirectory.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $sourceFile.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $archive.Dispose()
    $archiveFile.Dispose()
}
