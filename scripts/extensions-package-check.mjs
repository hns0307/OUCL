import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Reads managed resources only: never calls the launcher's Main or starts its Electron/game payload.
const executable = process.env.OUCL_EXE_TEST_PATH;
const buildRoot = process.env.OUCL_BUILD_ROOT;
const evidence = process.env.OUCL_VALIDATION_DIR;
if (!executable || !buildRoot || !evidence) throw new Error('EXE_BUILD_AND_EVIDENCE_PATHS_REQUIRED');
await mkdir(evidence, { recursive: true });
const extracted = path.resolve(evidence, 'embedded-resources.json');
const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($env:OUCL_AUDIT_EXE))
function Read-Resource([string] $name) {
    $stream = $assembly.GetManifestResourceStream($name)
    if ($null -eq $stream) { throw "MISSING_RESOURCE:$name" }
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
$stream = $assembly.GetManifestResourceStream('application')
if ($null -eq $stream) { throw 'MISSING_APPLICATION_RESOURCE' }
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Read)
$entries = @()
try {
    foreach ($entry in $archive.Entries) {
        $content = $entry.Open()
        $memory = New-Object IO.MemoryStream
        try {
            $content.CopyTo($memory)
            $bytes = $memory.ToArray()
            $algorithm = [Security.Cryptography.SHA256]::Create()
            try { $hash = [BitConverter]::ToString($algorithm.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
            finally { $algorithm.Dispose() }
            $item = @{ path = $entry.FullName; bytes = $bytes.Length; sha256 = $hash }
            if ($entry.FullName -eq 'package.json' -or $entry.FullName -eq 'THIRD_PARTY_NOTICES.txt') { $item.text = [Text.Encoding]::UTF8.GetString($bytes) }
            $entries += $item
        } finally { $memory.Dispose(); $content.Dispose() }
    }
} finally { $archive.Dispose(); $stream.Dispose() }
$result = @{ configuration = (Read-Resource 'configuration'); appManifest = (Read-Resource 'app-manifest'); runtimeManifest = (Read-Resource 'runtime-manifest'); entries = $entries }
[IO.File]::WriteAllText($env:OUCL_AUDIT_JSON, ($result | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
`;
const extraction = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  encoding: 'utf8', windowsHide: true, env: { ...process.env, OUCL_AUDIT_EXE: path.resolve(executable), OUCL_AUDIT_JSON: extracted },
});
await writeFile(path.join(evidence, 'resource-extraction.log'), `${extraction.stdout ?? ''}${extraction.stderr ?? ''}`);
if (extraction.error || extraction.status !== 0) throw new Error('RESOURCE_EXTRACTION_FAILED');
const embedded = JSON.parse(await readFile(extracted, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = ['dist/main/index.cjs', 'dist/preload/index.cjs', 'dist/renderer/index.html', 'dist/workers/entry.cjs', 'dist/workers/fixed-pack.cjs'];
let nativeMetadata;
try { nativeMetadata = JSON.parse(await readFile(path.resolve(buildRoot, 'native/distribution-files.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (nativeMetadata) {
  assert.deepEqual(Object.keys(nativeMetadata).sort(), ['bytes', 'file', 'formatVersion', 'sha256']);
  assert.equal(nativeMetadata.formatVersion, 1); assert.equal(nativeMetadata.file, 'distribution-files.exe');
  assert.match(nativeMetadata.sha256, /^[a-f0-9]{64}$/); assert.ok(Number.isSafeInteger(nativeMetadata.bytes) && nativeMetadata.bytes > 0 && nativeMetadata.bytes <= 4 * 1024 ** 2);
  const nativeBytes = await readFile(path.resolve(buildRoot, 'native/distribution-files.exe'));
  assert.equal(nativeBytes.length, nativeMetadata.bytes); assert.equal(sha256(nativeBytes), nativeMetadata.sha256);
  expected.push('dist/native/distribution-files.exe', 'dist/native/distribution-files.json');
}
const assets = embedded.entries.map(entry => entry.path).filter(name => /^dist\/renderer\/assets\/index-[a-zA-Z0-9_-]+\.(css|js)$/.test(name));
assert.equal(assets.length, 2, 'EXPECTED_RENDERER_CSS_AND_JS');
assert.equal(assets.filter(name => name.endsWith('.js')).length, 1);
assert.equal(assets.filter(name => name.endsWith('.css')).length, 1);
expected.push(...assets, 'package.json', 'THIRD_PARTY_NOTICES.txt');
assert.deepEqual(embedded.entries.map(entry => entry.path).sort(), [...expected].sort(), 'EXACT_REVIEWED_ENTRIES');
assert.equal(new Set(embedded.entries.map(entry => entry.path.toLowerCase())).size, expected.length, 'NO_DUPLICATE_ENTRIES');
const manifest = new Map(embedded.appManifest.trimEnd().split('\n').map(line => {
  assert.match(line, /^[a-f0-9]{64} {2}[^\r\n]+$/); return [line.slice(66), line.slice(0, 64)];
}));
assert.equal(manifest.size, expected.length);
const checks = [];
for (const entry of embedded.entries) {
  assert.equal(entry.sha256, manifest.get(entry.path), `EMBEDDED_MANIFEST:${entry.path}`);
  if (entry.path.startsWith('dist/')) {
    const built = await readFile(path.resolve(buildRoot, entry.path.slice(5)));
    assert.equal(entry.bytes, built.length, `BUILD_LENGTH:${entry.path}`);
    assert.equal(entry.sha256, sha256(built), `BUILD_HASH:${entry.path}`);
  }
  checks.push({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256, manifestMatch: true, buildMatch: entry.path.startsWith('dist/') });
}
const meta = JSON.parse(await readFile('package.json', 'utf8'));
assert.deepEqual(JSON.parse(embedded.entries.find(entry => entry.path === 'package.json').text), { name: 'oucl', version: meta.version, main: 'dist/main/index.cjs' });
const notices = embedded.entries.find(entry => entry.path === 'THIRD_PARTY_NOTICES.txt').text;
for (const dependency of ['react', 'react-dom', 'zustand', 'smol-toml', 'scheduler']) assert.ok(notices.includes(`--- ${dependency} ---\n`), `NOTICE:${dependency}`);
const configuration = embedded.configuration.trim().split('\n');
assert.equal(configuration.length, 3);
assert.match(configuration[0], /^[a-f0-9]{64}$/);
assert.match(configuration[1], /^https:\/\/github\.com\/electron\/electron\/releases\/download\/v[\d.]+\/electron-v[\d.]+-win32-x64\.zip$/);
assert.equal(configuration[2], sha256(embedded.appManifest), 'APPLICATION_MANIFEST_HASH');
const report = { status: 'PASS', executesLauncher: false, executable: path.resolve(executable), buildRoot: path.resolve(buildRoot),
  bytes: (await readFile(executable)).length, sha256: sha256(await readFile(executable)), appHash: configuration[2],
  runtimeChecksum: configuration[0], runtimeUrl: configuration[1], entries: checks };
await writeFile(path.join(evidence, 'package-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, entries: checks.length, bytes: report.bytes, sha256: report.sha256, appHash: report.appHash }));
