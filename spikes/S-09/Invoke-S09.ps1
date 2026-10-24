#Requires -Version 7.4
<#
.SYNOPSIS
Runs the authorized S-09 disposable filesystem experiment, never production data.
.DESCRIPTION
Only registered entries in newly created UUID roots are deleted, without recursion.
CrossVolumeParent must be an existing, authorized local directory on another drive.
#>
[CmdletBinding()]
param([string]$CrossVolumeParent)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$results = [Collections.Generic.List[object]]::new()
$roots = [Collections.Generic.List[string]]::new()
$entries = [Collections.Generic.List[string]]::new()
$managedLinks = @{}
$capabilities = [Collections.Generic.List[object]]::new()

# Validates lexical scope and every existing ancestor; this is not race-safe IO.
function Assert-FixturePath([string]$Path, [switch]$AllowRoot) {
    $full = [IO.Path]::GetFullPath($Path)
    $owner = $null
    foreach ($root in $roots) {
        if ($full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            ($AllowRoot -and $full.Equals($root, [StringComparison]::OrdinalIgnoreCase))) { $owner = $root; break }
    }
    if (-not $owner) { throw 'OUTSIDE_FIXTURE' }
    $parent = [IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($full))
    while ($null -ne $parent) {
        if ($parent.Exists -and ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'REPARSE_PARENT' }
        $parent = $parent.Parent
    }
    return $full
}

# Rejects existing symlink/junction ancestors before creating a unique fixture.
function New-FixtureRoot([string]$Parent) {
    $full = [IO.Path]::GetFullPath($Parent)
    if ($full.StartsWith('\\') -or -not [IO.Directory]::Exists($full)) { throw 'LOCAL_PARENT_REQUIRED' }
    $cursor = [IO.DirectoryInfo]::new($full)
    while ($null -ne $cursor) {
        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_PARENT' }
        $cursor = $cursor.Parent
    }
    $path = Join-Path $full ('oucl-s09-' + [guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $path) { throw 'FIXTURE_COLLISION' }
    [void][IO.Directory]::CreateDirectory($path)
    $roots.Add($path)
    $entries.Add($path)
    return $path
}

# Creates only a direct child of an existing fixture directory.
function New-TestDirectory([string]$Path) {
    $safe = Assert-FixturePath $Path
    [void][IO.Directory]::CreateDirectory($safe)
    $entries.Add($safe)
    return $safe
}

function Write-TestFile([string]$Path, [string]$Text) {
    $safe = Assert-FixturePath $Path
    if (Test-Path -LiteralPath $safe) { throw 'ENTRY_EXISTS' }
    [IO.File]::WriteAllText($safe, $Text, [Text.UTF8Encoding]::new($false))
    $entries.Add($safe)
    return $safe
}

function Get-Digest([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

# Captures assertion outcomes; messages are fixed labels, not arbitrary local paths.
function Invoke-Case([string]$Group, [string]$Id, [scriptblock]$Action, [bool]$Skip = $false) {
    if ($Skip) { $results.Add([pscustomobject]@{ group=$Group; id=$Id; status='SKIP'; detail='Required real link capability unavailable' }); return }
    try {
        & $Action
        $results.Add([pscustomobject]@{ group=$Group; id=$Id; status='PASS'; detail='Assertions satisfied' })
    } catch {
        $results.Add([pscustomobject]@{ group=$Group; id=$Id; status='FAIL'; detail=$_.Exception.GetType().FullName; assertion=$_.FullyQualifiedErrorId.Split(',')[0] })
    }
}

# Fixture-only materialization; injected denial is separately labeled in C08.
function New-TestEntry([string]$Path, [string]$Target, [switch]$DenyLink) {
    $safe = Assert-FixturePath $Path
    $source = Assert-FixturePath $Target
    if (Test-Path -LiteralPath $safe) { throw 'ENTRY_EXISTS' }
    try {
        if ($DenyLink) { throw [UnauthorizedAccessException]::new('INJECTED_DENIAL') }
        [void][IO.File]::CreateSymbolicLink($safe, $source)
        $entries.Add($safe)
        $managedLinks[$safe] = $source
        return [pscustomobject]@{ mode='SymbolicLink'; reason='Created' }
    } catch {
        $cause = $_.Exception.GetBaseException()
        $nativeCode = $cause.HResult -band 0xFFFF
        if ($cause -isnot [UnauthorizedAccessException] -and $nativeCode -notin @(5, 1314)) { throw }
        [IO.File]::Copy($source, $safe, $false)
        $entries.Add($safe)
        return [pscustomobject]@{ mode='Copy'; reason=$(if ($DenyLink) { 'InjectedPermissionDenied' } else { 'ActualPermissionDenied' }) }
    }
}

# Deletes a single registered link/file, never its target or a directory tree.
function Remove-ManagedEntry([string]$Path) {
    $safe = Assert-FixturePath $Path
    $info = Get-Item -LiteralPath $safe -Force
    if ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if (-not $managedLinks.ContainsKey($safe) -or $info.Target -ne $managedLinks[$safe]) { throw 'UNKNOWN_LINK' }
        if ($info -is [IO.DirectoryInfo]) { [IO.Directory]::Delete($safe, $false) } else { [IO.File]::Delete($safe) }
    } else {
        if ($info -is [IO.DirectoryInfo]) { throw 'DIRECTORY_NOT_LEAF' }
        [IO.File]::Delete($safe)
    }
}

# Attempts real symlinks; an unavailable capability is not a passed link test.
function Test-FileLinkCapability([string]$Path, [string]$Target) {
    try {
        [void](Assert-FixturePath $Path)
        [void][IO.File]::CreateSymbolicLink($Path, $Target)
        $entries.Add($Path)
        $managedLinks[$Path] = $Target
        return $true
    } catch {
        $cause = $_.Exception.GetBaseException()
        $capabilities.Add([pscustomobject]@{ kind='FileSymbolicLinkFailure'; exception=$cause.GetType().FullName; code=$cause.HResult })
        return $false
    }
}

# Runs the same assertions with same-drive or cross-drive immutable objects.
function Invoke-Fixture([string]$Group, [string]$PrimaryRoot, [string]$ObjectRoot) {
    $base = New-TestDirectory (Join-Path $PrimaryRoot $Group)
    $store = New-TestDirectory (Join-Path $ObjectRoot ($Group + '-objects'))
    $text1 = 'fake immutable jar version 1'
    $text2 = 'fake immutable jar version 2'
    $hash1 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($text1)))
    $hash2 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($text2)))
    $object1 = Write-TestFile (Join-Path $store $hash1) $text1
    $object2 = Write-TestFile (Join-Path $store $hash2) $text2
    $a = New-TestDirectory (Join-Path $base '实例 A')
    $b = New-TestDirectory (Join-Path $base '实例 B')
    $linkA = Join-Path $a 'same.jar'
    $linkB = Join-Path $b 'different-name.jar'
    Invoke-Case $Group 'C01' {
        Assert-True ((Get-Digest $object1) -eq $hash1 -and (Get-Digest $object2) -eq $hash2 -and $hash1 -ne $hash2) 'OBJECT_IDENTITY'
        Assert-True (@(Get-ChildItem -LiteralPath $store -File).Count -eq 2) 'OBJECT_COUNT'
    }
    $canLink = Test-FileLinkCapability (Join-Path $base 'probe.jar') $object1
    $capabilities.Add([pscustomobject]@{ group=$Group; fileSymbolicLink=$canLink })
    Invoke-Case $Group 'C02' { Assert-True $canLink 'REAL_LINK_REQUIRED' } (-not $canLink)
    Invoke-Case $Group 'C03' {
        $modeA = New-TestEntry $linkA $object1
        $modeB = New-TestEntry $linkB $object1
        Assert-True ($modeA.mode -eq 'SymbolicLink' -and $modeB.mode -eq 'SymbolicLink') 'REAL_LINK_REQUIRED'
        Assert-True (([IO.FileInfo]::new($linkA).ResolveLinkTarget($true).FullName) -eq $object1) 'A_TARGET'
        Assert-True (([IO.FileInfo]::new($linkB).ResolveLinkTarget($true).FullName) -eq $object1) 'B_TARGET'
        Assert-True ((Get-Digest $linkA) -eq $hash1 -and (Get-Digest $linkB) -eq $hash1) 'SHARED_CONTENT'
    } (-not $canLink)
    Invoke-Case $Group 'C04' {
        Remove-ManagedEntry $linkA
        [void](New-TestEntry $linkA $object2)
        Assert-True ((Get-Digest $linkA) -eq $hash2 -and (Get-Digest $linkB) -eq $hash1 -and (Get-Digest $object1) -eq $hash1) 'UPDATE_ISOLATION'
    } (-not $canLink)
    $disabled = Join-Path $a 'same.jar.disabled'
    Invoke-Case $Group 'C05' {
        [IO.File]::Move($linkA, $disabled)
        $entries.Add($disabled)
        $managedLinks[$disabled] = $object2
        Assert-True (-not [IO.File]::Exists($linkA) -and (Get-Digest $disabled) -eq $hash2 -and (Get-Digest $linkB) -eq $hash1) 'DISABLE_ISOLATION'
    } (-not $canLink)
    Invoke-Case $Group 'C06' {
        $private = Join-Path $a 'private.tmp'
        [IO.File]::Copy($disabled, $private, $false)
        $entries.Add($private)
        Assert-True ((Get-Digest $private) -eq $hash2) 'PRIVATE_COPY_HASH'
        Remove-ManagedEntry $disabled
        [IO.File]::Move($private, $disabled)
        [IO.File]::WriteAllText($disabled, 'private player edit')
        Assert-True (-not ((Get-Item -LiteralPath $disabled).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'PRIVATE_NOT_LINK'
        Assert-True ((Get-Digest $object2) -eq $hash2 -and (Get-Digest $linkB) -eq $hash1) 'PRIVATE_ISOLATION'
    } (-not $canLink)
    Invoke-Case $Group 'C07' {
        $extra = Join-Path $a 'delete-me.jar'
        [void](New-TestEntry $extra $object1)
        Remove-ManagedEntry $extra
        Remove-ManagedEntry $disabled
        [IO.Directory]::Delete((Assert-FixturePath $a), $false)
        Assert-True (-not [IO.Directory]::Exists($a) -and (Get-Digest $linkB) -eq $hash1 -and (Get-Digest $object1) -eq $hash1 -and (Get-Digest $object2) -eq $hash2) 'DELETE_ISOLATION'
    } (-not $canLink)
    Invoke-Case $Group 'C08' {
        $copy = Join-Path $b 'fallback.jar'
        $mode = New-TestEntry $copy $object1 -DenyLink
        Assert-True ($mode.mode -eq 'Copy' -and $mode.reason -eq 'InjectedPermissionDenied' -and (Get-Digest $copy) -eq $hash1) 'FALLBACK_LABEL'
        [IO.File]::WriteAllText($copy, 'independent copy edit')
        Assert-True ((Get-Digest $object1) -eq $hash1) 'COPY_ISOLATION'
    }
    $view = New-TestDirectory (Join-Path $store 'view')
    $sentinel = Write-TestFile (Join-Path $view 'sentinel.txt') 'keep shared target'
    $junction = Join-Path $base 'unknown-directory'
    $canJunction = $false
    try {
        [void](New-Item -ItemType Junction -Path $junction -Target $view)
        $entries.Add($junction)
        $canJunction = $true
    } catch { $capabilities.Add([pscustomobject]@{ group=$Group; kind='JunctionFailure'; exception=$_.Exception.GetBaseException().GetType().FullName; code=$_.Exception.GetBaseException().HResult }) }
    $capabilities.Add([pscustomobject]@{ group=$Group; directoryJunction=$canJunction })
    Invoke-Case $Group 'C09' {
        $writeRejected = $false
        try { [void](Assert-FixturePath (Join-Path $junction 'escape.txt')) } catch { if ($_.Exception.Message -eq 'REPARSE_PARENT') { $writeRejected = $true } else { throw } }
        $deleteRejected = $false
        try { Remove-ManagedEntry $junction } catch { if ($_.Exception.Message -eq 'UNKNOWN_LINK') { $deleteRejected = $true } else { throw } }
        Assert-True ($writeRejected -and $deleteRejected -and [IO.File]::ReadAllText($sentinel) -eq 'keep shared target' -and -not [IO.File]::Exists((Join-Path $view 'escape.txt'))) 'UNKNOWN_LINK_REJECTED'
    } (-not $canJunction)
    Invoke-Case $Group 'C10' {
        $temporaryTarget = Write-TestFile (Join-Path $store 'temporary-target') 'temporary'
        $broken = Join-Path $b 'broken.jar'
        [void](New-TestEntry $broken $temporaryTarget)
        [IO.File]::Delete((Assert-FixturePath $temporaryTarget))
        Assert-True (-not [IO.File]::Exists($broken) -and ((Get-Item -LiteralPath $broken -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'BROKEN_LINK_DETECTED'
        Remove-ManagedEntry $broken
        Assert-True ((Get-Digest $object1) -eq $hash1) 'BROKEN_LINK_DELETE_SAFE'
    } (-not $canLink)
    Invoke-Case $Group 'C11' {
        Assert-True ([IO.File]::ReadAllText((Join-Path $junction 'sentinel.txt')) -eq 'keep shared target') 'JUNCTION_READ'
        $managedLinks[$junction] = $view
        Remove-ManagedEntry $junction
        Assert-True ([IO.Directory]::Exists($view) -and [IO.File]::ReadAllText($sentinel) -eq 'keep shared target') 'JUNCTION_DELETE_SAFE'
    } (-not $canJunction)
    Invoke-Case $Group 'C12' {
        $bad = Write-TestFile (Join-Path $b 'corrupt.jar') ($text1.Replace('1', 'X'))
        Assert-True ((Get-Item -LiteralPath $bad).Length -eq (Get-Item -LiteralPath $object1).Length -and (Get-Digest $bad) -ne $hash1) 'SAME_SIZE_HASH_REJECTED'
    }
    Invoke-Case $Group 'C13' {
        $rejected = 0
        foreach ($outside in @(($PrimaryRoot + '-similar\fake.jar'), (Join-Path $PrimaryRoot '..\outside.jar'))) {
            try { [void](Assert-FixturePath $outside) } catch { if ($_.Exception.Message -eq 'OUTSIDE_FIXTURE') { $rejected++ } else { throw } }
        }
        Assert-True ($rejected -eq 2 -and (Get-Digest $object1) -eq $hash1) 'ROOT_BOUNDARY'
    }
    Invoke-Case $Group 'C14' {
        $actual = Join-Path $b 'actual-mode.jar'
        $mode = New-TestEntry $actual $object1
        $capabilities.Add([pscustomobject]@{ group=$Group; actualMaterializationMode=$mode.mode; reason=$mode.reason })
        Assert-True ((Get-Digest $actual) -eq $hash1) 'ACTUAL_MODE_HASH'
        if ($canLink) {
            Assert-True ($mode.mode -eq 'SymbolicLink') 'ACTUAL_MODE_LINK'
        } else {
            Assert-True ($mode.mode -eq 'Copy' -and $mode.reason -eq 'ActualPermissionDenied') 'ACTUAL_PERMISSION_FALLBACK'
            Assert-True (-not ((Get-Item -LiteralPath $actual).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'ACTUAL_COPY_NOT_LINK'
            [IO.File]::WriteAllText($actual, 'actual fallback private edit')
            Assert-True ((Get-Digest $object1) -eq $hash1) 'ACTUAL_COPY_ISOLATION'
        }
        Remove-ManagedEntry $actual
    }
    Invoke-Case $Group 'C15' {
        $copyA = New-TestDirectory (Join-Path $base 'copy instance A')
        $copyB = New-TestDirectory (Join-Path $base 'copy instance B')
        $fileA = Join-Path $copyA 'same.jar'
        $fileB = Join-Path $copyB 'same.jar'
        [void](New-TestEntry $fileA $object1 -DenyLink)
        [void](New-TestEntry $fileB $object1 -DenyLink)
        Assert-True ((Get-Digest $fileA) -eq $hash1 -and (Get-Digest $fileB) -eq $hash1) 'COPY_INITIAL_CONTENT'
        Remove-ManagedEntry $fileA
        [void](New-TestEntry $fileA $object2 -DenyLink)
        $renamed = Join-Path $copyA 'disabled.jar'
        [IO.File]::Move($fileA, $renamed)
        $entries.Add($renamed)
        Assert-True ((Get-Digest $renamed) -eq $hash2 -and (Get-Digest $fileB) -eq $hash1) 'COPY_UPDATE_RENAME'
        [IO.File]::WriteAllText($renamed, 'private write')
        Remove-ManagedEntry $renamed
        [IO.Directory]::Delete((Assert-FixturePath $copyA), $false)
        Assert-True (-not [IO.Directory]::Exists($copyA) -and (Get-Digest $fileB) -eq $hash1 -and (Get-Digest $object1) -eq $hash1 -and (Get-Digest $object2) -eq $hash2) 'COPY_DELETE_ISOLATION'
    }
}

# Cleans only exact entries registered by this process, deepest entries first.
function Clear-Fixtures {
    foreach ($path in @($entries | Select-Object -Unique | Sort-Object { $_.Length } -Descending)) {
        $safe = Assert-FixturePath $path -AllowRoot
        $info = Get-Item -LiteralPath $safe -Force -ErrorAction SilentlyContinue
        if ($null -eq $info) { continue }
        if ($info -is [IO.DirectoryInfo]) { [IO.Directory]::Delete($safe, $false) } else { [IO.File]::Delete($safe) }
    }
    foreach ($root in $roots) { Assert-True (-not [IO.Directory]::Exists($root)) 'CLEANUP_ROOT_REMAINS' }
}

if (-not $IsWindows) { throw 'WINDOWS_REQUIRED' }
$runParent = Join-Path $PSScriptRoot '.runs'
[void][IO.Directory]::CreateDirectory($runParent)
$crossParent = $null
if ($CrossVolumeParent) {
    $crossParent = [IO.Path]::GetFullPath($CrossVolumeParent)
    if ([IO.Path]::GetPathRoot($crossParent) -eq [IO.Path]::GetPathRoot($PSScriptRoot)) { throw 'OTHER_VOLUME_REQUIRED' }
}
try {
    $primary = New-FixtureRoot $runParent
    Invoke-Fixture 'same-volume' $primary $primary
    if ($crossParent) {
        $cross = New-FixtureRoot $crossParent
        Invoke-Fixture 'cross-volume' $primary $cross
    } else { $results.Add([pscustomobject]@{ group='cross-volume'; id='ALL'; status='SKIP'; detail='No authorized second-volume parent supplied' }) }
} catch {
    $results.Add([pscustomobject]@{ group='harness'; id='SETUP'; status='FAIL'; detail=$_.Exception.GetType().FullName; assertion=$_.FullyQualifiedErrorId.Split(',')[0] })
} finally {
    Invoke-Case 'harness' 'CLEANUP' { Clear-Fixtures }
    $outputDirectory = Join-Path $PSScriptRoot 'results'
    [void][IO.Directory]::CreateDirectory($outputDirectory)
    $counts = @{ pass=0; fail=0; skip=0 }
    foreach ($row in $results) { $counts[$row.status.ToLowerInvariant()]++ }
    $report = [ordered]@{
        schemaVersion=1
        timestampUtc=[DateTimeOffset]::UtcNow.ToString('o')
        scriptSha256=(Get-Digest $PSCommandPath)
        powershell=$PSVersionTable.PSVersion.ToString()
        framework=[Runtime.InteropServices.RuntimeInformation]::FrameworkDescription
        os=[Runtime.InteropServices.RuntimeInformation]::OSDescription
        architecture=[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        sourceDrive=[IO.Path]::GetPathRoot($PSScriptRoot)
        objectDrive=$(if ($crossParent) { [IO.Path]::GetPathRoot($crossParent) } else { $null })
        counts=$counts
        capabilities=@($capabilities.ToArray())
        cases=@($results.ToArray())
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDirectory 'latest.json') -Encoding utf8
    $results | Format-Table group, id, status, detail -AutoSize
    Write-Output ('PASS={0} FAIL={1} SKIP={2}' -f $counts.pass, $counts.fail, $counts.skip)
}
if ($counts.fail -gt 0) { throw 'S09_FAILED_SEE_RESULTS' }
